"""
Form pipeline orchestrator (Planner -> Deterministic Render).
"""

from __future__ import annotations

import contextlib
import json
import os
import sys
import time
import warnings
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

from programs.common.dspy_runtime import configure_dspy, extract_dspy_usage, make_dspy_lm_for_module
from programs.common.env import env_bool, env_float, env_int
from programs.common.hashing import short_hash
from programs.common.rate_limits import estimate_tokens_from_text, reserve_planner_budget, extract_provider_rate_headers
from programs.common.ttl_cache import ttl_cache_get, ttl_cache_set
from programs.form_pipeline.allowed_types import (
    allowed_type_matches,
    ensure_allowed_mini_types,
    extract_allowed_mini_types_from_payload,
    prefer_structured_allowed_mini_types,
)
from programs.form_pipeline.constraints import extract_token_budget
from programs.form_pipeline.context_builder import build_context
from programs.form_pipeline.utils import _compact_json
from programs.question_planner.cache import planner_cache_key
from programs.question_planner.plan_parsing import derive_step_id_from_key, extract_plan_items, normalize_plan_key
from programs.question_planner.program import QuestionPlannerProgram
from programs.question_planner.renderer.cache import render_cache_key
from programs.question_planner.renderer.plan_to_steps import render_plan_items_to_mini_steps
from programs.question_planner.renderer.sanitize import sanitize_steps
from programs.question_planner.renderer.validation import (
    _extract_required_upload_ids,
    _looks_like_upload_step_id,
    _reject_banned_option_sets,
    _validate_mini,
)
from api.payload_extractors import extract_session_id

# Plan keys for which we convert multiple_choice to image_choice_grid (option images).
_OPTION_IMAGE_STEP_KEYS: frozenset[str] = frozenset({
    "style_direction",
    "material_preference",
    "material_type",
    "finish_style",
    "color_tone",
    "color_palette",
    "lighting_needs",
    "shape",
    "type",
})

# Heuristic: most "visualizable" multiple_choice steps should be image grids.
# We keep a small denylist for clearly non-visual planner keys.
_OPTION_IMAGE_KEY_DENY_SUBSTRINGS: tuple[str, ...] = (
    "priority_",
    "inspiration_source",
    "lead_capture",
    "contact",
    "schedule",
    "timeline",
    "budget",
    "pricing",
)
_OPTION_IMAGE_KEY_ALLOW_SUBSTRINGS: tuple[str, ...] = (
    "style",
    "direction",
    "color",
    "palette",
    "tone",
    "finish",
    "material",
    "shape",
    "type",
    "pattern",
    "texture",
    "look",
    "vibe",
    "lighting",
    "fixture",
    "hardware",
    "cabinet",
    "backsplash",
    "tile",
    "countertop",
    "flooring",
    "sink",
    "faucet",
    "vanity",
    "mirror",
    "appliance",
    "seating",
    "sofa",
    "rug",
    "desk",
    "storage",
    "landscaping",
    "planting",
    "deck",
    "patio",
)
# Skip generating an image for options whose label matches these (case-insensitive substring).
_OPTION_IMAGE_SKIP_LABEL_PATTERNS: tuple[str, ...] = (
    "other",
    "not sure",
    "no preference",
    "no strong preference",
)


# Suppress Pydantic serialization warnings from LiteLLM
warnings.filterwarnings(
    "ignore",
    message=".*PydanticSerializationUnexpectedValue.*",
    category=UserWarning,
    module=r"pydantic(\..*)?$",
)
warnings.filterwarnings(
    "ignore",
    message=".*Pydantic serializer warnings:.*",
    category=UserWarning,
    module=r"pydantic(\..*)?$",
)


_PLANNER_PLAN_CACHE: dict[str, tuple[float, str]] = {}
_RENDER_OUTPUT_CACHE: dict[str, tuple[float, List[Dict[str, Any]]]] = {}


def _repo_root() -> Path:
    return Path(__file__).resolve().parents[3]


def _best_effort_contract_schema_version() -> str:
    try:
        root = _repo_root()
        # Monorepo-first: walk upward so both legacy and apps/* layouts resolve.
        for base in (root, *root.parents):
            p_shared_api = base / "shared" / "api" / "ai-form-ui-contract" / "schema" / "schema_version.txt"
            if p_shared_api.exists():
                v = p_shared_api.read_text(encoding="utf-8").strip()
                return v or "0"
            p_pkg = base / "packages" / "ai-form-ui-contract" / "schema" / "schema_version.txt"
            if p_pkg.exists():
                v = p_pkg.read_text(encoding="utf-8").strip()
                return v or "0"

        # Standalone service: vendored under shared/
        p_new = root / "shared" / "ai-form-ui-contract" / "schema" / "schema_version.txt"
        if p_new.exists():
            v = p_new.read_text(encoding="utf-8").strip()
            return v or "0"

        p_old = root / "shared" / "ai-form-contract" / "schema" / "schema_version.txt"
        if p_old.exists():
            v = p_old.read_text(encoding="utf-8").strip()
            return v or "0"
    except Exception:
        pass
    return "0"


def _make_dspy_lm() -> Optional[Dict[str, str]]:
    """
    Return a LiteLLM model string for DSPy v3 (provider-prefixed), or None if not configured.
    """
    # Legacy behavior: use the planner env prefix and keep the small-model guard on.
    return make_dspy_lm_for_module(module_env_prefix="DSPY_PLANNER", allow_small_models=False)


def _configure_dspy(lm: Any) -> bool:
    return configure_dspy(lm)


