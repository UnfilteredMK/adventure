from __future__ import annotations

import json
import os
import time
from typing import Any, Dict, List, Tuple

from programs.common.dspy_runtime import configure_dspy, extract_dspy_usage, make_dspy_lm_for_module
from programs.common.visual_text_safety import sanitize_visual_context_text
from programs.refinement_library_planner.program import RefinementLibraryPlannerProgram
from programs.refinement_library_planner.validation import slugify_component_key, validate_and_normalize_planner_payload


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


def _resolve_excluded_component_keys(payload: Dict[str, Any]) -> List[str]:
    raw = payload.get("excluded_component_keys") or payload.get("excludedComponentKeys") or []
    values = raw if isinstance(raw, list) else []
    seen: set[str] = set()
    keys: List[str] = []
    for value in values:
        key = slugify_component_key(str(value or ""))
        if not key or key in seen:
            continue
        seen.add(key)
        keys.append(key)
    return keys[:20]


def _resolve_existing_components(
    payload: Dict[str, Any],
    *,
    excluded_component_keys: List[str],
) -> List[Dict[str, Any]]:
    raw = payload.get("existing_components") or payload.get("existingComponents") or []
    excluded = set(excluded_component_keys)
    items: List[Dict[str, Any]] = []
    for item in raw if isinstance(raw, list) else []:
        if not isinstance(item, dict):
            continue
        key = slugify_component_key(str(item.get("key") or "").strip())
        label = sanitize_visual_context_text(item.get("label") or key or "", max_len=120)
        if not key or key in excluded:
            continue
        items.append({"key": key, "label": label or key, "priority": item.get("priority")})
    return items


def _run_planner_once(
    *,
    ctx: Dict[str, str],
    excluded_component_keys: List[str],
    existing_components: List[Dict[str, Any]],
    target_component_count: int,
    target_options_per_component: int,
    retry_hint: str | None,
) -> Tuple[Dict[str, Any] | None, Any]:
    planner_context = {
        "category_id": ctx["category_id"] or None,
        "category_name": ctx["category_name"] or None,
        "subcategory_id": ctx["subcategory_id"] or None,
        "subcategory_name": ctx["subcategory_name"] or None,
        "company_summary": ctx["company_summary"] or None,
        "service_summary": ctx["service_summary"] or None,
        "existing_components": existing_components,
        "excluded_component_keys": excluded_component_keys,
        "target_component_count": target_component_count,
        "target_options_per_component": target_options_per_component,
        "planning_goal": (
            "Propose visually meaningful refinement components and concrete image prompts per option. "
            "Stay aligned with the service summary; omit unrelated trades or exterior elements for interior-only scopes."
        ),
    }
    if retry_hint:
        planner_context["validation_retry_hint"] = retry_hint

    lm_cfg = make_dspy_lm_for_module(module_env_prefix="DSPY_REFINEMENT_LIBRARY_PLANNER", allow_small_models=False)
    if not lm_cfg:
        return None, None

    import dspy

    lm = dspy.LM(
        model=lm_cfg["model"],
        temperature=_coerce_float(os.getenv("DSPY_REFINEMENT_LIBRARY_PLANNER_TEMPERATURE"), 0.45),
        max_tokens=_coerce_int(os.getenv("DSPY_REFINEMENT_LIBRARY_PLANNER_MAX_TOKENS"), 4096),
        timeout=_coerce_float(os.getenv("DSPY_REFINEMENT_LIBRARY_PLANNER_TIMEOUT"), 60.0),
    )
    configure_dspy(lm)

    program = RefinementLibraryPlannerProgram()
    with dspy.context(lm=lm):
        pred = program(
            planner_context_json=_compact_json(planner_context),
            target_component_count=target_component_count,
            target_options_per_component=target_options_per_component,
        )
    usage = extract_dspy_usage(pred)
    raw = str(getattr(pred, "refinement_library_plan_json", "") or "").strip()
    parsed: Dict[str, Any] | None = None
    if raw:
        try:
            loaded = json.loads(raw)
            if isinstance(loaded, dict):
                parsed = loaded
        except Exception:
            parsed = None
    return parsed, usage


def plan_refinement_library(payload: Dict[str, Any]) -> Dict[str, Any]:
    request_id = f"refinement_library_plan_{int(time.time() * 1000)}"
    ctx = _resolve_context(payload)
    excluded_component_keys = _resolve_excluded_component_keys(payload)
    existing_components = _resolve_existing_components(
        payload,
        excluded_component_keys=excluded_component_keys,
    )
    target_component_count = max(
        1,
        min(10, _coerce_int(payload.get("target_component_count") or payload.get("targetComponentCount"), 10)),
    )
    target_options = max(
        1,
        min(6, _coerce_int(payload.get("target_options_per_component") or payload.get("targetOptionsPerComponent"), 6)),
    )

    if not ctx["category_name"] and not ctx["subcategory_name"] and not ctx["service_summary"]:
        return {
            "ok": False,
            "error": "missing_service_context",
            "message": "Provide category/subcategory context or a service summary.",
            "requestId": request_id,
        }

    last_error = ""
    last_usage: Any = None
    retry_hint: str | None = None
    for attempt in range(2):
        parsed, usage = _run_planner_once(
            ctx=ctx,
            excluded_component_keys=excluded_component_keys,
            existing_components=existing_components,
            target_component_count=target_component_count,
            target_options_per_component=target_options,
            retry_hint=retry_hint,
        )
        last_usage = usage or last_usage
        if not isinstance(parsed, dict):
            last_error = "planner_invalid_json"
            retry_hint = "Previous output was not valid JSON with components and optionSeeds. Reply with JSON only."
            continue

        ok, err, normalized = validate_and_normalize_planner_payload(
            parsed,
            target_component_count=target_component_count,
            target_options_per_component=target_options,
            excluded_component_keys=excluded_component_keys,
        )
        if ok:
            return {
                "ok": True,
                "requestId": request_id,
                "source": "dspy_refinement_library_planner",
                "category_id": ctx["category_id"] or None,
                "subcategory_id": ctx["subcategory_id"] or None,
                "components": normalized["components"],
                "optionSeeds": normalized["optionSeeds"],
                "lmUsage": last_usage,
                "targetComponentCount": target_component_count,
                "targetOptionsPerComponent": target_options,
                "excludedComponentKeys": excluded_component_keys,
            }

        last_error = err or "validation_failed"
        retry_hint = (
            f"Previous plan failed validation ({last_error}). "
            "Ensure every component has a matching optionSeeds group with strong imagePrompt strings (>=12 chars) "
            "and no process/admin categories. Never return an excluded component key."
        )

    return {
        "ok": False,
        "error": last_error or "planner_failed",
        "message": "Refinement library planner could not produce a valid plan.",
        "requestId": request_id,
        "lmUsage": last_usage,
    }


__all__ = ["plan_refinement_library"]
