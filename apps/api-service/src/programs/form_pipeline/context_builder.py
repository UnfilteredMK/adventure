"""
Form pipeline helper: build the model-facing `context` dict from request payload.

Used by the orchestrator to create the compact planner/render context:
- service context (industry/service + summaries)
- memory (answered_qa, asked_step_ids)
- batch constraints + UI hint bounds (choice option count targets)

This module consolidates the old `service_context.py` helpers as well, since
they are only used here.
"""

from __future__ import annotations

import json
import random
import hashlib
from typing import Any, Dict, List, Tuple

from programs.form_pipeline.constraints import (
    build_batch_constraints,
    extract_form_state_subset,
    resolve_backend_max_calls,
)
from api.payload_extractors import extract_answered_qa, extract_asked_step_ids
from api.payload_extractors import extract_session_id
from programs.question_planner.budget_bounds import infer_budget_bounds_hint
from programs.question_planner.copywriting import build_copy_context


def derive_industry_and_service_strings(
    payload: Dict[str, Any],
    *,
    max_len: int = 120,
) -> Tuple[str, str]:
    """
    Derive short, plain-English industry/service strings.

    Modern shape: top-level `industry` and `service` (plus `vertical` alias for industry).
    """
    industry = str(payload.get("industry") or payload.get("vertical") or "").strip()
    service = str(payload.get("service") or "").strip()

    # Widget/contract shape: nested instanceContext objects.
    if (not industry or not service) and isinstance(payload.get("instanceContext"), dict):
        ctx = payload.get("instanceContext") or {}
        if isinstance(ctx, dict):
            if not industry:
                raw_ind = ctx.get("industry") or (
                    ctx.get("categories")[0] if isinstance(ctx.get("categories"), list) and ctx.get("categories") else None
                )
                if isinstance(raw_ind, dict):
                    industry = str(raw_ind.get("name") or raw_ind.get("label") or raw_ind.get("id") or "").strip()
                else:
                    industry = str(raw_ind or "").strip()
            if not service:
                raw_svc = ctx.get("service") or (
                    ctx.get("subcategories")[0] if isinstance(ctx.get("subcategories"), list) and ctx.get("subcategories") else None
                )
                if isinstance(raw_svc, dict):
                    service = str(raw_svc.get("name") or raw_svc.get("label") or raw_svc.get("id") or "").strip()
                else:
                    service = str(raw_svc or "").strip()

    # Snake_case alias
    if (not industry or not service) and isinstance(payload.get("instance_context"), dict):
        ctx = payload.get("instance_context") or {}
        if isinstance(ctx, dict):
            if not industry:
                raw_ind = ctx.get("industry") or (
                    ctx.get("categories")[0] if isinstance(ctx.get("categories"), list) and ctx.get("categories") else None
                )
                if isinstance(raw_ind, dict):
                    industry = str(raw_ind.get("name") or raw_ind.get("label") or raw_ind.get("id") or "").strip()
                else:
                    industry = str(raw_ind or "").strip()
            if not service:
                raw_svc = ctx.get("service") or (
                    ctx.get("subcategories")[0] if isinstance(ctx.get("subcategories"), list) and ctx.get("subcategories") else None
                )
                if isinstance(raw_svc, dict):
                    service = str(raw_svc.get("name") or raw_svc.get("label") or raw_svc.get("id") or "").strip()
                else:
                    service = str(raw_svc or "").strip()

    industry = industry[:max_len]
    service = service[:max_len]
    return industry, service


def _coerce_text(raw: Any) -> str:
    if raw is None:
        return ""
    if isinstance(raw, (dict, list)):
        try:
            raw = json.dumps(raw, ensure_ascii=True)
        except Exception:
            raw = str(raw)
    return str(raw).strip()


def extract_service_summary(payload: Dict[str, Any], *, max_len: int = 1200) -> str:
    """
    Extract a plain-text service summary from a request payload.

    Accepted keys (new + back-compat):
      - `service_summary` / `serviceSummary` (preferred)
      - `services_summary` / `servicesSummary` (legacy)
    """
    text = _coerce_text(
        payload.get("service_summary")
        or payload.get("serviceSummary")
        or payload.get("services_summary")
        or payload.get("servicesSummary")
    )
    if not text:
        # Widget/back-compat: some callers stash these inside `instanceContext` (or `instance_context`).
        for k in ("instanceContext", "instance_context"):
            ctx = payload.get(k)
            if isinstance(ctx, dict):
                text = _coerce_text(
                    ctx.get("service_summary")
                    or ctx.get("serviceSummary")
                    or ctx.get("services_summary")
                    or ctx.get("servicesSummary")
                )
                if text:
                    break
    if text:
        return text[: int(max_len or 0) or 1200]
    return ""


