from __future__ import annotations

import json
import os
import time
from typing import Any, Dict, List, Tuple

from programs.common.dspy_runtime import configure_dspy, extract_dspy_usage, make_dspy_lm_for_module
from programs.common.visual_text_safety import sanitize_visual_context_text
from programs.subcategory_scope_suggester.program import SubcategoryScopeSuggesterProgram


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
    category_name = sanitize_visual_context_text(
        payload.get("category_name") or payload.get("categoryName") or payload.get("industry") or "",
        max_len=160,
    )
    subcategory_name = sanitize_visual_context_text(
        payload.get("subcategory_name") or payload.get("subcategoryName") or payload.get("service") or "",
        max_len=160,
    )
    company_summary = sanitize_visual_context_text(payload.get("company_summary") or payload.get("companySummary") or "", max_len=800)
    service_summary = sanitize_visual_context_text(payload.get("service_summary") or payload.get("serviceSummary") or "", max_len=800)
    return {
        "category_name": category_name,
        "subcategory_name": subcategory_name,
        "company_summary": company_summary,
        "service_summary": service_summary,
    }


def _resolve_components(payload: Dict[str, Any]) -> List[Dict[str, Any]]:
    raw = payload.get("components") or payload.get("subcategoryComponents") or payload.get("subcategory_components") or []
    items: List[Dict[str, Any]] = []
    for item in raw if isinstance(raw, list) else []:
        if not isinstance(item, dict):
            continue
        key = str(item.get("key") or "").strip()
        label = sanitize_visual_context_text(item.get("label") or key or "", max_len=120)
        reason = sanitize_visual_context_text(item.get("reason") or "", max_len=240)
        if not key and not label:
            continue
        rec: Dict[str, Any] = {"key": key or label.lower().replace(" ", "_")[:48], "label": label or key}
        if reason:
            rec["reason"] = reason
        pr = item.get("priority")
        if pr is not None:
            try:
                rec["priority"] = int(pr)
            except Exception:
                pass
        items.append(rec)
    return items


def _normalize_scope_strings(raw: List[Any], *, max_items: int) -> List[str]:
    seen: set[str] = set()
    out: List[str] = []
    for x in raw:
        if not isinstance(x, str):
            continue
        s = sanitize_visual_context_text(x, max_len=96)
        if len(s) < 2:
            continue
        key = s.lower()
        if key in seen:
            continue
        seen.add(key)
        out.append(s)
        if len(out) >= max_items:
            break
    return out


def _run_once(
    *,
    ctx: Dict[str, str],
    components: List[Dict[str, Any]],
    min_count: int,
    max_count: int,
    retry_hint: str | None,
) -> Tuple[Dict[str, Any] | None, Any]:
    scope_context = {
        "category_name": ctx["category_name"] or None,
        "subcategory_name": ctx["subcategory_name"] or None,
        "company_summary": ctx["company_summary"] or None,
        "service_summary": ctx["service_summary"] or None,
        "refinement_components": components,
        "goal": (
            "List concrete scope-of-work options customers often choose among for this exact service "
            "(multi-select). Align with industry norms and the refinement components."
        ),
    }
    if retry_hint:
        scope_context["validation_retry_hint"] = retry_hint

    lm_cfg = make_dspy_lm_for_module(module_env_prefix="DSPY_SUBCATEGORY_SCOPE_SUGGESTER", allow_small_models=True)
    if not lm_cfg:
        return None, None

    import dspy

    lm = dspy.LM(
        model=lm_cfg["model"],
        temperature=_coerce_float(os.getenv("DSPY_SUBCATEGORY_SCOPE_SUGGESTER_TEMPERATURE"), 0.35),
        max_tokens=_coerce_int(os.getenv("DSPY_SUBCATEGORY_SCOPE_SUGGESTER_MAX_TOKENS"), 1024),
        timeout=_coerce_float(os.getenv("DSPY_SUBCATEGORY_SCOPE_SUGGESTER_TIMEOUT"), 45.0),
    )
    configure_dspy(lm)

    program = SubcategoryScopeSuggesterProgram()
    with dspy.context(lm=lm):
        pred = program(
            scope_context_json=_compact_json(scope_context),
            min_scope_count=min_count,
            max_scope_count=max_count,
        )
    usage = extract_dspy_usage(pred)
    raw = str(getattr(pred, "scope_options_json", "") or "").strip()
    parsed: Dict[str, Any] | None = None
    if raw:
        try:
            loaded = json.loads(raw)
            if isinstance(loaded, dict):
                parsed = loaded
        except Exception:
            parsed = None
    return parsed, usage


def suggest_subcategory_scope(payload: Dict[str, Any]) -> Dict[str, Any]:
    """
    Return { ok, scopes, ... } for persisting to categories_subcategories.subcategory_scope (text[]).
    """
    request_id = f"subcategory_scope_{int(time.time() * 1000)}"
    ctx = _resolve_context(payload)
    components = _resolve_components(payload)
    min_count = max(3, min(8, _coerce_int(payload.get("min_scope_count") or payload.get("minScopeCount"), 3)))
    max_count = max(min_count, min(8, _coerce_int(payload.get("max_scope_count") or payload.get("maxScopeCount"), 8)))

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
        parsed, usage = _run_once(
            ctx=ctx,
            components=components,
            min_count=min_count,
            max_count=max_count,
            retry_hint=retry_hint,
        )
        last_usage = usage or last_usage
        if not isinstance(parsed, dict):
            last_error = "invalid_json"
            retry_hint = 'Return JSON only: {"scopes": ["...", "..."]} with between 3 and 8 strings.'
            continue

        scopes_raw = parsed.get("scopes")
        if not isinstance(scopes_raw, list):
            last_error = "missing_scopes_array"
            retry_hint = 'The JSON must include key "scopes" with an array of strings.'
            continue

        scopes = _normalize_scope_strings(scopes_raw, max_items=max_count)
        if len(scopes) < min_count:
            last_error = "too_few_scopes"
            retry_hint = f"Need at least {min_count} distinct, concrete scope labels (got {len(scopes)})."
            continue
        if len(scopes) > max_count:
            scopes = scopes[:max_count]

        return {
            "ok": True,
            "requestId": request_id,
            "source": "dspy_subcategory_scope_suggester",
            "scopes": scopes,
            "lmUsage": last_usage,
            "minScopeCount": min_count,
            "maxScopeCount": max_count,
        }

    return {
        "ok": False,
        "error": last_error or "scope_suggest_failed",
        "message": "Could not produce a valid scope list.",
        "requestId": request_id,
        "lmUsage": last_usage,
    }


__all__ = ["suggest_subcategory_scope"]
