"""
Refinements orchestrator: generates refinement questions for post-concept exploration.

Same payload shape as next_steps; uses RefinementsPlannerProgram instead of QuestionPlanner.
"""

from __future__ import annotations

import json
import os
import time
from typing import Any, Dict, List

from programs.form_pipeline.context_builder import build_context
from programs.question_planner.plan_parsing import derive_step_id_from_key, normalize_plan_key
from programs.refinements.program import RefinementsPlannerProgram


def _compact_json(obj: object) -> str:
    return json.dumps(obj, ensure_ascii=True, separators=(",", ":"), sort_keys=True)


def _coerce_int(value: Any, default: int) -> int:
    try:
        if isinstance(value, dict):
            # Be resilient to nested shapes from context builder.
            for k in ("value", "max", "target", "count"):
                if k in value:
                    return int(value.get(k))
            return default
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


def _make_refinements_lm_cfg() -> Dict[str, Any] | None:
    model_raw = (
        os.getenv("DSPY_REFINEMENTS_MODEL")
        or os.getenv("DSPY_PLANNER_MODEL")
        or os.getenv("DSPY_MODEL")
        or ""
    ).strip()
    if not model_raw:
        return None
    provider = (os.getenv("DSPY_PROVIDER") or "").strip().lower()
    model = model_raw if "/" in model_raw or not provider else f"{provider}/{model_raw}"
    return {
        "model": model,
        "temperature": _coerce_float(
            os.getenv("DSPY_REFINEMENTS_TEMPERATURE") or os.getenv("DSPY_PLANNER_TEMPERATURE"),
            0.7,
        ),
        "max_tokens": _coerce_int(os.getenv("DSPY_REFINEMENTS_MAX_TOKENS") or os.getenv("DSPY_PLANNER_MAX_TOKENS"), 2048),
        "timeout": float(os.getenv("DSPY_REFINEMENTS_TIMEOUT") or os.getenv("DSPY_PLANNER_TIMEOUT") or 30),
    }


def _build_refinement_planner_context(ctx: Dict[str, Any], asked_ids: set[str]) -> Dict[str, Any]:
    refinement_catalog = ctx.get("refinement_catalog") if isinstance(ctx.get("refinement_catalog"), list) else []
    return {
        "services_summary": str(ctx.get("services_summary") or ctx.get("grounding_summary") or "").strip(),
        "answered_qa": ctx.get("answered_qa") if isinstance(ctx.get("answered_qa"), list) else [],
        "asked_step_ids": sorted(list(asked_ids)),
        "industry": str(ctx.get("industry") or "").strip(),
        "service": str(ctx.get("service") or "").strip(),
        "refinement_catalog": [
            {
                "key": str(item.get("key") or "").strip(),
                "label": str(item.get("label") or "").strip(),
                "priority": int(item.get("priority") or 0),
                "option_labels": [
                    str(opt.get("label") or "").strip()
                    for opt in (item.get("options") or [])
                    if isinstance(opt, dict) and str(opt.get("label") or "").strip()
                ],
            }
            for item in refinement_catalog
            if isinstance(item, dict) and str(item.get("key") or "").strip()
        ],
    }


def _fallback_question_for_label(label: str) -> str:
    cleaned = str(label or "").strip()
    if not cleaned:
        return "Which option should we try next?"
    return f"Which {cleaned.lower()} option should we try next?"


def _render_refinement_catalog_steps(
    plan: List[Dict[str, Any]],
    *,
    catalog: List[Dict[str, Any]],
    asked_ids: set[str],
    max_steps: int,
) -> List[Dict[str, Any]]:
    catalog_by_key = {
        normalize_plan_key(item.get("key")): item
        for item in catalog
        if isinstance(item, dict) and normalize_plan_key(item.get("key"))
    }
    emitted: List[Dict[str, Any]] = []
    seen_keys: set[str] = set()

    for item in plan or []:
        if len(emitted) >= max_steps:
            break
        if not isinstance(item, dict):
            continue
        component_key = normalize_plan_key(item.get("component_key") or item.get("key"))
        if not component_key or component_key in seen_keys or component_key not in catalog_by_key:
            continue
        step_id = derive_step_id_from_key(component_key)
        if step_id in asked_ids:
            continue
        catalog_item = catalog_by_key[component_key]
        options = catalog_item.get("options") if isinstance(catalog_item.get("options"), list) else []
        if len(options) < 2:
            continue
        question = str(item.get("question") or "").strip() or _fallback_question_for_label(str(catalog_item.get("label") or ""))
        emitted.append(
            {
                "id": step_id,
                "type": "image_choice_grid",
                "question": question,
                "options": options,
            }
        )
        seen_keys.add(component_key)

    if emitted:
        return emitted

    fallback_catalog = sorted(
        [item for item in catalog if isinstance(item, dict)],
        key=lambda item: (int(item.get("priority") or 999), str(item.get("label") or "")),
    )
    for catalog_item in fallback_catalog:
        if len(emitted) >= max_steps:
            break
        component_key = normalize_plan_key(catalog_item.get("key"))
        if not component_key:
            continue
        step_id = derive_step_id_from_key(component_key)
        if step_id in asked_ids:
            continue
        options = catalog_item.get("options") if isinstance(catalog_item.get("options"), list) else []
        if len(options) < 2:
            continue
        emitted.append(
            {
                "id": step_id,
                "type": "image_choice_grid",
                "question": _fallback_question_for_label(str(catalog_item.get("label") or "")),
                "options": options,
            }
        )
    return emitted