# Back-compat for scripts importing cache key helpers from this module.
def _planner_cache_key(*, session_id: str, services_fingerprint: str) -> str:
    return planner_cache_key(session_id=session_id, services_fingerprint=services_fingerprint)


def _render_cache_key(
    *,
    session_id: str,
    schema_version: str,
    plan_json: str,
    render_context_json: str,
    allowed_mini_types: List[str],
) -> str:
    return render_cache_key(
        session_id=session_id,
        schema_version=schema_version,
        plan_json=plan_json,
        render_context_json=render_context_json,
        allowed_mini_types=allowed_mini_types,
    )


def _should_skip_option_image_for_label(label: str) -> bool:
    """Skip image for 'Other', 'Not sure', long/abstract options."""
    if not label or not isinstance(label, str):
        return True
    t = label.strip().lower()
    if len(t) > 80:
        return True
    return any(p in t for p in _OPTION_IMAGE_SKIP_LABEL_PATTERNS)


def _should_convert_step_key_to_option_images(key: str) -> bool:
    """
    Decide whether a plan key should be converted to image_choice_grid.

    Defaults:
    - Explicit allowlist always converts.
    - If AI_FORM_OPTION_IMAGES_ALL_STEPS is true, convert everything except denylist keys.
    - Otherwise, convert keys that look visualizable (style/material/color/etc.), except denylist keys.
    """
    k = str(key or "").strip().lower()
    if not k:
        return False
    if k in _OPTION_IMAGE_STEP_KEYS:
        return True
    if any(d in k for d in _OPTION_IMAGE_KEY_DENY_SUBSTRINGS):
        return False
    if env_bool("AI_FORM_OPTION_IMAGES_ALL_STEPS", False):
        return True
    return any(s in k for s in _OPTION_IMAGE_KEY_ALLOW_SUBSTRINGS)


def _convert_option_images_for_steps(
    parsed_steps: List[Dict[str, Any]],
    sliced: List[Dict[str, Any]],
    ctx: Dict[str, Any],
    *,
    session_id: str,
) -> Dict[str, int]:
    """
    Mutate parsed_steps: for whitelisted multiple_choice steps, build prompts from
    context_prompt + Option: {label}. Photorealistic, no text., call flux-schnell
    (one logical call per step via generate_option_images_for_step), set imageUrl
    and type image_choice_grid.
    """
    from programs.image_generator.providers.image_generation import generate_option_images_for_step

    # Deterministic seeding base: stable within a session; shifts when option-image model changes.
    model_id = str(os.getenv("REPLICATE_OPTION_IMAGES_MODEL_ID") or "black-forest-labs/flux-schnell").strip()
    seed_base = f"{str(session_id or '').strip()}|{model_id}"

    step_id_to_key: Dict[str, str] = {}
    for item in sliced:
        if not isinstance(item, dict):
            continue
        key = normalize_plan_key(item.get("key"))
        if key:
            sid = derive_step_id_from_key(key)
            if sid:
                step_id_to_key[sid] = key

    service_str = str(
        ctx.get("service")
        or ctx.get("industry")
        or ctx.get("services_summary")
        or ctx.get("grounding_summary")
        or "Service"
    ).strip() or "Service"

    agg: Dict[str, int] = {"stepsConverted": 0, "optionsAttempted": 0, "cacheHits": 0, "succeeded": 0, "failed": 0}

    try:
        from programs.image_generator.image_prompt_library import build_option_image_prompt as _build_opt_prompt
    except Exception:
        _build_opt_prompt = None

    max_opts = env_int("AI_FORM_OPTION_IMAGES_MAX_OPTIONS", 8)

    # Collect work items for all eligible steps, then generate images in parallel.
    StepWork = List[Dict[str, Any]]  # noqa: N806 (local type alias)
    step_work: List[Dict[str, Any]] = []

    for step in parsed_steps:
        if not isinstance(step, dict):
            continue
        sid = str(step.get("id") or "").strip()
        if not sid:
            continue
        key = step_id_to_key.get(sid)
        if not key or not _should_convert_step_key_to_option_images(key):
            continue
        step_type = str(step.get("type") or "").strip().lower()
        if step_type not in {"multiple_choice", "image_choice_grid"}:
            continue
        options = step.get("options")
        if not isinstance(options, list) or not options:
            continue
        if len(options) > 10 and not env_bool("AI_FORM_OPTION_IMAGES_ALL_STEPS", False):
            continue
        question = str(step.get("question") or "").strip() or "Choose an option."
        context_hint = f"{service_str} - {question}"
        prompts: List[str] = []
        indices_to_fill: List[int] = []

        for i, opt in enumerate(options):
            if not isinstance(opt, dict):
                continue
            label = str(opt.get("label") or opt.get("value") or "").strip()
            if _should_skip_option_image_for_label(label):
                continue
            if len(indices_to_fill) >= max_opts and not env_bool("AI_FORM_OPTION_IMAGES_ALL_STEPS", False):
                break
            prompt_text = str(opt.get("image_prompt") or opt.get("imagePrompt") or label).strip()
            if callable(_build_opt_prompt):
                prompts.append(_build_opt_prompt(prompt_text, context_hint))
            else:
                prompts.append(
                    f"A photorealistic close-up photograph of {prompt_text}. "
                    f"Context: {context_hint}. "
                    f"Clean background, sharp focus, professional product photography. "
                    f"No text, no labels, no watermarks."
                )
            indices_to_fill.append(i)
        if prompts:
            step_work.append({
                "step": step,
                "step_type": step_type,
                "prompts": prompts,
                "indices_to_fill": indices_to_fill,
            })

    if not step_work:
        return agg

    # Generate images for all steps concurrently using threads.
    import concurrent.futures

    def _generate_for_step(work: Dict[str, Any]) -> Dict[str, Any]:
        try:
            urls, stats = generate_option_images_for_step(
                work["prompts"], model_id=model_id, seed_base=seed_base,
            )
            return {**work, "urls": urls, "stats": stats, "error": None}
        except Exception as exc:
            return {**work, "urls": [], "stats": {}, "error": exc}

    with concurrent.futures.ThreadPoolExecutor(max_workers=min(len(step_work), 4)) as pool:
        results = list(pool.map(_generate_for_step, step_work))

    for result in results:
        step = result["step"]
        step_type = result["step_type"]
        urls = result["urls"]
        stats = result["stats"]
        indices_to_fill = result["indices_to_fill"]
        options = step.get("options", [])

        if result["error"] is not None:
            if step_type == "image_choice_grid":
                step["type"] = "multiple_choice"
            continue
        if isinstance(stats, dict):
            for k in ("optionsAttempted", "cacheHits", "succeeded", "failed"):
                try:
                    agg[k] += int(stats.get(k) or 0)
                except Exception:
                    pass
        if not any(u for u in urls):
            if step_type == "image_choice_grid":
                step["type"] = "multiple_choice"
            continue
        for k, idx in enumerate(indices_to_fill):
            if k < len(urls) and urls[k] and idx < len(options) and isinstance(options[idx], dict):
                options[idx]["imageUrl"] = urls[k]
        step["type"] = "image_choice_grid"
        agg["stepsConverted"] += 1

    return agg


