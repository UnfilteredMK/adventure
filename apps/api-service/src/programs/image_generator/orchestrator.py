"""
Image prompt + image generation orchestration.

This file is intentionally parallel to `src/app/pipeline/form_pipeline.py`:
- Uses the same compact session context builder for consistency.
- Uses DSPy for prompt construction (optional).
- Calls a provider/tool layer for actual image generation.
"""

from __future__ import annotations

import json
import os
import time
from typing import Any, Dict, Optional

from programs.common.visual_text_safety import sanitize_visual_context_text
from programs.image_generator.prompt_builder import build_image_prompt_text, extract_negative_prompt, extract_reference_images


_VERBOSE_LOG_ENV = "IMAGE_LOG_DETAILED_PAYLOADS"
_VERBOSE_LOG_CACHE: Optional[bool] = None
_PRETTY_JSON_LIMIT = 6000


def _verbose_logging_enabled() -> bool:
    global _VERBOSE_LOG_CACHE
    if _VERBOSE_LOG_CACHE is None:
        val = str(os.getenv(_VERBOSE_LOG_ENV) or "").strip().lower()
        _VERBOSE_LOG_CACHE = val in {"1", "true", "yes"}
    return _VERBOSE_LOG_CACHE


def _pretty_json(obj: Any, *, max_chars: int = _PRETTY_JSON_LIMIT) -> str:
    try:
        text = json.dumps(obj, indent=2, ensure_ascii=False, sort_keys=True)
    except Exception:
        text = str(obj)
    if len(text) > max_chars:
        text = text[:max_chars] + "…"
    return text


def _log_verbose(label: str, data: Any) -> None:
    if not _verbose_logging_enabled():
        return
    try:
        text = _pretty_json(data)
        print(f"[image_generator] {label}:\n{text}", flush=True)
    except Exception:
        print(f"[image_generator] {label}: (unable to render payload)", flush=True)


def _best_effort_parse_json(text: str) -> Any:
    try:
        return json.loads(text)
    except Exception:
        return None


def _merge_negative_prompt(primary: str, fallback: str) -> str:
    parts: list[str] = []
    seen: set[str] = set()
    for raw in (primary, fallback):
        for item in str(raw or "").split(","):
            token = item.strip()
            key = token.lower()
            if not token or key in seen:
                continue
            seen.add(key)
            parts.append(token)
    return ", ".join(parts)


def _tail_lines(text: str, *, max_lines: int = 30, max_chars: int = 1200) -> str:
    t = str(text or "").strip()
    if not t:
        return ""
    lines = t.splitlines()
    tail = "\n".join(lines[-max_lines:])
    tail = tail.strip()
    if len(tail) > max_chars:
        tail = tail[-max_chars:].lstrip()
    return tail


def _extract_provider_error(provider_resp: Any) -> str:
    """
    Best-effort extraction of a human-readable error message from a provider response.
    Works for Replicate prediction objects and our timeout shape.
    """
    if not isinstance(provider_resp, dict):
        return ""

    # Common fields across providers/shapes.
    for k in ("message", "error", "detail", "title"):
        v = provider_resp.get(k)
        if isinstance(v, str) and v.strip():
            return v.strip()

    # Replicate: sometimes `error` is null but logs contain the failure reason.
    # Only treat logs as an error surface when status indicates failure/cancel/timeout.
    status = str(provider_resp.get("status") or "").strip().lower()
    if status in {"failed", "timeout", "canceled"}:
        logs = provider_resp.get("logs")
        if isinstance(logs, str) and logs.strip():
            return _tail_lines(logs, max_lines=24, max_chars=1200)

    return ""


