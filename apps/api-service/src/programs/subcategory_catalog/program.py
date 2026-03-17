from __future__ import annotations

import json

import dspy

from programs.subcategory_catalog.signature import SubcategoryCatalogSignature


def _extract_first_catalog_json_object(text: str) -> dict | None:
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
                    if isinstance(parsed, dict) and isinstance(parsed.get("concepts"), list):
                        return parsed
                    break

        i = start + 1


def _compact_json(obj: object) -> str:
    return json.dumps(obj, ensure_ascii=True, separators=(",", ":"), sort_keys=True)


def _sanitize_catalog_plan_json(raw: object) -> str:
    text = str(raw or "").strip()
    if not text:
        return ""

    parsed: dict | None = None
    try:
        loaded = json.loads(text)
        if isinstance(loaded, dict) and isinstance(loaded.get("concepts"), list):
            parsed = loaded
    except Exception:
        parsed = _extract_first_catalog_json_object(text)

    if not isinstance(parsed, dict) or not isinstance(parsed.get("concepts"), list):
        return text

    question = str(parsed.get("question") or "").strip()
    concepts = parsed.get("concepts")
    if isinstance(concepts, list):
        for item in concepts:
            if not isinstance(item, dict):
                continue
            if "image_prompt" not in item and "imagePrompt" in item:
                item["image_prompt"] = item.pop("imagePrompt")
            if "price_tier" not in item and "priceTier" in item:
                item["price_tier"] = item.pop("priceTier")
    return _compact_json({"concepts": concepts, "question": question})


class SubcategoryCatalogProgram(dspy.Module):
    def __init__(self) -> None:
        super().__init__()
        self.prog = dspy.Predict(SubcategoryCatalogSignature)

    def forward(  # type: ignore[override]
        self,
        *,
        catalog_context_json: str,
        target_count: int,
    ):
        pred = self.prog(
            catalog_context_json=catalog_context_json,
            target_count=target_count,
        )
        try:
            cleaned = _sanitize_catalog_plan_json(getattr(pred, "catalog_plan_json", None))
            if cleaned:
                setattr(pred, "catalog_plan_json", cleaned)
        except Exception:
            pass
        return pred


__all__ = ["SubcategoryCatalogProgram"]