def refinements_jsonl(payload: Dict[str, Any]) -> Dict[str, Any]:
    """
    Generate refinement miniSteps for post-concept exploration.
    Same payload shape as next_steps_jsonl.
    """
    request_id = f"refinements_{int(time.time() * 1000)}"
    start_time = time.time()

    try:
        ctx = build_context(payload)
    except Exception as e:
        return {
            "ok": False,
            "error": str(e),
            "requestId": request_id,
            "schemaVersion": "0",
        }

    asked_ids = set(str(x).strip() for x in (ctx.get("asked_step_ids") or []) if str(x).strip())
    refinement_catalog = ctx.get("refinement_catalog") if isinstance(ctx.get("refinement_catalog"), list) else []
    if not refinement_catalog:
        return {
            "ok": True,
            "requestId": request_id,
            "schemaVersion": "1",
            "miniSteps": [],
        }
    batch_constraints = ctx.get("batch_constraints") if isinstance(ctx.get("batch_constraints"), dict) else {}
    max_steps_raw = batch_constraints.get("maxStepsTotal", 8)
    max_steps = min(len(refinement_catalog), max(1, min(10, _coerce_int(max_steps_raw, len(refinement_catalog) or 1))))
    allowed_mini_types = ["image_choice_grid"]

    planner_context_json = _compact_json(_build_refinement_planner_context(ctx, asked_ids))

    import dspy

    planner_lm_cfg = _make_refinements_lm_cfg()
    if not planner_lm_cfg:
        return {"ok": False, "error": "LM not configured", "requestId": request_id, "schemaVersion": "0"}

    planner_lm = dspy.LM(
        model=planner_lm_cfg["model"],
        temperature=float(planner_lm_cfg.get("temperature", 0.7)),
        max_tokens=int(planner_lm_cfg.get("max_tokens", 2048)),
        timeout=float(planner_lm_cfg.get("timeout", 30)),
    )

    program = RefinementsPlannerProgram()
    with dspy.context(lm=planner_lm):
        pred = program(
            planner_context_json=planner_context_json,
            max_steps=max_steps,
            allowed_mini_types=allowed_mini_types,
        )

    raw = str(getattr(pred, "refinement_plan_json", "") or "").strip()
    if not raw:
        emitted = _render_refinement_catalog_steps(
            [],
            catalog=refinement_catalog,
            asked_ids=asked_ids,
            max_steps=max_steps,
        )
        return {
            "ok": True,
            "requestId": request_id,
            "schemaVersion": "1",
            "miniSteps": emitted,
        }

    try:
        parsed = json.loads(raw)
        plan = parsed.get("plan") if isinstance(parsed, dict) else []
    except Exception:
        plan = []

    if not isinstance(plan, list) or not plan:
        emitted = _render_refinement_catalog_steps(
            [],
            catalog=refinement_catalog,
            asked_ids=asked_ids,
            max_steps=max_steps,
        )
        return {
            "ok": True,
            "requestId": request_id,
            "schemaVersion": "1",
            "miniSteps": emitted,
        }

    plan_items: List[Dict[str, Any]] = []
    for item in plan:
        if not isinstance(item, dict):
            continue
        component_key = normalize_plan_key(item.get("component_key") or item.get("key"))
        if not component_key:
            continue
        plan_items.append(dict(item, component_key=component_key))
        if len(plan_items) >= max_steps:
            break

    emitted = _render_refinement_catalog_steps(
        plan_items,
        catalog=refinement_catalog,
        asked_ids=asked_ids,
        max_steps=max_steps,
    )

    latency_ms = int((time.time() - start_time) * 1000)
    if os.getenv("AI_FORM_DEBUG") == "true":
        print(f"[Refinements] requestId={request_id} steps={len(emitted)} latencyMs={latency_ms}", flush=True)

    return {
        "ok": True,
        "requestId": request_id,
        "schemaVersion": "1",
        "miniSteps": emitted,
    }


__all__ = ["refinements_jsonl"]