def _extract_dspy_inputs(payload: Dict[str, Any]) -> Dict[str, Any]:
    """Extract structured inputs for the DSPy ImagePromptModule from the raw payload."""
    import re

    step_data = payload.get("stepDataSoFar") or payload.get("step_data_so_far") or {}
    if not isinstance(step_data, dict):
        step_data = {}

    uuid_re = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$", re.IGNORECASE)
    url_re = re.compile(r"^https?://", re.IGNORECASE)

    def clean(val: Any) -> str:
        if isinstance(val, list):
            parts = [
                sanitize_visual_context_text(str(x).strip())
                for x in val
                if isinstance(x, str) and not uuid_re.match(str(x).strip()) and not url_re.match(str(x).strip())
            ]
            return ", ".join(p for p in parts if p)
        t = sanitize_visual_context_text(val)
        if uuid_re.match(t) or url_re.match(t):
            return ""
        return t

    ctx = payload.get("instanceContext") or payload.get("instance_context") or {}
    if not isinstance(ctx, dict):
        ctx = {}
    svc = ctx.get("service") or {}
    service_name = sanitize_visual_context_text((svc.get("name") or "") if isinstance(svc, dict) else "", max_len=160)
    service_summary = sanitize_visual_context_text(ctx.get("serviceSummary") or ctx.get("service_summary") or "", max_len=500)

    use_case = str(payload.get("useCase") or payload.get("use_case") or "scene").strip().lower()
    # Use normalized extraction so edit-mode follows all usable refs
    # (explicit refs + scene/product + context-mined URLs).
    reference_images, _, _ = extract_reference_images(payload)
    is_edit = len(reference_images) > 0

    prefs_parts = []
    skip_keys = {"step-service-primary", "service_primary", "collect_context"}
    for k, v in step_data.items():
        if k in skip_keys:
            continue
        val = clean(v)
        if not val:
            continue
        prefs_parts.append(f"{k}: {val}")

    qa = payload.get("answeredQA") or payload.get("answered_qa") or []
    if isinstance(qa, list):
        for item in qa:
            if not isinstance(item, dict):
                continue
            q = str(item.get("question") or "").strip()
            a = clean(item.get("answer"))
            if q and a and "pricing" not in q.lower() and not q.lower().startswith("wait"):
                prefs_parts.append(f"{q}: {a}")

    style_raw = step_data.get("style")
    style_tags = ""
    if isinstance(style_raw, list):
        style_tags = ", ".join(str(x).strip() for x in style_raw if str(x).strip())
    elif isinstance(style_raw, str):
        style_tags = sanitize_visual_context_text(style_raw, max_len=240)

    budget = sanitize_visual_context_text(
        step_data.get("budget_range") or step_data.get("budgetRange") or step_data.get("step-budget-range") or "",
        max_len=120,
    )
    location_city = sanitize_visual_context_text(step_data.get("location_city") or step_data.get("locationCity") or "", max_len=80)
    location_state = sanitize_visual_context_text(step_data.get("location_state") or step_data.get("locationState") or "", max_len=80)
    location = f"{location_city}, {location_state}".strip(", ") if location_city or location_state else ""

    return {
        "service_name": service_name or "Home improvement",
        "service_summary": service_summary,
        "use_case": use_case,
        "is_edit": is_edit,
        "user_preferences": "\n".join(prefs_parts[:15]),
        "style_tags": style_tags,
        "budget_level": budget,
        "location": location,
    }


def _normalize_use_case_for_dispatch(payload: Dict[str, Any]) -> str:
    """Normalize use_case for DSPy dispatch; map drilldown -> scene."""
    raw = str(payload.get("useCase") or payload.get("use_case") or "scene").strip().lower().replace("_", "-")
    if raw in ("tryon", "try-on"):
        return "tryon"
    if raw == "scene-placement":
        return "scene-placement"
    if raw == "scene-refinement":
        return "scene-refinement"
    if raw == "drilldown":
        return "scene"
    return raw if raw in ("scene", "scene-placement", "scene-refinement", "tryon") else "scene"


