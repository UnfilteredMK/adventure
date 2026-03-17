from __future__ import annotations

import json
import os
import re
import time
from typing import Any, Dict, List, Optional, Tuple

from programs.common.dspy_runtime import configure_dspy, extract_dspy_usage, make_dspy_lm_for_module
from programs.subcategory_catalog.program import SubcategoryCatalogProgram


_PRICE_TIERS = {"$", "$$", "$$$", "$$$$"}


def _compact_json(obj: object) -> str:
    return json.dumps(obj, ensure_ascii=True, separators=(",", ":"), sort_keys=True)


def _slugify_value(text: str) -> str:
    return re.sub(r"_+", "_", re.sub(r"[^a-z0-9]+", "_", str(text or "").strip().lower())).strip("_")[:64] or "direction"


def _coerce_int(value: Any, default: int) -> int:
    try:
        if value is None:
            return default
        return int(value)
    except Exception:
        return default


def _coerce_float(value: Any, default: float) -> float:
    try:
        if value is None:
            return default
        return float(value)
    except Exception:
        return default


def _resolve_strings(payload: Dict[str, Any]) -> Tuple[str, str, str, str]:
    service_summary = str(
        payload.get("serviceSummary")
        or payload.get("service_summary")
        or payload.get("servicesSummary")
        or payload.get("services_summary")
        or ""
    ).strip()
    industry = str(payload.get("industry") or payload.get("categoryName") or payload.get("category_name") or "").strip()
    service = str(
        payload.get("service")
        or payload.get("subcategoryName")
        or payload.get("subcategory_name")
        or ""
    ).strip()
    subcategory_name = str(payload.get("subcategoryName") or payload.get("subcategory_name") or service or "").strip()
    return service_summary, industry, service, subcategory_name


def _normalize_concepts(raw_items: Any, *, limit: int) -> List[Dict[str, Any]]:
    if not isinstance(raw_items, list):
        return []

    out: List[Dict[str, Any]] = []
    seen: set[str] = set()
    for raw in raw_items:
        if len(out) >= limit:
            break
        if isinstance(raw, str):
            label = raw.strip()
            value = _slugify_value(label)
            image_prompt = label
            description = ""
            price_tier = ""
        elif isinstance(raw, dict):
            label = str(raw.get("label") or raw.get("name") or raw.get("value") or "").strip()
            value = str(raw.get("value") or "").strip() or _slugify_value(label)
            image_prompt = str(raw.get("image_prompt") or raw.get("imagePrompt") or label).strip()
            description = str(raw.get("description") or raw.get("descriptor") or "").strip()
            price_tier = str(raw.get("price_tier") or raw.get("priceTier") or "").strip()
        else:
            continue

        if not label or not image_prompt:
            continue
        key = f"{label.lower()}::{image_prompt.lower()}::{price_tier}"
        if key in seen:
            continue
        seen.add(key)

        item: Dict[str, Any] = {
            "image_prompt": image_prompt,
            "label": label,
            "value": value,
        }
        if description:
            item["description"] = description
        if price_tier in _PRICE_TIERS:
            item["price_tier"] = price_tier
        out.append(item)
    return out


def _fallback_question(service: str) -> str:
    subject = service or "this service"
    return f"Choose a starting visual direction for {subject}."


def generate_subcategory_catalog(payload: Dict[str, Any]) -> Dict[str, Any]:
    request_id = f"subcategory_catalog_{int(time.time() * 1000)}"
    target_count = max(8, min(40, _coerce_int(payload.get("count") or payload.get("targetCount"), 20)))
    service_summary, industry, service, subcategory_name = _resolve_strings(payload)
    service_name = subcategory_name or service
    category_name = str(payload.get("categoryName") or payload.get("category_name") or industry).strip()

    if not service_summary and not industry and not service_name:
        return {
            "ok": False,
            "error": "missing_service_context",
            "message": "Provide serviceSummary or industry/service context.",
            "requestId": request_id,
        }

    lm_cfg = make_dspy_lm_for_module(module_env_prefix="DSPY_SUBCATEGORY_CATALOG", allow_small_models=False)
    if not lm_cfg:
        return {
            "ok": False,
            "error": "lm_not_configured",
            "message": "DSPy LM is not configured for subcategory catalog generation.",
            "requestId": request_id,
        }

    import dspy

    lm = dspy.LM(
        model=lm_cfg["model"],
        temperature=_coerce_float(os.getenv("DSPY_SUBCATEGORY_CATALOG_TEMPERATURE"), 0.7),
        max_tokens=_coerce_int(os.getenv("DSPY_SUBCATEGORY_CATALOG_MAX_TOKENS"), 4096),
        timeout=_coerce_float(os.getenv("DSPY_SUBCATEGORY_CATALOG_TIMEOUT"), 45.0),
    )
    configure_dspy(lm)

    catalog_context_json = _compact_json(
        {
            "category_name": category_name,
            "industry": industry or category_name,
            "service": service_name,
            "service_summary": service_summary or f"{category_name}: {service_name}".strip(": "),
            "subcategory_name": subcategory_name or service_name,
            "target_count": target_count,
        }
    )

    question = _fallback_question(service_name)
    concepts: List[Dict[str, Any]] = []
    lm_usage: Optional[Dict[str, Any]] = None
    source = "subcategory_catalog_program"

    program = SubcategoryCatalogProgram()
    with dspy.context(lm=lm):
        pred = program(catalog_context_json=catalog_context_json, target_count=target_count)

    raw = str(getattr(pred, "catalog_plan_json", "") or "").strip()
    lm_usage = extract_dspy_usage(pred)
    if raw:
        try:
            parsed = json.loads(raw)
        except Exception:
            parsed = None
        if isinstance(parsed, dict):
            question = str(parsed.get("question") or "").strip() or question
            concepts = _normalize_concepts(parsed.get("concepts"), limit=target_count)

    return {
        "concepts": concepts,
        "lmUsage": lm_usage,
        "ok": True,
        "question": question or _fallback_question(service_name),
        "requestId": request_id,
        "source": source,
        "targetCount": target_count,
    }


__all__ = ["generate_subcategory_catalog"]
