from __future__ import annotations

import json
import re

import dspy

from programs.refinement_library_planner.signature import RefinementLibraryPlannerSignature


def _extract_first_json_with_keys(text: str, required_keys: set[str]) -> dict | None:
    s = str(text or "")
    if not s:
        return None
    i = 0
    while True:
        start = s.find("{", i)
        if start < 0:
            return None
        depth = 0
        in_str = False
        esc = False
        for j in range(start, len(s)):
            ch = s[j]
            if in_str:
                if esc:
                    esc = False
                    continue
                if ch == "\\":
                    esc = True
                    continue
                if ch == '"':
                    in_str = False
                continue
            if ch == '"':
                in_str = True
                continue
            if ch == "{":
                depth += 1
            elif ch == "}":
                depth -= 1
                if depth == 0:
                    blob = s[start : j + 1]
                    try:
                        parsed = json.loads(blob)
                    except Exception:
                        break
                    if isinstance(parsed, dict) and required_keys.issubset(parsed.keys()):
                        return parsed
                    break
        i = start + 1


def _strip_code_fences(text: str) -> str:
    value = str(text or "").strip()
    value = re.sub(r"^```(?:json)?\s*", "", value, flags=re.IGNORECASE)
    value = re.sub(r"\s*```$", "", value, flags=re.IGNORECASE)
    return value.strip()


def _sanitize_plan_json(raw: object) -> str:
    text = _strip_code_fences(str(raw or ""))
    if not text:
        return ""
    parsed: dict | None = None
    try:
        loaded = json.loads(text)
        if isinstance(loaded, dict):
            parsed = loaded
    except Exception:
        parsed = _extract_first_json_with_keys(text, {"components", "optionSeeds"})
    if not isinstance(parsed, dict):
        return text
    return json.dumps(parsed, ensure_ascii=True, separators=(",", ":"), sort_keys=True)


class RefinementLibraryPlannerProgram(dspy.Module):
    def __init__(self) -> None:
        super().__init__()
        self.prog = dspy.Predict(RefinementLibraryPlannerSignature)

    def forward(  # type: ignore[override]
        self,
        *,
        planner_context_json: str,
        target_component_count: int,
        target_options_per_component: int,
    ):
        pred = self.prog(
            planner_context_json=planner_context_json,
            target_component_count=int(target_component_count),
            target_options_per_component=int(target_options_per_component),
        )
        try:
            cleaned = _sanitize_plan_json(getattr(pred, "refinement_library_plan_json", None))
            if cleaned:
                setattr(pred, "refinement_library_plan_json", cleaned)
        except Exception:
            pass
        return pred


__all__ = ["RefinementLibraryPlannerProgram"]