def _extract_scene_inputs(payload: Dict[str, Any]) -> Dict[str, Any]:
    """Extract inputs for ScenePromptModule (scene use case)."""
    inputs = _extract_dspy_inputs(payload)
    out = {k: v for k, v in inputs.items() if k != "use_case"}
    reference_images, scene_image, _ = extract_reference_images(payload)
    generation_intent_raw = str(
        payload.get("generationIntent") or payload.get("generation_intent") or ""
    ).strip().lower().replace("-", "_")
    if generation_intent_raw == "initial":
        out["generation_intent"] = "initial"
    elif generation_intent_raw in ("small_improvement", "refine", "refinement", "regenerate"):
        out["generation_intent"] = "refinement"
    else:
        out["generation_intent"] = "initial" if not bool(inputs.get("is_edit")) else "refinement"
    if bool(inputs.get("is_edit")):
        if out["generation_intent"] == "initial":
            out["reference_adherence"] = (
                "INITIAL LARGE OVERHAUL: The uploaded photo is the BEFORE state. Generate the fully-completed AFTER state. "
                "Preserve ONLY: room layout, camera angle, structural walls, perspective. REPLACE everything else the service touches — "
                "all finishes, fixtures, materials, surfaces. Every service-touched element must look brand-new and professionally done. "
                "Nothing old, worn, or original should remain in the renovated scope."
            )
        else:
            anchor_hint = "uploaded reference image"
            if isinstance(scene_image, str) and scene_image.strip():
                anchor_hint = "scene image"
            elif reference_images:
                anchor_hint = "primary reference image"
            out["reference_adherence"] = (
                f"Hard constraint: treat the {anchor_hint} as immutable anchor. Preserve camera/framing, geometry, perspective, "
                "lighting direction, depth relationships, and all unchanged structures/objects. Only apply edits requested by "
                "service scope and user preferences."
            )
    else:
        out["reference_adherence"] = ""
    return out


def _extract_scene_placement_inputs(payload: Dict[str, Any]) -> Dict[str, Any]:
    """Extract inputs for ScenePlacementPromptModule."""
    def _normalize_budget_raw(v: Any) -> str:
        if v is None:
            return ""
        s = str(v).strip()
        return s

    def _budget_requirements(budget_raw: str) -> str:
        b = (budget_raw or "").strip()
        if not b:
            return "Use budget-appropriate, realistic mid-range materials; avoid luxury/overdesigned finishes."
        try:
            n = int(float(b))
        except Exception:
            n = None
        if n is None:
            return f"Hard constraint: match finish/material quality to this budget signal: {b}. Do not exceed this tier."
        if n <= 10000:
            return (
                f"Hard constraint: budget is ~${n:,}. Use entry-level/builder-grade materials and simple finishes. "
                "Avoid premium/luxury details."
            )
        if n <= 30000:
            return (
                f"Hard constraint: budget is ~${n:,}. Use solid mid-range materials and practical professional finishes. "
                "Avoid high-end bespoke details."
            )
        if n <= 70000:
            return (
                f"Hard constraint: budget is ~${n:,}. Use premium but realistic professional materials. "
                "Do not escalate to ultra-luxury styling."
            )
        return (
            f"Hard constraint: budget is ~${n:,}. High-end quality is acceptable, but keep compositing realistic and coherent."
        )

    base = _extract_dspy_inputs(payload)
    step_data = payload.get("stepDataSoFar") or payload.get("step_data_so_far") or {}
    if not isinstance(step_data, dict):
        step_data = {}
    ctx = payload.get("instanceContext") or payload.get("instance_context") or {}
    if not isinstance(ctx, dict):
        ctx = {}
    svc = ctx.get("service") or {}
    service_name = (svc.get("name") or "") if isinstance(svc, dict) else ""
    service_summary = sanitize_visual_context_text(ctx.get("serviceSummary") or ctx.get("service_summary") or "", max_len=500)
    subject = sanitize_visual_context_text(
        step_data.get("step-service-primary") or step_data.get("service_primary") or service_name or "project",
        max_len=140,
    ) or "project"

    style_raw = step_data.get("style")
    style_tags = ""
    if isinstance(style_raw, list):
        style_tags = ", ".join(str(x).strip() for x in style_raw if str(x).strip())
    elif isinstance(style_raw, str):
        style_tags = sanitize_visual_context_text(style_raw, max_len=240)

    location_city = sanitize_visual_context_text(step_data.get("location_city") or step_data.get("locationCity") or "", max_len=80)
    location_state = sanitize_visual_context_text(step_data.get("location_state") or step_data.get("locationState") or "", max_len=80)
    location = f"{location_city}, {location_state}".strip(", ") if location_city or location_state else ""

    reference_images, scene_image, product_image = extract_reference_images(payload)
    scene_context = (
        "User provided a scene anchor image as the inpaint background."
        if (scene_image and scene_image.strip())
        else "Background scene provided."
    )
    product_context = "User provided a product to place in the scene." if (product_image and product_image.strip()) else "Product to integrate provided."
    budget_raw = _normalize_budget_raw(
        step_data.get("step-budget-range")
        or step_data.get("budget_range")
        or step_data.get("budgetRange")
        or step_data.get("step-budget")
        or payload.get("budgetRange")
        or payload.get("budget_range")
        or base.get("budget_level")
    )
    budget_level = budget_raw
    budget_requirements = _budget_requirements(budget_raw)
    if isinstance(scene_image, str) and scene_image.strip():
        reference_adherence = (
            "Hard anchor constraint: preserve the scene image composition and camera exactly (perspective, horizon, lens/framing, "
            "lighting direction, shadow behavior, and room geometry). Apply only local inpaint edits needed for requested placement."
        )
    elif reference_images:
        reference_adherence = (
            "Hard anchor constraint: preserve the primary reference image composition/camera and overall geometry; "
            "limit edits to requested local placement changes."
        )
    else:
        reference_adherence = (
            "Preserve geometry/camera continuity and avoid global scene drift; treat edits as localized inpaint updates."
        )

    return {
        "service_summary": service_summary or "Place product in scene.",
        "subject": subject,
        "style_tags": style_tags,
        "location": location,
        "scene_context": scene_context,
        "product_context": product_context,
        "user_preferences": str(base.get("user_preferences") or "").strip(),
        "reference_adherence": reference_adherence,
        "budget_level": budget_level,
        "budget_requirements": budget_requirements,
    }


