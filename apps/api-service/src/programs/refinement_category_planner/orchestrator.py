from __future__ import annotations

import json
import os
import time
from typing import Any, Dict, List

from programs.common.dspy_runtime import configure_dspy, extract_dspy_usage, make_dspy_lm_for_module
from programs.common.visual_text_safety import sanitize_visual_context_text
from programs.refinement_category_planner.program import RefinementCategoryPlannerProgram
from programs.refinement_category_planner.taxonomy import (
    get_supported_refinement_components_for_planner,
    normalize_refinement_plan_items,
)

_DEFAULT_TARGET_CATEGORIES = 10
_MAX_TARGET_CATEGORIES = 10


def _compact_json(obj: object) -> str:
    return json.dumps(obj, ensure_ascii=True, separators=(",", ":"), sort_keys=True)


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


def _resolve_context(payload: Dict[str, Any]) -> Dict[str, str]:
    category_id = str(payload.get("category_id") or payload.get("categoryId") or "").strip()
    category_name = sanitize_visual_context_text(
        payload.get("category_name") or payload.get("categoryName") or payload.get("industry") or payload.get("vertical") or "",
        max_len=160,
    )
    subcategory_id = str(payload.get("subcategory_id") or payload.get("subcategoryId") or "").strip()
    subcategory_name = sanitize_visual_context_text(
        payload.get("subcategory_name") or payload.get("subcategoryName") or payload.get("service") or "",
        max_len=160,
    )
    company_summary = sanitize_visual_context_text(payload.get("company_summary") or payload.get("companySummary") or "", max_len=800)
    service_summary = sanitize_visual_context_text(payload.get("service_summary") or payload.get("serviceSummary") or "", max_len=800)
    return {
        "category_id": category_id,
        "category_name": category_name,
        "subcategory_id": subcategory_id,
        "subcategory_name": subcategory_name,
        "company_summary": company_summary,
        "service_summary": service_summary,
    }


def _resolve_existing_components(payload: Dict[str, Any]) -> List[Dict[str, Any]]:
    raw = payload.get("existing_components") or payload.get("existingComponents") or []
    items: List[Dict[str, Any]] = []
    for item in raw if isinstance(raw, list) else []:
        if not isinstance(item, dict):
            continue
        key = str(item.get("key") or "").strip()
        label = sanitize_visual_context_text(item.get("label") or key or "", max_len=120)
        priority = item.get("priority")
        if not key:
            continue
        items.append(
            {
                "key": key,
                "label": label or key,
                "priority": priority,
            }
        )
    return items


def plan_refinement_categories(payload: Dict[str, Any]) -> Dict[str, Any]:
    request_id = f"refinement_category_plan_{int(time.time() * 1000)}"
    ctx = _resolve_context(payload)
    existing_components = _resolve_existing_components(payload)
    target_categories = max(
        1,
        min(
            _MAX_TARGET_CATEGORIES,
            _coerce_int(
                payload.get("target_categories") or payload.get("targetCategories"),
                _DEFAULT_TARGET_CATEGORIES,
            ),
        ),
    )
    min_categories = max(
        0,
        min(
            target_categories,
            _coerce_int(
                payload.get("min_categories") or payload.get("minCategories"),
                target_categories,
            ),
        ),
    )
    max_categories = max(
        target_categories,
        min(
            _MAX_TARGET_CATEGORIES,
            _coerce_int(
                payload.get("max_categories") or payload.get("maxCategories"),
                target_categories,
            ),
        ),
    )

    if not ctx["category_name"] and not ctx["subcategory_name"] and not ctx["service_summary"]:
        return {
            "ok": False,
            "error": "missing_service_context",
            "message": "Provide category/subcategory context or a service summary.",
            "requestId": request_id,
        }

    lm_cfg = make_dspy_lm_for_module(module_env_prefix="DSPY_REFINEMENT_CATEGORY_PLANNER", allow_small_models=False)
    if not lm_cfg:
        return {
            "ok": False,
            "error": "lm_not_configured",
            "message": "DSPy LM is not configured for refinement category planning.",
            "requestId": request_id,
        }

    import dspy

    lm = dspy.LM(
        model=lm_cfg["model"],
        temperature=_coerce_float(os.getenv("DSPY_REFINEMENT_CATEGORY_PLANNER_TEMPERATURE"), 0.5),
        max_tokens=_coerce_int(os.getenv("DSPY_REFINEMENT_CATEGORY_PLANNER_MAX_TOKENS"), 2048),
        timeout=_coerce_float(os.getenv("DSPY_REFINEMENT_CATEGORY_PLANNER_TIMEOUT"), 30.0),
    )
    configure_dspy(lm)

    planner_context_json = _compact_json(
        {
            "category_id": ctx["category_id"] or None,
            "category_name": ctx["category_name"] or None,
            "industry": ctx["category_name"] or None,
            "subcategory_id": ctx["subcategory_id"] or None,
            "subcategory_name": ctx["subcategory_name"] or None,
            "service": ctx["subcategory_name"] or None,
            "company_summary": ctx["company_summary"] or None,
            "service_summary": ctx["service_summary"] or None,
            "services_summary": ctx["service_summary"] or None,
            "existing_components": existing_components,
            "max_categories": max_categories,
            "min_categories": min_categories,
            "planning_goal": (
                "Choose the most important design-related refinement components for this exact vertical. "
                "These become stored subcategory_components key/value pairs."
            ),
            "supported_components": get_supported_refinement_components_for_planner(),
            "target_categories": target_categories,
        }
    )

    raw_categories: List[dict] = []
    lm_usage = None
    program = RefinementCategoryPlannerProgram()
    with dspy.context(lm=lm):
        pred = program(
            planner_context_json=planner_context_json,
            target_categories=target_categories,
            min_categories=min_categories,
            max_categories=max_categories,
        )
    lm_usage = extract_dspy_usage(pred)

    raw = str(getattr(pred, "refinement_category_plan_json", "") or "").strip()
    vertical = ctx["category_name"]
    if raw:
        try:
            parsed = json.loads(raw)
        except Exception:
            parsed = None
        if isinstance(parsed, dict):
            vertical = sanitize_visual_context_text(parsed.get("vertical") or vertical, max_len=120) or vertical
            if isinstance(parsed.get("categories"), list):
                raw_categories = [item for item in parsed["categories"] if isinstance(item, dict)]

    normalized = normalize_refinement_plan_items(
        raw_categories,
        category_name=ctx["category_name"],
        subcategory_name=ctx["subcategory_name"],
        exclude_keys=[item.get("key") for item in existing_components],
        target_categories=target_categories,
        min_categories=min_categories,
        max_categories=max_categories,
    )

    return {
        "ok": True,
        "requestId": request_id,
        "source": "refinement_category_planner",
        "vertical": vertical or ctx["category_name"],
        "category_id": ctx["category_id"] or None,
        "subcategory_id": ctx["subcategory_id"] or None,
        "categories": normalized,
        "lmUsage": lm_usage,
        "targetCategories": target_categories,
    }


__all__ = ["plan_refinement_categories"]