def extract_company_summary(payload: Dict[str, Any], *, max_len: int = 1200) -> str:
    """
    Extract a plain-text company summary from a request payload.

    Accepted keys:
      - `company_summary` / `companySummary`
    """
    text = _coerce_text(payload.get("company_summary") or payload.get("companySummary"))
    if not text:
        for k in ("instanceContext", "instance_context"):
            ctx = payload.get(k)
            if isinstance(ctx, dict):
                text = _coerce_text(ctx.get("company_summary") or ctx.get("companySummary"))
                if text:
                    break
    if text:
        return text[: int(max_len or 0) or 1200]
    return ""


def _coerce_priority(raw: Any, fallback: int) -> int:
    try:
        value = int(raw)
        return max(1, value)
    except Exception:
        return fallback


def _extract_refinement_catalog_raw(payload: Dict[str, Any]) -> List[dict]:
    raw = payload.get("refinementCatalog") or payload.get("refinement_catalog")
    if isinstance(raw, list):
        return [item for item in raw if isinstance(item, dict)]

    for container_key in ("instanceContext", "instance_context"):
        ctx = payload.get(container_key)
        if not isinstance(ctx, dict):
            continue
        service = ctx.get("service")
        if isinstance(service, dict):
            raw = service.get("refinementCatalog") or service.get("refinement_catalog")
            if isinstance(raw, list):
                return [item for item in raw if isinstance(item, dict)]
    return []


def extract_refinement_catalog(
    payload: Dict[str, Any],
    *,
    max_items: int = 10,
    max_options_per_item: int = 8,
) -> List[dict]:
    raw_items = _extract_refinement_catalog_raw(payload)
    if not raw_items:
        return []

    seen_keys: set[str] = set()
    normalized: List[dict] = []
    for index, raw_item in enumerate(raw_items, start=1):
        key = str(raw_item.get("key") or "").strip()
        label = str(raw_item.get("label") or key).strip()
        if not key or key in seen_keys:
            continue

        raw_options = raw_item.get("options")
        options: List[dict] = []
        seen_option_values: set[str] = set()
        if isinstance(raw_options, list):
            for raw_opt in raw_options:
                if not isinstance(raw_opt, dict):
                    continue
                opt_label = str(raw_opt.get("label") or "").strip()
                opt_value = str(raw_opt.get("value") or opt_label).strip()
                image_url = str(raw_opt.get("imageUrl") or raw_opt.get("image_url") or "").strip()
                if not opt_label or not opt_value or not image_url:
                    continue
                dedupe_key = opt_value.lower()
                if dedupe_key in seen_option_values:
                    continue
                seen_option_values.add(dedupe_key)
                options.append(
                    {
                        "label": opt_label[:120],
                        "value": opt_value[:120],
                        "imageUrl": image_url[:1000],
                    }
                )
                if len(options) >= max_options_per_item:
                    break

        if len(options) < 2:
            continue

        seen_keys.add(key)
        normalized.append(
            {
                "key": key[:120],
                "label": label[:120] if label else key[:120],
                "priority": _coerce_priority(raw_item.get("priority"), index),
                "options": options,
            }
        )
        if len(normalized) >= max_items:
            break

    return sorted(normalized, key=lambda item: (int(item.get("priority") or 999), str(item.get("label") or "")))


def infer_goal_intent(*, services_summary: str = "", explicit_goal_intent: str = "") -> str:
    """
    Decide between "pricing" vs "visual" intent.

    Prefer explicit `goal_intent` from payload; otherwise default to "pricing".
    """
    _ = services_summary  # reserved for future heuristic scoring
    t = str(explicit_goal_intent or "").strip().lower()
    if t in {"pricing", "visual"}:
        return t
    return "pricing"