def _extract_scene_refinement_inputs(payload: Dict[str, Any]) -> Dict[str, Any]:
    """Extract inputs for SceneRefinementPromptModule."""
    placement_inputs = _extract_scene_placement_inputs(payload)
    return {
        "service_summary": placement_inputs.get("service_summary") or "Refine the current scene design.",
        "subject": placement_inputs.get("subject") or "project",
        "style_tags": placement_inputs.get("style_tags") or "",
        "location": placement_inputs.get("location") or "",
        "scene_context": "User provided an existing scene/design image that should remain the anchor.",
        "user_preferences": placement_inputs.get("user_preferences") or "",
        "reference_adherence": (
            "Hard anchor constraint: preserve the current scene composition, camera, perspective, geometry, depth relationships, "
            "lighting direction, and unchanged objects/materials. Make only the requested local design refinements."
        ),
        "budget_level": placement_inputs.get("budget_level") or "",
        "budget_requirements": placement_inputs.get("budget_requirements") or "",
    }


def _extract_tryon_inputs(payload: Dict[str, Any]) -> Dict[str, Any]:
    """Extract inputs for TryonPromptModule."""
    step_data = payload.get("stepDataSoFar") or payload.get("step_data_so_far") or {}
    if not isinstance(step_data, dict):
        step_data = {}
    ctx = payload.get("instanceContext") or payload.get("instance_context") or {}
    if not isinstance(ctx, dict):
        ctx = {}
    service_summary = sanitize_visual_context_text(ctx.get("serviceSummary") or ctx.get("service_summary") or "", max_len=300)

    style_raw = step_data.get("style")
    style_tags = ""
    if isinstance(style_raw, list):
        style_tags = ", ".join(str(x).strip() for x in style_raw if str(x).strip())
    elif isinstance(style_raw, str):
        style_tags = sanitize_visual_context_text(style_raw, max_len=240)
    style_direction = style_tags.strip() or "photorealistic try-on"

    product_or_style_context = service_summary or "Photorealistic virtual try-on."
    constraints = str(payload.get("negativePrompt") or payload.get("negative_prompt") or "").strip() or "Natural fit, correct draping and shadows."

    return {
        "product_or_style_context": product_or_style_context,
        "style_direction": style_direction,
        "constraints": constraints,
    }


def _build_deterministic_prompt(payload: Dict[str, Any], request_id: str) -> Dict[str, Any]:
    """Deterministic prompt construction (no LLM call)."""
    try:
        from programs.image_generator.signatures.image_prompt import ImagePromptSpec
    except Exception as e:
        return {
            "ok": False,
            "error": f"Image prompt schema unavailable: {type(e).__name__}: {e}",
            "requestId": request_id,
        }
    try:
        obj = build_image_prompt_text(payload)
        spec = ImagePromptSpec.model_validate(obj).model_dump(by_alias=True)
    except Exception as e:
        return {
            "ok": False,
            "error": f"Failed to build image prompt: {type(e).__name__}: {e}",
            "requestId": request_id,
        }
    return {"ok": True, "requestId": request_id, "prompt": spec}


