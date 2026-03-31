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
import re
import time
from typing import Any, Dict, Optional

from programs.common.visual_text_safety import sanitize_visual_context_text
from programs.image_generator.request_context import (
    extract_negative_prompt,
    extract_reference_images,
    is_anchor_edit_for_prompt,
    provider_image_inputs,
)
from programs.image_generator.request_normalizer import resolve_image_request


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


def _truncate_text(value: Any, *, limit: int = 240) -> str:
    text = str(value or "").strip()
    if len(text) > limit:
        return text[:limit] + "..."
    return text


def _payload_summary(payload: Dict[str, Any]) -> Dict[str, Any]:
    step_data = payload.get("stepDataSoFar") if isinstance(payload.get("stepDataSoFar"), dict) else {}
    answered = payload.get("answeredQA") if isinstance(payload.get("answeredQA"), list) else []
    refs = payload.get("referenceImages") if isinstance(payload.get("referenceImages"), list) else []
    routing = payload.get("routingPolicy") if isinstance(payload.get("routingPolicy"), dict) else {}
    return {
        "instanceId": _truncate_text(payload.get("instanceId"), limit=80) or None,
        "sessionId": _truncate_text(payload.get("sessionId") or ((payload.get("session") or {}).get("sessionId") if isinstance(payload.get("session"), dict) else ""), limit=80) or None,
        "useCase": _truncate_text(payload.get("useCase"), limit=40) or None,
        "modelId": _truncate_text(payload.get("modelId"), limit=120) or None,
        "generationIntent": _truncate_text(payload.get("generationIntent"), limit=40) or None,
        "variationMode": _truncate_text(payload.get("variationMode"), limit=40) or None,
        "numOutputs": payload.get("numOutputs"),
        "referenceImagesCount": len(refs),
        "hasSceneImage": bool(str(payload.get("sceneImage") or "").strip()),
        "hasProductImage": bool(str(payload.get("productImage") or "").strip()),
        "hasUserImage": bool(str(payload.get("userImage") or "").strip()),
        "stepDataKeys": sorted(list(step_data.keys()))[:20],
        "answeredQACount": len(answered),
        "routingPolicy": {
            "provider": routing.get("provider"),
            "priorities": routing.get("priorities"),
            "traits": routing.get("traits"),
            "requiredTags": routing.get("requiredTags"),
        } if routing else None,
    }


def _prompt_inputs_summary(inputs: Dict[str, Any]) -> Dict[str, Any]:
    return {
        key: (_truncate_text(value, limit=320) if isinstance(value, str) else value)
        for key, value in inputs.items()
    }


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


def _as_int(v: Any) -> Optional[int]:
    try:
        if v is None:
            return None
        return int(v)
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


def _is_placeholder_service_name(name: str) -> bool:
    t = (name or "").strip().lower()
    return not t or t == "service"


def _infer_service_label_from_summary(summary: str) -> str:
    """When clients send serviceSummary but omit service.name, derive a short domain label for DSPy."""
    text = str(summary or "").strip()
    if not text:
        return ""
    lower = text.lower()
    for sep in (" is a ", " is an ", " involves ", " means ", " refers to ", " includes "):
        pos = lower.find(sep)
        if 4 <= pos <= 120:
            return sanitize_visual_context_text(text[:pos].strip(), max_len=160)
    first_sentence = text.split(".")[0].strip()
    return sanitize_visual_context_text(first_sentence, max_len=160)


def _compact_dict_for_prefs(d: Dict[str, Any]) -> str:
    """Shorten nested dicts (e.g. pricing blobs) so Groq/DSPy requests stay under context limits."""
    if not isinstance(d, dict) or not d:
        return ""
    if "totalMin" in d and "totalMax" in d:
        try:
            lo = int(float(d.get("totalMin")))
            hi = int(float(d.get("totalMax")))
            cur = str(d.get("currency") or "USD").strip() or "USD"
            conf = str(d.get("confidence") or "").strip()
            tail = f", confidence {conf}" if conf else ""
            return f"pricing ~${lo:,}–${hi:,} {cur}{tail}"
        except Exception:
            pass
    try:
        blob = json.dumps(d, ensure_ascii=False, separators=(",", ":"))
    except Exception:
        blob = str(d)
    return sanitize_visual_context_text(blob, max_len=360)