def build_context(payload: Dict[str, Any]) -> Dict[str, Any]:
    """
    Build the minimal context dict used by the form pipeline.

    Assumes a single modern payload shape (top-level fields, minimal camel/snake aliasing).
    """
    current_batch = payload.get("currentBatch") if isinstance(payload.get("currentBatch"), dict) else {}

    required_uploads_raw = (
        payload.get("requiredUploads") or payload.get("required_uploads") or current_batch.get("requiredUploads") or []
    )
    required_uploads = required_uploads_raw if isinstance(required_uploads_raw, list) else []

    answered_qa = extract_answered_qa(payload)
    asked_step_ids = extract_asked_step_ids(payload, answered_qa=answered_qa)

    batch_state_raw = payload.get("batchState") or payload.get("batch_state") or {}
    batch_state = batch_state_raw if isinstance(batch_state_raw, dict) else {}

    # Frontend-provided sources of truth (preferred).
    service_summary = extract_service_summary(payload)
    company_summary = extract_company_summary(payload)
    if service_summary:
        service_summary = service_summary[:1200]
    if company_summary:
        company_summary = company_summary[:1200]

    # Back-compat internal naming: most prompts still refer to `services_summary`.
    services_summary = service_summary[:600] if service_summary else ""
    refinement_catalog = extract_refinement_catalog(payload)

    industry, service = derive_industry_and_service_strings(payload)
    goal_intent = infer_goal_intent(
        services_summary=services_summary,
        explicit_goal_intent=str(payload.get("goalIntent") or payload.get("goal_intent") or ""),
    )

    model_batch = extract_form_state_subset(payload, batch_state)
    backend_max_calls = resolve_backend_max_calls()
    model_batch = dict(model_batch)
    model_batch["max_batches"] = backend_max_calls
    batch_constraints = build_batch_constraints(payload=payload, batch_state=batch_state, max_batches=backend_max_calls)

    # Choice option bounds (UI-only hinting)
    # Scene/design flows: style grid needs 10-20 options; default to that when useCase is scene.
    use_case = str(payload.get("useCase") or payload.get("use_case") or "").strip().lower()
    is_scene_flow = "scene" in use_case or not use_case
    _default_min, _default_max = (10, 20) if is_scene_flow else (4, 10)
    choice_option_min = _default_min
    choice_option_max = _default_max
    try:
        raw_min = payload.get("choiceOptionMin") or payload.get("choice_option_min")
        raw_max = payload.get("choiceOptionMax") or payload.get("choice_option_max")
        if raw_min is not None:
            choice_option_min = max(2, min(20, int(raw_min)))
        if raw_max is not None:
            choice_option_max = max(choice_option_min, min(20, int(raw_max)))
    except Exception:
        choice_option_min, choice_option_max = _default_min, _default_max

    choice_option_target = None
    try:
        raw_target = payload.get("choiceOptionTarget") or payload.get("choice_option_target")
        if raw_target is not None:
            choice_option_target = int(raw_target)
    except Exception:
        choice_option_target = None
    if not isinstance(choice_option_target, int) or not (choice_option_min <= choice_option_target <= choice_option_max):
        # Seeded determinism: ensure targets are stable per session/model so steps don't reshuffle
        # within a session, but can vary across sessions ("choose your own adventure" feel).
        instance_id = str(payload.get("instanceId") or payload.get("instance_id") or "").strip()
        if not instance_id and isinstance(payload.get("session"), dict):
            instance_id = str((payload.get("session") or {}).get("instanceId") or "").strip()
        session_id = str(extract_session_id(payload) or "").strip()
        # Include model/version so upgrades change the "adventure" deterministically.
        model_hint = (
            str(payload.get("model") or payload.get("modelId") or "").strip()
            or str(payload.get("dspyModel") or "").strip()
            or str(payload.get("DSPY_MODEL_LOCK") or "").strip()
        )
        # Fall back to env locks commonly used in this service.
        if not model_hint:
            model_hint = str(
                payload.get("dspy_model_lock")
                or payload.get("dspyModelLock")
                or ""
            ).strip()
        if not model_hint:
            model_hint = str(
                (payload.get("plannerModel") or "")
            ).strip()
        if not model_hint:
            import os

            model_hint = str(os.getenv("DSPY_PLANNER_MODEL_LOCK") or os.getenv("DSPY_PLANNER_MODEL") or os.getenv("DSPY_MODEL_LOCK") or os.getenv("DSPY_MODEL") or "").strip()
        seed_material = f"{instance_id}|{session_id}|{model_hint}|choice_option_target|{choice_option_min}|{choice_option_max}"
        seed_bytes = hashlib.sha256(seed_material.encode("utf-8")).digest()
        seed_int = int.from_bytes(seed_bytes[:8], "big", signed=False)
        rng = random.Random(seed_int)
        choice_option_target = rng.randint(choice_option_min, choice_option_max)

    budget_bounds_hint = infer_budget_bounds_hint(
        industry=industry,
        service=service,
        services_summary=services_summary or "",
    )

    ctx: Dict[str, Any] = {
        # Service context
        "industry": industry,
        "service": service,
        "services_summary": services_summary or "",
        "service_summary": service_summary or "",
        "company_summary": company_summary or "",
        "refinement_catalog": refinement_catalog,
        "budget_bounds_hint": budget_bounds_hint,
        # Back-compat internal alias
        "grounding_summary": services_summary or "",
        # Memory for dedupe/continuity
        "answered_qa": answered_qa,
        "asked_step_ids": asked_step_ids,
        "already_asked_keys": asked_step_ids,
        # Server-side flow/enforcement
        "goal_intent": goal_intent,
        "required_uploads": required_uploads,
        "batch_info": model_batch,
        "batch_constraints": batch_constraints,
        "batch_state": batch_state,
        "choice_option_min": choice_option_min,
        "choice_option_max": choice_option_max,
        "choice_option_target": choice_option_target,
        "prefer_structured_inputs": False,
    }

    if services_summary:
        ctx["vertical_context"] = services_summary

    # Copywriting/Form-Intelligence prompt conditioning for the planner.
    #
    # This is NOT used as a heuristic scoring system. It's a compact prompt context
    # that shapes question wording (tone, reassurance, momentum, etc.).
    try:
        ctx["copy_context"] = build_copy_context(payload=payload, ctx=ctx)
    except Exception:
        ctx["copy_context"] = {}

    return ctx


__all__ = [
    "build_context",
    # exported for reuse/testing (formerly in service_context.py)
    "derive_industry_and_service_strings",
    "extract_company_summary",
    "extract_refinement_catalog",
    "extract_service_summary",
    "infer_goal_intent",
]