def _build_dspy_prompt(payload: Dict[str, Any], request_id: str) -> Optional[Dict[str, Any]]:
    """
    Attempt DSPy-based prompt generation.  Returns None on any failure
    so the caller can fall back to the deterministic builder.
    Dispatches to use-case-specific module: scene, scene-placement, tryon.
    """
    try:
        from programs.form_pipeline.orchestrator import _configure_dspy as _configure_dspy
        from programs.form_pipeline.orchestrator import _make_dspy_lm as _make_dspy_lm
    except Exception:
        return None

    lm_cfg = _make_dspy_lm()
    if not lm_cfg:
        return None

    try:
        import dspy
        from programs.image_generator.image_prompt_library import get_negative_prompt
        from programs.image_generator.scene_placement_prompt_module import ScenePlacementPromptModule
        from programs.image_generator.scene_refinement_prompt_module import SceneRefinementPromptModule
        from programs.image_generator.scene_prompt_module import ScenePromptModule
        from programs.image_generator.signatures.image_prompt import ImagePromptSpec
        from programs.image_generator.tryon_prompt_module import TryonPromptModule
    except Exception:
        return None

    llm_timeout = float(os.getenv("DSPY_LLM_TIMEOUT_SEC") or "20")
    temperature = float(os.getenv("DSPY_TEMPERATURE") or "0.5")
    max_tokens = int(os.getenv("DSPY_IMAGE_PROMPT_MAX_TOKENS") or "900")

    lm = dspy.LM(
        model=lm_cfg["model"],
        temperature=temperature,
        max_tokens=max_tokens,
        timeout=llm_timeout,
        num_retries=0,
    )
    if callable(_configure_dspy):
        _configure_dspy(lm)

    use_case = _normalize_use_case_for_dispatch(payload)
    reference_images, _, _ = extract_reference_images(payload)
    is_edit = len(reference_images) > 0

    pred = None
    used_module_name = ""
    style_tags_str = ""

    try:
        if use_case == "scene":
            inputs = _extract_scene_inputs(payload)
            module = ScenePromptModule()
            pred = module(**inputs)
            used_module_name = "scene"
            style_tags_str = inputs.get("style_tags", "")

        elif use_case == "scene-placement":
            inputs = _extract_scene_placement_inputs(payload)
            module = ScenePlacementPromptModule()
            pred = module(**inputs)
            used_module_name = "scene-placement"
            style_tags_str = inputs.get("style_tags", "")

        elif use_case == "scene-refinement":
            inputs = _extract_scene_refinement_inputs(payload)
            module = SceneRefinementPromptModule()
            pred = module(**inputs)
            used_module_name = "scene-refinement"
            style_tags_str = inputs.get("style_tags", "")

        elif use_case == "tryon":
            inputs = _extract_tryon_inputs(payload)
            module = TryonPromptModule()
            pred = module(**inputs)
            used_module_name = "tryon"
            style_tags_str = inputs.get("style_direction", "")

        else:
            return None
    except Exception as e:
        print(f"[image_generator] DSPy module failed ({use_case}): {type(e).__name__}: {e}", flush=True)
        return None

    if pred is None:
        return None

    prompt_text = str(getattr(pred, "prompt", "") or "").strip()
    neg_text = str(getattr(pred, "negative_prompt", "") or "").strip()

    if not prompt_text or len(prompt_text) < 20:
        return None

    neg_text = _merge_negative_prompt(
        neg_text,
        get_negative_prompt(str(payload.get("modelId") or payload.get("model_id") or "")),
    )

    spec_obj = {
        "prompt": prompt_text,
        "negativePrompt": neg_text,
        "styleTags": [t.strip() for t in style_tags_str.split(",") if t.strip()],
        "isEdit": is_edit,
        "metadata": {"useCase": use_case, "dspy": True, "isEdit": is_edit},
    }

    try:
        spec = ImagePromptSpec.model_validate(spec_obj).model_dump(by_alias=True)
    except Exception:
        return None

    print(f"[image_generator] prompt built via DSPy ({used_module_name})", flush=True)
    return {"ok": True, "requestId": request_id, "prompt": spec}