def _extract_dspy_inputs(payload: Dict[str, Any]) -> Dict[str, Any]:
    """Extract structured inputs shared across the active DSPy prompt modules."""
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
    svc_raw = ctx.get("service")
    svc = svc_raw if isinstance(svc_raw, dict) else {}
    service_name = sanitize_visual_context_text(str(svc.get("name") or "").strip(), max_len=160)
    service_summary = sanitize_visual_context_text(ctx.get("serviceSummary") or ctx.get("service_summary") or "", max_len=500)
    if _is_placeholder_service_name(service_name) and service_summary:
        inferred = _infer_service_label_from_summary(service_summary)
        if inferred:
            service_name = inferred

    use_case = str(payload.get("useCase") or payload.get("use_case") or "scene").strip().lower()
    is_edit = is_anchor_edit_for_prompt(payload)

    prefs_parts = []
    skip_keys = {"step-service-primary", "service_primary", "collect_context"}
    for k, v in step_data.items():
        if k in skip_keys or str(k).startswith("__"):
            continue
        if isinstance(v, dict):
            val = _compact_dict_for_prefs(v)
        elif isinstance(v, str) and v.strip().lower().startswith("data:"):
            val = "[inline image]"
        else:
            val = clean(v)
        if not val:
            continue
        line = f"{k}: {val}"
        if len(line) > 420:
            line = f"{line[:417]}..."
        prefs_parts.append(line)

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

    pref_text = "\n".join(prefs_parts[:18])
    if len(pref_text) > 5200:
        pref_text = f"{pref_text[:5197]}..."

    return {
        "service_name": service_name or "Home improvement",
        "service_summary": service_summary,
        "use_case": use_case,
        "is_edit": is_edit,
        "user_preferences": pref_text,
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
    elif generation_intent_raw == "budget_tier_shift":
        out["generation_intent"] = "budget_tier_shift"
    elif generation_intent_raw in ("small_improvement", "refine", "refinement", "regenerate"):
        out["generation_intent"] = "refinement"
    else:
        out["generation_intent"] = "initial" if not bool(inputs.get("is_edit")) else "refinement"
    if bool(inputs.get("is_edit")):
        if out["generation_intent"] == "initial":
            out["reference_adherence"] = (
                "INITIAL LARGE OVERHAUL: Treat the uploaded photo as the source space. Generate the fully completed result. "
                "Preserve ONLY: room layout, camera angle, structural walls, perspective. REPLACE everything else the service touches — "
                "all finishes, fixtures, materials, surfaces. Every service-touched element must look brand-new and professionally done. "
                "Nothing old, worn, or original should remain in the renovated scope."
            )
        elif out["generation_intent"] == "budget_tier_shift":
            out["reference_adherence"] = (
                "BUDGET TIER SHIFT: preserve the room geometry, camera, perspective, and structural shell, but allow BROAD replacement "
                "of service-touched finishes, fixtures, materials, and surfaces so the image clearly moves into a new budget tier. "
                "Do not limit the edit to tiny accessories."
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


def _use_fast_schnell_scene_prompt(payload: Dict[str, Any]) -> bool:
    """Skip DSPy LLM for Schnell text-to-scene when latency matters (see IMAGE_SCENE_USE_DSPY_PROMPT to opt in)."""
    if str(os.getenv("IMAGE_SCENE_USE_DSPY_PROMPT") or "").strip().lower() in ("1", "true", "yes", "on"):
        return False
    mid = str(payload.get("modelId") or payload.get("model_id") or "").strip().lower()
    if "flux-schnell" not in mid:
        return False
    raw_uc = str(payload.get("useCase") or payload.get("use_case") or "scene").strip().lower().replace("_", "-")
    if raw_uc != "scene":
        return False
    if is_anchor_edit_for_prompt(payload):
        return False
    gi = str(payload.get("generationIntent") or payload.get("generation_intent") or "").strip().lower().replace("-", "_")
    if gi and gi not in ("initial", "budget_tier_shift"):
        return False
    return True


def _build_fast_schnell_scene_prompt(payload: Dict[str, Any], request_id: str) -> Optional[Dict[str, Any]]:
    """Deterministic photorealistic prompt for Flux Schnell (no LLM round-trip)."""
    from programs.image_generator.helpers.prompt_templates import get_negative_prompt
    from programs.image_generator.schemas.image_prompt import ImagePromptSpec

    try:
        inputs = _extract_scene_inputs(payload)
    except Exception:
        return None

    service_name = str(inputs.get("service_name") or "").strip() or "home improvement"
    style_tags = str(inputs.get("style_tags") or "").strip()
    prefs = str(inputs.get("user_preferences") or "").strip()
    budget = str(inputs.get("budget_level") or "").strip()
    location = str(inputs.get("location") or "").strip()
    gen_intent = str(inputs.get("generation_intent") or "initial")

    def _humanize_styles(s: str) -> str:
        parts = [p.strip().replace("_", " ") for p in re.split(r"[,]", s) if p.strip()]
        return ", ".join(parts[:14])

    style_phrase = _humanize_styles(style_tags)
    detail_bits: list[str] = []
    if prefs:
        detail_bits.append(sanitize_visual_context_text(prefs, max_len=900))
    if budget:
        detail_bits.append(f"Budget around {budget} USD.")
    if location:
        detail_bits.append(f"Region {location}.")
    details = sanitize_visual_context_text(" ".join(detail_bits), max_len=1150)

    if gen_intent == "budget_tier_shift":
        lead = (
            f"Photorealistic photograph of a visibly upgraded {service_name} outcome with higher-end finishes "
            "and fixtures than a basic remodel."
        )
    else:
        lead = (
            f"Photorealistic editorial photograph of a completed professional {service_name} outcome, "
            "believable finished installation."
        )

    tail = (
        " Natural soft lighting, realistic materials, sharp focus, interior photography, "
        "no people, no text overlays, no logos."
    )
    mid = f" {style_phrase} aesthetic." if style_phrase else ""
    detail_clause = f" {details}" if details else ""

    prompt_text = sanitize_visual_context_text(f"{lead}{mid}{detail_clause}{tail}", max_len=1500)
    if len(prompt_text) < 24:
        prompt_text = sanitize_visual_context_text(
            f"Photorealistic photograph of a finished {service_name} result.{tail}", max_len=1500
        )

    neg_text = get_negative_prompt("black-forest-labs/flux-schnell")
    spec_obj = {
        "prompt": prompt_text,
        "negativePrompt": neg_text,
        "styleTags": [t.strip() for t in style_phrase.split(",") if t.strip()],
        "isEdit": False,
        "metadata": {"useCase": "scene", "dspy": False, "fastPath": "schnell_scene", "isEdit": False},
    }
    try:
        spec = ImagePromptSpec.model_validate(spec_obj).model_dump(by_alias=True)
    except Exception:
        return None

    print(
        "[image_generator] prompt_built",
        {
            "module": "fast_schnell_scene",
            "useCase": "scene",
            "isEdit": False,
            "promptPreview": _truncate_text(prompt_text, limit=220),
            "negativePromptPreview": _truncate_text(neg_text, limit=220),
        },
        flush=True,
    )
    return {"ok": True, "requestId": request_id, "prompt": spec}


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
    generation_intent_raw = str(
        payload.get("generationIntent") or payload.get("generation_intent") or ""
    ).strip().lower().replace("-", "_")
    previous_prompt = sanitize_visual_context_text(
        payload.get("previousPrompt") or payload.get("previous_prompt") or "",
        max_len=500,
    )
    refinement_notes = sanitize_visual_context_text(
        payload.get("refinementNotes")
        or payload.get("refinement_notes")
        or (
            (payload.get("stepDataSoFar") or payload.get("step_data_so_far") or {}).get("step-promptInput")
            if isinstance(payload.get("stepDataSoFar") or payload.get("step_data_so_far") or {}, dict)
            else ""
        )
        or "",
        max_len=500,
    )
    tier_shift_refinement = generation_intent_raw == "budget_tier_shift"
    return {
        "service_summary": placement_inputs.get("service_summary") or "Refine the current scene design.",
        "subject": placement_inputs.get("subject") or "project",
        "style_tags": placement_inputs.get("style_tags") or "",
        "location": placement_inputs.get("location") or "",
        "scene_context": "User provided an existing scene/design image that should remain the anchor.",
        "user_preferences": placement_inputs.get("user_preferences") or "",
        "previous_prompt": previous_prompt,
        "refinement_notes": (
            "Budget tier shift requested. Make broad finish/material changes that clearly match the new budget tier while preserving geometry. "
            + refinement_notes
            if tier_shift_refinement and refinement_notes
            else "Budget tier shift requested. Make broad finish/material changes that clearly match the new budget tier while preserving geometry."
            if tier_shift_refinement
            else refinement_notes
        ),
        "reference_adherence": (
            "Budget tier shift anchor constraint: preserve the current scene composition, camera, perspective, geometry, and lighting "
            "direction, but allow broad replacement of service-touched materials, fixtures, and finishes so the result visibly lands in "
            "the new budget tier."
            if tier_shift_refinement
            else "Hard anchor constraint: preserve the current scene composition, camera, perspective, geometry, depth relationships, "
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


def _build_dspy_prompt(payload: Dict[str, Any], request_id: str) -> Optional[Dict[str, Any]]:
    """
    Attempt DSPy-based prompt generation.
    Returns None when DSPy is unavailable or fails to produce a valid prompt spec.
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
        from programs.image_generator.dspy.scene_placement_prompt import ScenePlacementPromptModule
        from programs.image_generator.dspy.scene_prompt import ScenePromptModule
        from programs.image_generator.dspy.scene_refinement_prompt import SceneRefinementPromptModule
        from programs.image_generator.dspy.tryon_prompt import TryonPromptModule
        from programs.image_generator.helpers.prompt_templates import get_negative_prompt
        from programs.image_generator.schemas.image_prompt import ImagePromptSpec
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
    is_edit = is_anchor_edit_for_prompt(payload)

    pred = None
    used_module_name = ""
    style_tags_str = ""

    try:
        if use_case == "scene":
            inputs = _extract_scene_inputs(payload)
            module = ScenePromptModule()
            print(
                "[image_generator] dspy_prompt_inputs",
                {"useCase": use_case, "module": "scene", "inputs": _prompt_inputs_summary(inputs)},
                flush=True,
            )
            pred = module(**inputs)
            used_module_name = "scene"
            style_tags_str = inputs.get("style_tags", "")

        elif use_case == "scene-placement":
            inputs = _extract_scene_placement_inputs(payload)
            module = ScenePlacementPromptModule()
            print(
                "[image_generator] dspy_prompt_inputs",
                {"useCase": use_case, "module": "scene-placement", "inputs": _prompt_inputs_summary(inputs)},
                flush=True,
            )
            pred = module(**inputs)
            used_module_name = "scene-placement"
            style_tags_str = inputs.get("style_tags", "")

        elif use_case == "scene-refinement":
            inputs = _extract_scene_refinement_inputs(payload)
            module = SceneRefinementPromptModule()
            print(
                "[image_generator] dspy_prompt_inputs",
                {"useCase": use_case, "module": "scene-refinement", "inputs": _prompt_inputs_summary(inputs)},
                flush=True,
            )
            pred = module(**inputs)
            used_module_name = "scene-refinement"
            style_tags_str = inputs.get("style_tags", "")

        elif use_case == "tryon":
            inputs = _extract_tryon_inputs(payload)
            module = TryonPromptModule()
            print(
                "[image_generator] dspy_prompt_inputs",
                {"useCase": use_case, "module": "tryon", "inputs": _prompt_inputs_summary(inputs)},
                flush=True,
            )
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

    print(
        "[image_generator] prompt_built",
        {
            "module": used_module_name,
            "useCase": use_case,
            "isEdit": is_edit,
            "promptPreview": _truncate_text(prompt_text, limit=220),
            "negativePromptPreview": _truncate_text(neg_text, limit=220),
        },
        flush=True,
    )
    return {"ok": True, "requestId": request_id, "prompt": spec}


def build_image_prompt(payload: Dict[str, Any]) -> Dict[str, Any]:
    """
    Build an image prompt spec: fast deterministic path for Schnell text-to-scene, else DSPy.
    """
    request_id = f"image_prompt_{int(time.time() * 1000)}"
    if _use_fast_schnell_scene_prompt(payload):
        fast = _build_fast_schnell_scene_prompt(payload, request_id)
        if fast and fast.get("ok"):
            return fast
    dspy_result = _build_dspy_prompt(payload, request_id)
    if dspy_result and dspy_result.get("ok"):
        return dspy_result
    return {
        "ok": False,
        "error": "dspy_prompt_unavailable",
        "message": "DSPy prompt generation is unavailable or failed for this request.",
        "requestId": request_id,
    }


def _normalize_generation_request(payload: Dict[str, Any]) -> Dict[str, Any]:
    return resolve_image_request(payload)


def _resolve_prompt_phase(payload: Dict[str, Any]) -> tuple[Optional[str], Optional[str], Optional[Dict[str, Any]]]:
    prompt_text = str(payload.get("prompt") or "").strip()
    negative_prompt = extract_negative_prompt(payload) or None
    if prompt_text:
        print(
            "[image_generator] prompt_phase",
            {
                "source": "request",
                "promptPreview": _truncate_text(prompt_text, limit=220),
                "negativePromptPreview": _truncate_text(negative_prompt, limit=220) or None,
            },
            flush=True,
        )
        return prompt_text, negative_prompt, None

    prompt_result = build_image_prompt(payload)
    if not isinstance(prompt_result, dict) or not prompt_result.get("ok"):
        print(
            "[image_generator] prompt_phase",
            {
                "source": "dspy",
                "ok": False,
                "error": (prompt_result or {}).get("error") if isinstance(prompt_result, dict) else "invalid_prompt_result",
                "message": (prompt_result or {}).get("message") if isinstance(prompt_result, dict) else None,
            },
            flush=True,
        )
        return None, None, prompt_result if isinstance(prompt_result, dict) else {
            "ok": False,
            "error": "image_prompt_failed",
            "message": "Prompt builder returned an invalid response.",
        }

    prompt_obj = prompt_result.get("prompt") if isinstance(prompt_result.get("prompt"), dict) else {}
    _log_verbose("generated_prompt_spec", prompt_obj)
    prompt_text = ((prompt_obj.get("prompt") if isinstance(prompt_obj, dict) else "") or "").strip()

    if isinstance(prompt_obj, dict) and isinstance(prompt_obj.get("negativePrompt"), str):
        negative_prompt = str(prompt_obj.get("negativePrompt") or "").strip() or None
    if not negative_prompt:
        negative_prompt = extract_negative_prompt(payload) or None
    meta = prompt_obj.get("metadata") if isinstance(prompt_obj.get("metadata"), dict) else {}
    prompt_source = (
        "fast_schnell_scene"
        if meta.get("fastPath") == "schnell_scene"
        else "dspy"
    )
    print(
        "[image_generator] prompt_phase",
        {
            "source": prompt_source,
            "ok": True,
            "promptPreview": _truncate_text(prompt_text, limit=220),
            "negativePromptPreview": _truncate_text(negative_prompt, limit=220) or None,
        },
        flush=True,
    )
    return prompt_text, negative_prompt, None


def _execute_provider_phase(
    payload: Dict[str, Any],
    *,
    prompt_text: str,
    negative_prompt: Optional[str],
) -> Dict[str, Any]:
    from programs.image_generator.providers.image_generation import generate_images

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

    reference_images, scene_image, product_image = provider_image_inputs(payload)
    reference_images_list: Optional[list[str]] = reference_images if reference_images else None

    return generate_images(
        prompt=prompt_text,
        num_outputs=n,
        output_format=str(payload.get("outputFormat") or payload.get("output_format") or "png"),
        model_id=str(payload.get("modelId") or payload.get("model_id") or "").strip() or None,
        use_case=str(payload.get("useCase") or "").strip() or None,
        negative_prompt=negative_prompt,
        aspect_ratio=str(payload.get("aspectRatio") or payload.get("aspect_ratio") or "").strip() or None,
        width=_as_int(payload.get("width")),
        height=_as_int(payload.get("height")),
        num_inference_steps=_as_int(payload.get("numInferenceSteps") or payload.get("num_inference_steps")),
        guidance_scale=_as_float(payload.get("guidanceScale") or payload.get("guidance_scale")),
        prompt_strength=_as_float(payload.get("promptStrength") or payload.get("prompt_strength") or payload.get("strength")),
        image_prompt_strength=_as_float(payload.get("imagePromptStrength") or payload.get("image_prompt_strength")),
        safety_tolerance=_as_int(payload.get("safetyTolerance") or payload.get("safety_tolerance")),
        prompt_upsampling=_as_bool(payload.get("promptUpsampling") or payload.get("prompt_upsampling")),
        go_fast=_as_bool(payload.get("goFast") or payload.get("go_fast")),
        reference_images=reference_images_list,
        scene_image=scene_image,
        product_image=product_image,
    )


def generate_image(payload: Dict[str, Any]) -> Dict[str, Any]:
    """
    End-to-end image generation:
    - Build prompt via DSPy from the provided context
    - Call the image provider (Replicate)
    - Return `{ images: string[], predictionId }` for widget compatibility
    """
    request_id = f"image_{int(time.time() * 1000)}"
    payload = _normalize_generation_request(payload)
    variation_mode = str(payload.get("variationMode") or payload.get("variation_mode") or "").strip().lower()

    print(
        "[image_generator] request_normalized",
        {
            "requestId": request_id,
            "summary": _payload_summary(payload),
        },
        flush=True,
    )

    if variation_mode == "price_ladder_9":
        from programs.pricing.price_ladder_gallery import generate_price_ladder_gallery

        return generate_price_ladder_gallery(payload)

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
                "requestId": request_id,
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

    prompt_text, negative_prompt, prompt_error = _resolve_prompt_phase(payload)
    if prompt_error:
        if "requestId" not in prompt_error:
            prompt_error["requestId"] = request_id
        return prompt_error

    provider_name = "replicate"
    try:
        provider_resp = _execute_provider_phase(
            payload,
            prompt_text=prompt_text,
            negative_prompt=negative_prompt,
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