def _include_response_meta(payload: Dict[str, Any]) -> bool:
    if os.getenv("AI_FORM_INCLUDE_META") == "true":
        return True
    req = payload.get("request") if isinstance(payload.get("request"), dict) else {}
    return bool(req.get("includeMeta") is True or str(req.get("includeMeta") or "").lower() == "true")


def _print_lm_history_if_available(lm: Any, n: int = 1) -> None:
    try:
        inspect_fn = getattr(lm, "inspect_history", None)
        if not callable(inspect_fn):
            return
        with contextlib.redirect_stdout(sys.stderr):
            inspect_fn(n=n)
    except Exception:
        return


def _resolve_max_plan_items(ctx: Dict[str, Any]) -> int:
    constraints = ctx.get("batch_constraints") if isinstance(ctx.get("batch_constraints"), dict) else {}
    raw = constraints.get("maxStepsTotal") or constraints.get("max_steps_total")
    try:
        n = int(raw) if raw is not None else 0
    except Exception:
        n = 0
    n = max(4, min(30, int(n or 12)))
    return n


def _resolve_max_steps_this_call(payload: Dict[str, Any], ctx: Dict[str, Any]) -> int:
    """
    Per-call step cap.

    Order of precedence:
    1) explicit payload override (maxStepsThisCall)
    2) batch_constraints defaults (default/min/max steps per batch)
    """
    try:
        explicit = int(payload.get("maxStepsThisCall") or payload.get("max_steps_this_call") or 0)
    except Exception:
        explicit = 0
    if explicit > 0:
        return max(1, min(30, explicit))

    constraints = ctx.get("batch_constraints") if isinstance(ctx.get("batch_constraints"), dict) else {}
    try:
        default_steps = int(constraints.get("defaultStepsPerBatch") or 0)
    except Exception:
        default_steps = 0
    try:
        min_steps = int(constraints.get("minStepsPerBatch") or 0)
    except Exception:
        min_steps = 0
    try:
        max_steps = int(constraints.get("maxStepsPerBatch") or 0)
    except Exception:
        max_steps = 0

    # Product defaults (used only when constraints are missing/malformed).
    if min_steps <= 0:
        min_steps = 8
    if max_steps <= 0:
        max_steps = max(min_steps, 13)
    if default_steps <= 0:
        default_steps = max_steps

    return max(1, min(30, max(min_steps, min(default_steps, max_steps))))


def _select_ui_types() -> Dict[str, Any]:
    from schemas.ui_steps import (
        BudgetCardsUI,
        ColorPickerUI,
        CompositeUI,
        ConfirmationUI,
        DatePickerUI,
        DesignerUI,
        FileUploadUI,
        GalleryUI,
        IntroUI,
        LeadCaptureUI,
        MultipleChoiceUI,
        PricingUI,
        RatingUI,
        SliderUI,
        SearchableSelectUI,
        TextInputUI,
    )

    return {
        "BudgetCardsUI": BudgetCardsUI,
        "ColorPickerUI": ColorPickerUI,
        "CompositeUI": CompositeUI,
        "ConfirmationUI": ConfirmationUI,
        "DatePickerUI": DatePickerUI,
        "DesignerUI": DesignerUI,
        "FileUploadUI": FileUploadUI,
        "GalleryUI": GalleryUI,
        "IntroUI": IntroUI,
        "LeadCaptureUI": LeadCaptureUI,
        "MultipleChoiceUI": MultipleChoiceUI,
        "PricingUI": PricingUI,
        "RatingUI": RatingUI,
        "SliderUI": SliderUI,
        "SearchableSelectUI": SearchableSelectUI,
        "TextInputUI": TextInputUI,
    }


def _build_context(payload: Dict[str, Any]) -> Dict[str, Any]:
    return build_context(payload)