def build_image_prompt(payload: Dict[str, Any]) -> Dict[str, Any]:
    """
    Build an image prompt spec.

    Default: try DSPy first for higher-quality prompts, fall back to deterministic.
    Set IMAGE_PROMPT_MODE=deterministic to skip DSPy entirely.
    """
    request_id = f"image_prompt_{int(time.time() * 1000)}"

    mode = str(os.getenv("IMAGE_PROMPT_MODE") or "dspy").strip().lower()

    if mode == "dspy":
        dspy_result = _build_dspy_prompt(payload, request_id)
        if dspy_result and dspy_result.get("ok"):
            return dspy_result
        print("[image_generator] DSPy prompt failed or unavailable, falling back to deterministic", flush=True)

    return _build_deterministic_prompt(payload, request_id)


def generate_image(payload: Dict[str, Any]) -> Dict[str, Any]:
    """
    End-to-end image generation:
    - Build prompt via DSPy from the provided context
    - Call the image provider (Replicate)
    - Return `{ images: string[], predictionId }` for widget compatibility
    """
    request_id = f"image_{int(time.time() * 1000)}"

    _log_verbose("payload_received", payload)

    # Lightweight request log (safe: no tokens; prompt is truncated).
    try:
        session_id = payload.get("sessionId") or (payload.get("session") or {}).get("sessionId")
        instance_id = payload.get("instanceId") or (payload.get("session") or {}).get("instanceId")
        use_case = payload.get("useCase")
        model_id_log = payload.get("modelId") or payload.get("model_id")
        num_outputs_log = payload.get("numOutputs") or payload.get("num_outputs")
        ref_count = len(payload.get("referenceImages") or []) if isinstance(payload.get("referenceImages"), list) else 0
        print(
            "[image_generator] generate_image request",
            {
                "instanceId": str(instance_id or "")[:80] or None,
                "sessionId": str(session_id or "")[:80] or None,
                "useCase": str(use_case or "")[:40] or None,
                "modelId": str(model_id_log or "")[:120] or None,
                "numOutputs": num_outputs_log,
                "referenceImagesCount": ref_count,
            },
            flush=True,
        )
    except Exception:
        pass

    prompt_result = build_image_prompt(payload)
    if not isinstance(prompt_result, dict) or not prompt_result.get("ok"):
        return prompt_result
    prompt_obj = prompt_result.get("prompt") if isinstance(prompt_result.get("prompt"), dict) else {}
    _log_verbose("generated_prompt_spec", prompt_obj)
    prompt_text = ((prompt_obj.get("prompt") if isinstance(prompt_obj, dict) else "") or "").strip()

    # Prefer prompt-spec negativePrompt, fall back to payload negativePrompt.
    negative_prompt = None
    if isinstance(prompt_obj, dict) and isinstance(prompt_obj.get("negativePrompt"), str):
        negative_prompt = str(prompt_obj.get("negativePrompt") or "").strip() or None
    if not negative_prompt:
        negative_prompt = extract_negative_prompt(payload) or None

    # Wire through common widget fields
    def _as_int(v: Any) -> Optional[int]:
        try:
            if v is None:
                return None
            n = int(v)
            return n
        except Exception:
            return None

    def _as_float(v: Any) -> Optional[float]:
        try:
            if v is None:
                return None
            return float(v)
        except Exception:
            return None

    def _as_bool(v: Any) -> Optional[bool]:
        if isinstance(v, bool):
            return v
        if isinstance(v, str):
            s = v.strip().lower()
            if s in {"1", "true", "yes", "on"}:
                return True
            if s in {"0", "false", "no", "off"}:
                return False
        return None

    num_outputs = (
        payload.get("numOutputs")
        or payload.get("num_outputs")
        or payload.get("gallery_max_images")
        or payload.get("galleryMaxImages")
        or 1
    )
    try:
        n = int(num_outputs)
    except Exception:
        n = 1

    model_id = payload.get("modelId") or payload.get("model_id") or None
    if not isinstance(model_id, str):
        model_id = None

    reference_images, scene_image, product_image = extract_reference_images(payload)
    reference_images_list: Optional[list[str]] = reference_images if reference_images else None

    width = _as_int(payload.get("width"))
    height = _as_int(payload.get("height"))
    aspect_ratio = (
        str(payload.get("aspectRatio") or payload.get("aspect_ratio") or "").strip() or None
    )
    num_inference_steps = _as_int(
        payload.get("numInferenceSteps")
        or payload.get("num_inference_steps")
    )
    guidance_scale = _as_float(
        payload.get("guidanceScale")
        or payload.get("guidance_scale")
    )
    prompt_strength = _as_float(
        payload.get("promptStrength")
        or payload.get("prompt_strength")
        or payload.get("strength")
    )
    image_prompt_strength = _as_float(
        payload.get("imagePromptStrength")
        or payload.get("image_prompt_strength")
    )
    go_fast = _as_bool(
        payload.get("goFast")
        or payload.get("go_fast")
    )
    safety_tolerance = _as_int(
        payload.get("safetyTolerance")
        or payload.get("safety_tolerance")
    )
    prompt_upsampling = _as_bool(
        payload.get("promptUpsampling")
        or payload.get("prompt_upsampling")
    )

    # Provider call
    from programs.image_generator.providers.image_generation import generate_images  # local import (keeps module light)

    provider_name = "replicate"
    try:
        provider_resp = generate_images(
            prompt=prompt_text,
            num_outputs=n,
            output_format=str(payload.get("outputFormat") or payload.get("output_format") or "url"),
            model_id=model_id,
            use_case=str(payload.get("useCase") or "").strip() or None,
            negative_prompt=negative_prompt,
            aspect_ratio=aspect_ratio,
            width=width,
            height=height,
            num_inference_steps=num_inference_steps,
            guidance_scale=guidance_scale,
            prompt_strength=prompt_strength,
            image_prompt_strength=image_prompt_strength,
            safety_tolerance=safety_tolerance,
            prompt_upsampling=prompt_upsampling,
            go_fast=go_fast,
            reference_images=reference_images_list,
            scene_image=scene_image,
            product_image=product_image,
        )
    except Exception as e:
        msg = f"{type(e).__name__}: {e}"
        print(
            "[image_generator] generate_image provider_exception",
            {"provider": provider_name, "requestId": request_id, "error": msg[:500]},
            flush=True,
        )
        return {
            "ok": False,
            "error": "image_provider_exception",
            "message": msg,
            "provider": provider_name,
            "requestId": request_id,
            "status": "failed",
        }

    try:
        # We now pass-through the provider's response (Replicate prediction JSON).
        pred_id = provider_resp.get("id") if isinstance(provider_resp, dict) else None
        pred_status = str(provider_resp.get("status") or "") if isinstance(provider_resp, dict) else ""
        pred_out = provider_resp.get("output") if isinstance(provider_resp, dict) else None
        images_count = len(pred_out) if isinstance(pred_out, list) else (1 if isinstance(pred_out, str) else 0)
        err_msg = _extract_provider_error(provider_resp)
        print(
            "[image_generator] generate_image provider_response",
            {
                "provider": provider_name,
                "status": pred_status or None,
                "id": pred_id,
                "imagesCount": images_count,
                "hasError": bool(err_msg) or (str(pred_status).lower() in {"failed", "timeout", "canceled"}),
                "error": (err_msg[:220] + "…") if (isinstance(err_msg, str) and len(err_msg) > 220) else (err_msg or None),
            },
            flush=True,
        )
    except Exception:
        pass

    # Pass-through, but add a consistent `ok` + error surface for clients.
    if not isinstance(provider_resp, dict):
        return {
            "ok": False,
            "error": "invalid_provider_response",
            "message": "Image provider returned invalid response",
            "provider": provider_name,
            "requestId": request_id,
            "status": "failed",
        }

    status = str(provider_resp.get("status") or "").lower()
    if status in {"failed", "timeout", "canceled"}:
        msg = _extract_provider_error(provider_resp) or f"Image generation {status}."
        return {
            **provider_resp,
            "ok": False,
            "error": "image_generation_failed",
            "message": msg,
            "provider": provider_name,
            "requestId": request_id,
        }

    return {**provider_resp, "ok": True, "provider": provider_name, "requestId": request_id}
