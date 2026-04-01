from __future__ import annotations

import json
import re

import dspy

from programs.subcategory_scope_suggester.signature import SubcategoryScopeSuggesterSignature


def _strip_code_fences(text: str) -> str:
    value = str(text or "").strip()
    value = re.sub(r"^```(?:json)?\s*", "", value, flags=re.IGNORECASE)
    value = re.sub(r"\s*```$", "", value, flags=re.IGNORECASE)
    return value.strip()


def _sanitize_scopes_json(raw: object) -> str:
    text = _strip_code_fences(str(raw or ""))
    if not text:
        return ""
    try:
        loaded = json.loads(text)
        if isinstance(loaded, dict) and isinstance(loaded.get("scopes"), list):
            return json.dumps(loaded, ensure_ascii=True, separators=(",", ":"), sort_keys=True)
    except Exception:
        pass
    # Try to find first {...} with "scopes"
    i = text.find("{")
    while i >= 0:
        depth = 0
        in_str = False
        esc = False
        for j in range(i, len(text)):
            ch = text[j]
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
                    blob = text[i : j + 1]
                    try:
                        loaded = json.loads(blob)
                        if isinstance(loaded, dict) and isinstance(loaded.get("scopes"), list):
                            return json.dumps(loaded, ensure_ascii=True, separators=(",", ":"), sort_keys=True)
                    except Exception:
                        break
                    break
        i = text.find("{", i + 1)
    return text


class SubcategoryScopeSuggesterProgram(dspy.Module):
    def __init__(self) -> None:
        super().__init__()
        self.prog = dspy.Predict(SubcategoryScopeSuggesterSignature)

    def forward(  # type: ignore[override]
        self,
        *,
        scope_context_json: str,
        min_scope_count: int,
        max_scope_count: int,
    ):
        pred = self.prog(
            scope_context_json=scope_context_json,
            min_scope_count=int(min_scope_count),
            max_scope_count=int(max_scope_count),
        )
        try:
            cleaned = _sanitize_scopes_json(getattr(pred, "scope_options_json", None))
            if cleaned:
                setattr(pred, "scope_options_json", cleaned)
        except Exception:
            pass
        return pred


__all__ = ["SubcategoryScopeSuggesterProgram"]