def next_steps_jsonl(payload: Dict[str, Any]) -> Dict[str, Any]:
    """
    Generate the next UI steps as `miniSteps[]` via Planner -> Deterministic Render.
    """

    request_id = f"next_steps_{int(time.time() * 1000)}"
    start_time = time.time()
    t_context_ms = 0
    t_planner_ms = 0
    t_renderer_ms = 0
    t_post_ms = 0

    schema_version = payload.get("schemaVersion") or payload.get("schema_version") or _best_effort_contract_schema_version()

    planner_lm_cfg = make_dspy_lm_for_module(module_env_prefix="DSPY_PLANNER", allow_small_models=False)
    if not planner_lm_cfg:
        return {"ok": False, "error": "DSPy LM not configured", "requestId": request_id, "schemaVersion": str(schema_version or "0")}

    try:
        import dspy  # type: ignore
    except Exception:
        return {"ok": False, "error": "DSPy import failed", "requestId": request_id, "schemaVersion": str(schema_version or "0")}

    # Token budget guard (best-effort).
    # We treat the caller-provided budget as *soft*: allow a small overage instead of hard-failing
    # exactly at 0, since token accounting is approximate and may drift between client/server.
    batch_state_raw = payload.get("batchState") or payload.get("batch_state") or {}
    tokens_total, tokens_used = extract_token_budget(batch_state_raw)
    token_budget_total: Optional[int] = None
    token_budget_used: Optional[int] = None
    token_budget_remaining: Optional[int] = None
    token_budget_soft_exceeded = False
    if isinstance(tokens_total, int) and tokens_total > 0:
        used_i = tokens_used if isinstance(tokens_used, int) and tokens_used >= 0 else 0
        remaining = int(tokens_total) - int(used_i)
        token_budget_total = int(tokens_total)
        token_budget_used = int(used_i)
        token_budget_remaining = int(remaining)
        if remaining <= 0:
            # Allow a small overage window; beyond that, stop early.
            allowed_overage = env_int("AI_FORM_TOKEN_BUDGET_ALLOWED_OVERAGE", 750)
            if remaining < -int(allowed_overage):
                return {
                    "ok": False,
                    "error": "Token budget exhausted",
                    "requestId": request_id,
                    "schemaVersion": str(schema_version or "0"),
                }
            token_budget_soft_exceeded = True

    default_timeout = env_float("DSPY_LLM_TIMEOUT_SEC", 30.0)
    default_temperature = env_float("DSPY_TEMPERATURE", 0.7)
    default_max_tokens = env_int("DSPY_NEXT_STEPS_MAX_TOKENS", 4096)

    planner_timeout = env_float("DSPY_PLANNER_TIMEOUT_SEC", default_timeout)
    planner_temperature = env_float("DSPY_PLANNER_TEMPERATURE", default_temperature)
    planner_max_tokens = env_int("DSPY_PLANNER_MAX_TOKENS", default_max_tokens)
    planner_retries = env_int("DSPY_PLANNER_NUM_RETRIES", 1)

    planner_lm = dspy.LM(
        model=planner_lm_cfg["model"],
        temperature=planner_temperature,
        max_tokens=planner_max_tokens,
        timeout=planner_timeout,
        num_retries=planner_retries,
    )
    track_usage = False
    rate_limit_info: Dict[str, Any] = {"ok": True}

    # Build context (copy packs removed)
    _t0 = time.time()
    ctx = _build_context(payload)
    t_context_ms = int((time.time() - _t0) * 1000)
    lint_config: Dict[str, Any] = {}

    step_data_so_far_raw = payload.get("stepDataSoFar") or payload.get("step_data_so_far") or {}
    step_data_so_far = step_data_so_far_raw if isinstance(step_data_so_far_raw, dict) else {}

    # Require some explicit service context. We intentionally do not default industry/service
    # to "General", and the planner needs at least a hint of what vertical this is for.
    if not str(ctx.get("services_summary") or "").strip() and not str(ctx.get("industry") or "").strip() and not str(
        ctx.get("service") or ""
    ).strip():
        return {
            "ok": False,
            "error": "Missing service context (provide serviceSummary/service_summary or industry/service).",
            "requestId": request_id,
            "schemaVersion": str(schema_version or "0"),
        }

    # Allowed types (policy)
    allowed_mini_types = ensure_allowed_mini_types(extract_allowed_mini_types_from_payload(payload))

    if ctx.get("prefer_structured_inputs"):
        allowed_mini_types = prefer_structured_allowed_mini_types(allowed_mini_types)

    asked_ids = set([str(x).strip() for x in (ctx.get("asked_step_ids") or []) if str(x).strip()])
    session_id = extract_session_id(payload)
    services_key_material = str(ctx.get("services_summary") or ctx.get("grounding_summary") or "").strip()
    if not services_key_material:
        services_key_material = str(ctx.get("service") or "").strip()
    if not services_key_material:
        services_key_material = f"{str(ctx.get('industry') or '').strip()}::{str(ctx.get('service') or '').strip()}"
    services_hash = short_hash(services_key_material, n=10)
    cache_key = _planner_cache_key(session_id=session_id, services_fingerprint=services_hash)
    # IMPORTANT:
    # - noCache should mainly affect renderer output caching (debugging).
    # - planner plan determinism must be preserved per-session; otherwise the user sees duplicates/reshuffles.
    disable_render_cache = bool(payload.get("noCache") is True or str(payload.get("noCache") or "").lower() == "true")
    disable_planner_cache = False
    if os.getenv("AI_FORM_DEBUG") == "true":
        print(f"[FormPipeline] requestId={request_id} plannerCacheKey={cache_key}", flush=True)

    planner_context_json = _compact_json(
        {
            "services_summary": str(ctx.get("services_summary") or ctx.get("grounding_summary") or "").strip(),
            "service_summary": str(ctx.get("service_summary") or "").strip(),
            "company_summary": str(ctx.get("company_summary") or "").strip(),
            "industry": str(ctx.get("industry") or "").strip(),
            "service": str(ctx.get("service") or "").strip(),
            "answered_qa": ctx.get("answered_qa") if isinstance(ctx.get("answered_qa"), list) else [],
            "asked_step_ids": sorted(list(asked_ids)),
            "allowed_mini_types_hint": list(allowed_mini_types or []),
            "choice_option_min": ctx.get("choice_option_min"),
            "choice_option_max": ctx.get("choice_option_max"),
            "choice_option_target": ctx.get("choice_option_target"),
            "batch_constraints": ctx.get("batch_constraints") if isinstance(ctx.get("batch_constraints"), dict) else {},
            "required_uploads": ctx.get("required_uploads") if isinstance(ctx.get("required_uploads"), list) else [],
            "copy_context": ctx.get("copy_context") if isinstance(ctx.get("copy_context"), dict) else {},
        }
    )

    # Planner (cached per session)
    _t0 = time.time()
    raw_plan = ""
    planner_cache_hit = False
    if cache_key and not disable_planner_cache:
        cached = ttl_cache_get(_PLANNER_PLAN_CACHE, cache_key)
        if cached:
            raw_plan = cached
            planner_cache_hit = True

    planner_module = QuestionPlannerProgram(demo_pack=(os.getenv("DSPY_PLANNER_DEMO_PACK") or "").strip())
    plan_pred: Optional[Any] = None
    if not raw_plan:
        # App-level rate limiting (per-session + global) to avoid exceeding provider org limits under concurrency.
        instance_id = str(payload.get("instanceId") or payload.get("instance_id") or "").strip()
        if not instance_id and isinstance(payload.get("session"), dict):
            instance_id = str((payload.get("session") or {}).get("instanceId") or "").strip()
        model_name = str(planner_lm_cfg.get("modelName") or planner_lm_cfg.get("model") or "").strip()
        # Reserve a realistic upper bound: estimated input tokens + capped expected output tokens.
        # (Planner outputs compact JSON; reserving full max_tokens can cause permanent self-throttling.)
        est_in = estimate_tokens_from_text(planner_context_json)
        est_out_cap = env_int("AI_FORM_PLANNER_OUTPUT_TOKEN_RESERVE", 900)
        est_total = int(est_in) + int(min(int(planner_max_tokens), int(max(200, est_out_cap))))
        ok_rl, rl = reserve_planner_budget(
            instance_id=instance_id,
            session_id=session_id,
            model_id_or_version=model_name,
            estimated_tokens=est_total,
        )
        rate_limit_info = {"ok": bool(ok_rl), "appLimiter": rl}
        if not ok_rl:
            retry_after = float(rl.get("retryAfterSec") or 2.0)
            return {
                "ok": False,
                "error": "rate_limited",
                "message": "Planner is rate limited. Please retry shortly.",
                "retryAfterSec": retry_after,
                "requestId": request_id,
                "schemaVersion": str(schema_version or "0"),
                "rateLimit": rate_limit_info,
            }

        track_usage = _configure_dspy(planner_lm) or track_usage
        plan_pred = planner_module(
            planner_context_json=planner_context_json,
            max_steps=int(_resolve_max_plan_items(ctx)),
            allowed_mini_types=allowed_mini_types,
        )
        raw_plan = str(getattr(plan_pred, "question_plan_json", "") or "")
        if cache_key and raw_plan.strip() and not disable_planner_cache:
            ttl_cache_set(_PLANNER_PLAN_CACHE, cache_key, raw_plan, ttl_sec=int(os.getenv("AI_FORM_PLANNER_CACHE_TTL_SEC") or "900"))
    t_planner_ms = int((time.time() - _t0) * 1000)

    # Parse the full plan without filtering asked steps; we filter asked ids afterwards.
    #
    # Reserve known internal keys if needed (currently none).
    reserved_suffix_keys: set[str] = set()
    full_plan_items = extract_plan_items(raw_plan, max_items=int(_resolve_max_plan_items(ctx)), asked_step_ids=set())
    full_plan_items = [x for x in full_plan_items if normalize_plan_key(x.get("key")) not in reserved_suffix_keys]

    # If the planner output was truncated (or otherwise unparsable) on the first call, retry once with
    # a higher output budget / slightly higher temperature to break repetition loops.
    if (not planner_cache_hit) and (not full_plan_items) and str(raw_plan or "").strip():
        try:
            max_tokens_retry = env_int("DSPY_PLANNER_MAX_TOKENS_RETRY", max(planner_max_tokens, 6144))
            temperature_retry = env_float("DSPY_PLANNER_TEMPERATURE_RETRY", min(1.0, float(planner_temperature) + 0.1))
            planner_lm_retry = dspy.LM(
                model=planner_lm_cfg["model"],
                temperature=temperature_retry,
                max_tokens=max_tokens_retry,
                timeout=planner_timeout,
                num_retries=0,
            )
            # Rate limit reserve for retry path too (still consumes provider capacity).
            try:
                instance_id = str(payload.get("instanceId") or payload.get("instance_id") or "").strip()
                if not instance_id and isinstance(payload.get("session"), dict):
                    instance_id = str((payload.get("session") or {}).get("instanceId") or "").strip()
                model_name = str(planner_lm_cfg.get("modelName") or planner_lm_cfg.get("model") or "").strip()
                est_in = estimate_tokens_from_text(planner_context_json)
                est_out_cap = env_int("AI_FORM_PLANNER_OUTPUT_TOKEN_RESERVE", 1100)
                est_total = int(est_in) + int(min(int(max_tokens_retry), int(max(200, est_out_cap))))
                ok_rl, rl = reserve_planner_budget(
                    instance_id=instance_id,
                    session_id=session_id,
                    model_id_or_version=model_name,
                    estimated_tokens=est_total,
                )
                rate_limit_info = {"ok": bool(ok_rl), "appLimiter": rl}
                if not ok_rl:
                    retry_after = float(rl.get("retryAfterSec") or 2.0)
                    return {
                        "ok": False,
                        "error": "rate_limited",
                        "message": "Planner is rate limited. Please retry shortly.",
                        "retryAfterSec": retry_after,
                        "requestId": request_id,
                        "schemaVersion": str(schema_version or "0"),
                        "rateLimit": rate_limit_info,
                    }
            except Exception:
                pass
            track_usage = _configure_dspy(planner_lm_retry) or track_usage
            plan_pred = planner_module(
                planner_context_json=planner_context_json,
                max_steps=int(_resolve_max_plan_items(ctx)),
                allowed_mini_types=allowed_mini_types,
            )
            raw_plan_retry = str(getattr(plan_pred, "question_plan_json", "") or "")
            retry_items = extract_plan_items(raw_plan_retry, max_items=int(_resolve_max_plan_items(ctx)), asked_step_ids=set())
            retry_items = [x for x in retry_items if normalize_plan_key(x.get("key")) not in reserved_suffix_keys]
            if retry_items:
                raw_plan = raw_plan_retry
                full_plan_items = retry_items
                if cache_key and raw_plan.strip() and not disable_planner_cache:
                    ttl_cache_set(
                        _PLANNER_PLAN_CACHE,
                        cache_key,
                        raw_plan,
                        ttl_sec=int(os.getenv("AI_FORM_PLANNER_CACHE_TTL_SEC") or "900"),
                    )
        except Exception:
            pass

    # If we hit cache but it only contained reserved suffix keys (or was otherwise unusable), re-plan once.
    if planner_cache_hit and not full_plan_items:
        try:
            plan_pred = planner_module(
                planner_context_json=planner_context_json,
                max_steps=int(_resolve_max_plan_items(ctx)),
                allowed_mini_types=allowed_mini_types,
            )
            raw_plan_retry = str(getattr(plan_pred, "question_plan_json", "") or "")
            retry_items = extract_plan_items(raw_plan_retry, max_items=int(_resolve_max_plan_items(ctx)), asked_step_ids=set())
            retry_items = [x for x in retry_items if normalize_plan_key(x.get("key")) not in reserved_suffix_keys]
            if retry_items:
                raw_plan = raw_plan_retry
                planner_cache_hit = False
                full_plan_items = retry_items
                if cache_key and raw_plan.strip() and not disable_planner_cache:
                    ttl_cache_set(_PLANNER_PLAN_CACHE, cache_key, raw_plan, ttl_sec=int(os.getenv("AI_FORM_PLANNER_CACHE_TTL_SEC") or "900"))
        except Exception:
            pass

    plan_sequence: List[Dict[str, Any]] = []
    plan_sequence = list(full_plan_items)

    merged_plan_items: List[Dict[str, Any]] = []
    seen_keys: set[str] = set()
    for item in plan_sequence:
        if not isinstance(item, dict):
            continue
        key = normalize_plan_key(item.get("key"))
        if not key or key in seen_keys:
            continue
        sid = derive_step_id_from_key(key)
        normalized = dict(item)
        normalized["key"] = key
        merged_plan_items.append(normalized)
        seen_keys.add(key)

    # Slice per-call: render only the next batch of planned steps.
    sliced: List[Dict[str, Any]] = []
    max_steps_this_call = int(_resolve_max_steps_this_call(payload, ctx))
    for item in merged_plan_items:
        key = normalize_plan_key(item.get("key"))
        if not key:
            continue
        sid = derive_step_id_from_key(key)
        if sid in asked_ids:
            continue
        sliced.append(item)
        if len(sliced) >= max_steps_this_call:
            break

    if os.getenv("AI_FORM_DEBUG") == "true":
        try:
            print(
                (
                    f"[FormPipeline] requestId={request_id} "
                    f"askedStepIds={len(asked_ids)} rawPlanLen={len(str(raw_plan or '').strip())} "
                    f"fullPlanItems={len(full_plan_items)} mergedPlanItems={len(merged_plan_items)} slicedPlanItems={len(sliced)}"
                ),
                flush=True,
            )
            if not full_plan_items:
                snippet = str(raw_plan or "").strip().replace("\n", "\\n")[:280]
                print(f"[FormPipeline] requestId={request_id} plannerRawPlanSnippet={snippet}", flush=True)
            elif full_plan_items and not sliced:
                planned_ids_preview = []
                for it in merged_plan_items[:12]:
                    k = normalize_plan_key(it.get("key"))
                    if k:
                        planned_ids_preview.append(derive_step_id_from_key(k))
                overlap = [sid for sid in planned_ids_preview if sid in asked_ids]
                print(
                    f"[FormPipeline] requestId={request_id} plannedIdsPreview={planned_ids_preview} overlapWithAsked={overlap}",
                    flush=True,
                )
        except Exception:
            pass

    # Only accept renderer outputs that match planned ids (prevents hallucinated steps like confirmation).
    planned_id_order: List[str] = []
    planned_ids: set[str] = set()
    for item in sliced:
        if isinstance(item, dict):
            k = normalize_plan_key(item.get("key"))
            if k:
                sid = derive_step_id_from_key(k)
                planned_id_order.append(sid)
                planned_ids.add(sid)

    # Do NOT widen allowed types based on planner hints.
    # If the planner emits a `type_hint` that is not allowed by policy, it will be ignored downstream.
    allowed_mini_types = [str(x).strip().lower() for x in allowed_mini_types if str(x).strip()]

    render_context_json = _compact_json(
        {
            "services_summary": str(ctx.get("services_summary") or ctx.get("grounding_summary") or "").strip(),
            "choice_option_min": ctx.get("choice_option_min"),
            "choice_option_max": ctx.get("choice_option_max"),
            "choice_option_target": ctx.get("choice_option_target"),
            "budget_bounds_hint": ctx.get("budget_bounds_hint"),
            "required_uploads": ctx.get("required_uploads") if isinstance(ctx.get("required_uploads"), list) else [],
        }
    )
    render_cache_enabled = env_bool("AI_FORM_RENDER_CACHE", False)
    render_cache_hit = False
    parsed_steps: List[Dict[str, Any]] = []

    generate_option_images = env_bool("AI_FORM_OPTION_IMAGES", False) or bool(
        payload.get("generateOptionImages") is True
        or str(payload.get("generateOptionImages") or "").lower() == "true"
        or payload.get("optionImages") is True
        or str(payload.get("optionImages") or "").lower() == "true"
    )
    option_image_stats: Dict[str, int] = {}

    _t0 = time.time()
    plan_json_for_render = _compact_json({"plan": sliced})
    render_cache_key = (
        _render_cache_key(
            session_id=session_id,
            schema_version=str(schema_version or "0"),
            plan_json=plan_json_for_render,
            render_context_json=render_context_json,
            allowed_mini_types=allowed_mini_types,
        )
        if (render_cache_enabled and not disable_render_cache)
        else ""
    )
    if render_cache_key and generate_option_images:
        render_cache_key = render_cache_key + ":optimg"
    if os.getenv("AI_FORM_DEBUG") == "true" and render_cache_key:
        print(f"[FormPipeline] requestId={request_id} renderCacheKey={render_cache_key}", flush=True)
    cached_emitted = ttl_cache_get(_RENDER_OUTPUT_CACHE, render_cache_key) if render_cache_key else None

    # Render output cache is always *post-validation* output (miniSteps[]).
    # This preserves schema enforcement even when cached.
    if isinstance(cached_emitted, list) and cached_emitted:
        render_cache_hit = True

    if not render_cache_hit:
        parsed_steps = render_plan_items_to_mini_steps(
            sliced,
            choice_option_min=ctx.get("choice_option_min"),
            choice_option_max=ctx.get("choice_option_max"),
            choice_option_target=ctx.get("choice_option_target"),
            budget_bounds_hint=ctx.get("budget_bounds_hint"),
        )
        if generate_option_images and parsed_steps and sliced:
            option_image_stats = _convert_option_images_for_steps(parsed_steps, sliced, ctx, session_id=session_id) or {}
    t_renderer_ms = int((time.time() - _t0) * 1000)

    ui_types = _select_ui_types()
    allowed_set = set([str(x).strip().lower() for x in allowed_mini_types if str(x).strip()])
    if generate_option_images:
        allowed_set.add("image_choice_grid")
    required_upload_ids = _extract_required_upload_ids(ctx.get("required_uploads"))

    emitted: List[Dict[str, Any]] = []
    taken_ids: set[str] = set(asked_ids)
    _t0 = time.time()
    if render_cache_hit and isinstance(cached_emitted, list):
        # Best-effort: cached output was validated before insertion; still normalize list shape.
        emitted = [x for x in cached_emitted if isinstance(x, dict)]
        for x in emitted:
            sid = str(x.get("id") or "").strip()
            if sid:
                taken_ids.add(sid)
    else:
        for s in parsed_steps:
            if not isinstance(s, dict):
                continue
            sid = str(s.get("id") or "").strip()
            if not sid or sid in taken_ids:
                continue
            if planned_ids and sid not in planned_ids:
                continue
            if not allowed_type_matches(str(s.get("type") or ""), allowed_set):
                continue
            if _looks_like_upload_step_id(sid) and required_upload_ids and sid not in required_upload_ids:
                # If required upload ids exist, only allow those upload ids.
                continue
            validated = _validate_mini(s, ui_types)
            if not validated:
                continue
            validated = _reject_banned_option_sets(validated)
            if not validated:
                continue
            emitted.append(validated)
            taken_ids.add(sid)

    # Renderer backstop for deterministic suffix items.
    # If the renderer fails to emit required suffix steps, inject minimal validated steps.
    if sliced and len(emitted) < len(sliced):
        for plan_item in sliced:
            if not isinstance(plan_item, dict):
                continue
            if plan_item.get("deterministic") is not True:
                continue
            key = normalize_plan_key(plan_item.get("key"))
            if not key:
                continue
            sid = derive_step_id_from_key(key)
            if not sid or sid in taken_ids:
                continue
            if len(emitted) >= len(sliced):
                break

            t = str(plan_item.get("type_hint") or "").strip().lower()
            if not t:
                continue
            if not allowed_type_matches(t, allowed_set):
                continue
            if _looks_like_upload_step_id(sid) and required_upload_ids and sid not in required_upload_ids:
                continue

            candidate = {
                "id": sid,
                "type": t,
                "question": str(plan_item.get("question") or plan_item.get("intent") or "").strip() or "Continue.",
                "required": bool(plan_item.get("required") is True),
            }
            validated = _validate_mini(candidate, ui_types)
            if not validated:
                continue
            validated = _reject_banned_option_sets(validated)
            if not validated:
                continue
            emitted.append(validated)
            taken_ids.add(sid)

    # Final copy sanitation (question marks, remove duplicated enumerations, etc.)
    emitted = sanitize_steps(emitted, lint_config, plan_step_ids=planned_id_order)
    # Budget is now deterministic client-side and seeded from pricing API bounds.
    # Never emit planner-provided budget sliders from generate-steps.
    emitted = [s for s in emitted if str((s or {}).get("id") or "").strip() != "step-budget-range"]
    t_post_ms = int((time.time() - _t0) * 1000)

    # Cache rendered output (validated miniSteps only).
    if render_cache_key and (not disable_render_cache) and (not render_cache_hit) and emitted:
        ttl_sec = env_int("AI_FORM_RENDER_CACHE_TTL_SEC", 600)
        ttl_cache_set(_RENDER_OUTPUT_CACHE, render_cache_key, emitted, ttl_sec=ttl_sec)

    meta: Dict[str, Any] = {
        "requestId": request_id,
        "schemaVersion": str(schema_version or "0"),
        "miniSteps": emitted,
        "stepDataSoFar": dict(step_data_so_far),
    }

    if _include_response_meta(payload):
        meta["debugContext"] = {
            "industry": ctx.get("industry"),
            "service": ctx.get("service"),
            "goalIntent": ctx.get("goal_intent"),
            "servicesSummaryLen": len(str(ctx.get("services_summary") or ctx.get("grounding_summary") or "")),
            "companySummaryLen": len(str(ctx.get("company_summary") or "")),
            "allowedMiniTypes": allowed_mini_types,
            "maxSteps": len(sliced),
            "plannerModel": planner_lm_cfg.get("modelName"),
            "rendererModel": "deterministic",
            "plannerCacheHit": planner_cache_hit,
            "renderCacheHit": render_cache_hit,
            "plannedItems": len(sliced),
            "renderedJsonlLines": len(parsed_steps),
            "emittedSteps": len(emitted),
            "tokenBudgetTotal": token_budget_total,
            "tokenBudgetUsed": token_budget_used,
            "tokenBudgetRemaining": token_budget_remaining,
            "tokenBudgetSoftExceeded": bool(token_budget_soft_exceeded),
            "generateOptionImages": bool(generate_option_images),
            "optionImageStats": option_image_stats if generate_option_images else {},
        }
        meta["debugContext"]["optionImagesSeedBase"] = str(seed_base)[:160] if "seed_base" in locals() else None

    if track_usage:
        lm_usage_by_module: Dict[str, Any] = {}
        usage_planner = extract_dspy_usage(plan_pred) if plan_pred is not None else None
        if usage_planner:
            lm_usage_by_module["planner"] = usage_planner
            # Back-compat: keep `lmUsage` populated when available.
            meta["lmUsage"] = usage_planner
            # Best-effort: capture provider rate limit headers if the LM stack exposes them.
            hdrs = extract_provider_rate_headers(usage_planner)
            if hdrs:
                rate_limit_info = dict(rate_limit_info or {})
                rate_limit_info["providerHeaders"] = hdrs
        if lm_usage_by_module:
            meta["lmUsageByModule"] = lm_usage_by_module

    latency_ms = int((time.time() - start_time) * 1000)
    if env_bool("AI_FORM_LOG_LATENCY", False):
        try:
            print(
                json.dumps(
                    {
                        "event": "step3_latency",
                        "requestId": request_id,
                        "plannerMs": int(t_planner_ms),
                        "rendererMs": int(t_renderer_ms),
                        "postProcessingMs": int(t_post_ms),
                        "totalMs": int(latency_ms),
                        "plannerModel": planner_lm_cfg.get("modelName"),
                        "rendererModel": "deterministic",
                        "plannerCacheHit": bool(planner_cache_hit),
                        "renderCacheHit": bool(render_cache_hit),
                        "plannedItems": int(len(sliced)),
                        "renderedJsonlLines": int(len(parsed_steps)),
                        "emittedSteps": int(len(emitted)),
                    },
                    ensure_ascii=True,
                    separators=(",", ":"),
                    sort_keys=True,
                ),
                flush=True,
            )
        except Exception:
            pass
    if os.getenv("AI_FORM_DEBUG") == "true":
        print(
            (
                f"[FormPipeline] requestId={request_id} latencyMs={latency_ms} steps={len(emitted)} "
                f"contextLatencyMs={t_context_ms} plannerLatencyMs={t_planner_ms} rendererLatencyMs={t_renderer_ms} postLatencyMs={t_post_ms} "
                f"plannerModel={planner_lm_cfg.get('modelName') or planner_lm_cfg.get('model')} "
                f"rendererModel=deterministic "
                f"plannerCacheHit={planner_cache_hit} renderCacheHit={render_cache_hit}"
            ),
            flush=True,
        )

    # Always include rate limit diagnostics (app-level limiter + provider headers if present).
    meta["rateLimit"] = rate_limit_info
    return meta


__all__ = [
    "next_steps_jsonl",
    "_build_context",
    "_compact_json",
    "_configure_dspy",
    "_make_dspy_lm",
]
