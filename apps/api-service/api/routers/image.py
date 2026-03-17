from __future__ import annotations

import json
import os
import time
from typing import Any, Dict, Optional

from fastapi import APIRouter, Body
from fastapi.responses import JSONResponse
from starlette.status import HTTP_400_BAD_REQUEST

from api.request_adapter import to_next_steps_payload
from api.utils import dedup_urls, normalize_output_urls
from programs.image_generator.model_selector import select_model, select_routing_policy
from programs.image_generator.orchestrator import build_image_prompt, generate_image


def register(router: APIRouter, compat_router: APIRouter) -> None:
    # Process-local prompt cache (keeps prompt-only fast). Suitable for single-process dev.
    # In serverless/prod, consider a shared cache (Redis/Upstash) if needed.
    _PROMPT_CACHE: dict[str, tuple[float, dict[str, Any]]] = {}

    def _generate_with_optional_optimized_request(payload: Dict[str, Any]) -> Dict[str, Any]:
        """
        Service-side model routing entry point.

        Keep provider-selection logic in api-service so widget routes remain a
        thin transport/proxy layer.
        """
        return generate_image(payload)

    def _provider_from_prediction(pred: Any) -> str:
        if isinstance(pred, dict):
            provider = str(pred.get("provider") or "").strip().lower()
            if provider:
                return provider
        return "replicate"

    def _has_explicit_value(payload: Dict[str, Any], *keys: str) -> bool:
        for key in keys:
            if key not in payload:
                continue
            value = payload.get(key)
            if value is None:
                continue
            if isinstance(value, str) and not value.strip():
                continue
            if isinstance(value, (list, tuple, dict)) and len(value) == 0:
                continue
            return True
        return False

    def _apply_replicate_routing_defaults(
        *,
        payload: Dict[str, Any],
        adapted: Dict[str, Any],
        use_case: str,
        num_input_images: int,
        has_scene_image: bool = False,
        has_product_image: bool = False,
        has_user_image: bool = False,
        is_edit: bool = False,
    ) -> Dict[str, Any]:
        recommendation = select_model(
            use_case=use_case,
            num_input_images=max(0, int(num_input_images or 0)),
            has_scene_image=bool(has_scene_image),
            has_product_image=bool(has_product_image),
            has_user_image=bool(has_user_image),
        )
        routing_policy = select_routing_policy(use_case=use_case, is_edit=bool(is_edit))

        if not _has_explicit_value(payload, "modelId", "model_id"):
            adapted["modelId"] = recommendation.model_id
        if not _has_explicit_value(payload, "guidanceScale", "guidance_scale"):
            adapted["guidanceScale"] = recommendation.guidance_scale
        if not _has_explicit_value(payload, "numInferenceSteps", "num_inference_steps"):
            adapted["numInferenceSteps"] = recommendation.num_inference_steps
        if not _has_explicit_value(payload, "outputFormat", "output_format"):
            adapted["outputFormat"] = recommendation.output_format
        if recommendation.prompt_upsampling is not None and not _has_explicit_value(payload, "promptUpsampling", "prompt_upsampling"):
            adapted["promptUpsampling"] = recommendation.prompt_upsampling
        if not _has_explicit_value(payload, "safetyTolerance", "safety_tolerance"):
            adapted["safetyTolerance"] = recommendation.safety_tolerance
        if routing_policy.prompt_strength is not None and not _has_explicit_value(payload, "promptStrength", "prompt_strength", "strength"):
            adapted["promptStrength"] = routing_policy.prompt_strength
        if routing_policy.image_prompt_strength is not None and not _has_explicit_value(payload, "imagePromptStrength", "image_prompt_strength"):
            adapted["imagePromptStrength"] = routing_policy.image_prompt_strength
        if routing_policy.go_fast is not None and not _has_explicit_value(payload, "goFast", "go_fast"):
            adapted["goFast"] = routing_policy.go_fast

        if not _has_explicit_value(payload, "traits"):
            adapted["traits"] = list(routing_policy.traits)
        if routing_policy.required_tags and not _has_explicit_value(payload, "requiredTags", "required_tags"):
            adapted["requiredTags"] = list(routing_policy.required_tags)
        if not _has_explicit_value(payload, "routingPriorities", "routing_priorities"):
            adapted["routingPriorities"] = list(routing_policy.priorities)

        adapted["provider"] = "replicate"
        adapted["routingPolicy"] = routing_policy.to_dict()
        return routing_policy.to_dict()

    def _prompt_cache_get(key: str) -> Optional[dict[str, Any]]:
        if not key:
            return None
        rec = _PROMPT_CACHE.get(key)
        if not rec:
            return None
        expires_at, value = rec
        if time.time() >= float(expires_at):
            _PROMPT_CACHE.pop(key, None)
            return None
        return value

    def _prompt_cache_set(key: str, value: dict[str, Any], ttl_sec: int) -> None:
        if not key:
            return
        ttl = max(5, min(3600, int(ttl_sec or 0)))
        _PROMPT_CACHE[key] = (time.time() + ttl, value)

    def _option_images_debug_enabled() -> bool:
        return str(os.getenv("AI_FORM_OPTION_IMAGES_DEBUG_LOG") or "").strip().lower() in {"1", "true", "yes", "on"}

    def _option_images_debug_log(label: str, data: Dict[str, Any], *, force: bool = False) -> None:
        if not force and not _option_images_debug_enabled():
            return
        try:
            text = json.dumps(data, ensure_ascii=False, sort_keys=True)
            if len(text) > 6000:
                text = text[:6000] + "…"
            print(f"[option_images] {label} {text}", flush=True)
        except Exception:
            print(f"[option_images] {label} (unable to serialize)", flush=True)

    @router.post("/image")
    def image(payload: Dict[str, Any] = Body(default_factory=dict)) -> Any:
        instance_id = ""
        if isinstance(payload.get("instanceId"), str):
            instance_id = str(payload.get("instanceId") or "").strip()
        if not instance_id and isinstance(payload.get("session"), dict):
            instance_id = str((payload.get("session") or {}).get("instanceId") or "").strip()
        if not instance_id:
            return {"ok": False, "error": "instanceId is required"}

        for k in ("prompt", "promptTemplate"):
            if k in payload and payload.get(k) not in (None, ""):
                return JSONResponse(
                    status_code=HTTP_400_BAD_REQUEST,
                    content={
                        "ok": False,
                        "error": "unsupported_field",
                        "message": f"Field '{k}' is not supported; prompts are generated server-side.",
                    },
                )

        adapted = to_next_steps_payload(instance_id=instance_id, body=payload)
        for k in ("prompt", "promptTemplate"):
            adapted.pop(k, None)
        for k in (
            "numOutputs",
            "outputFormat",
            "modelId",
            "negativePrompt",
            "width",
            "height",
            "numInferenceSteps",
            "guidanceScale",
            "referenceImages",
            "sceneImage",
            "productImage",
        ):
            if k in payload and payload.get(k) is not None:
                adapted[k] = payload.get(k)
        use_case = str(adapted.get("useCase") or payload.get("useCase") or "scene").strip().lower().replace("_", "-")
        refs = adapted.get("referenceImages") if isinstance(adapted.get("referenceImages"), list) else []
        scene_image = str(adapted.get("sceneImage") or "").strip()
        product_image = str(adapted.get("productImage") or "").strip()
        user_image = str(adapted.get("userImage") or "").strip()
        _apply_replicate_routing_defaults(
            payload=payload,
            adapted=adapted,
            use_case=use_case,
            num_input_images=len(refs),
            has_scene_image=bool(scene_image),
            has_product_image=bool(product_image),
            has_user_image=bool(user_image),
            is_edit=bool(refs or scene_image or product_image or user_image),
        )
        return generate_image(adapted)

    @router.post("/image/prompt")
    def image_prompt(payload: Dict[str, Any] = Body(default_factory=dict)) -> Any:
        """
        Prompt-only endpoint: returns the deterministic ImagePromptSpec without generating images.
        """
        instance_id = ""
        if isinstance(payload.get("instanceId"), str):
            instance_id = str(payload.get("instanceId") or "").strip()
        if not instance_id and isinstance(payload.get("session"), dict):
            instance_id = str((payload.get("session") or {}).get("instanceId") or "").strip()
        if not instance_id:
            return {"ok": False, "error": "instanceId is required"}

        adapted = to_next_steps_payload(instance_id=instance_id, body=payload)
        for k in (
            "useCase",
            "modelId",
            "negativePrompt",
            "referenceImages",
            "sceneImage",
            "productImage",
        ):
            if k in payload and payload.get(k) is not None:
                adapted[k] = payload.get(k)

        # Cache key: session + step data hash + use case + model/version-ish.
        try:
            from api.utils import hash_step_data  # noqa: E402
            from api.payload_extractors import extract_session_id  # noqa: E402

            session_id = str(extract_session_id(adapted) or "").strip()
            step_data = adapted.get("stepDataSoFar") if isinstance(adapted.get("stepDataSoFar"), dict) else {}
            state_hash = hash_step_data(step_data)
            refs = adapted.get("referenceImages") if isinstance(adapted.get("referenceImages"), list) else []
            # Include a short reference signature so prompt cache invalidates when refs change.
            refs_sig = hash_step_data({"refs": [str(x or "")[:120] for x in refs[:6]]}) if refs else "norefs"
            use_case = str(adapted.get("useCase") or "")
            model_id = str(adapted.get("modelId") or os.getenv("REPLICATE_MODEL_ID") or "").strip()
            mode = str(os.getenv("IMAGE_PROMPT_MODE") or "deterministic").strip().lower()
            cache_key = f"prompt:{instance_id}:{session_id}:{use_case}:{mode}:{model_id}:{state_hash}:{refs_sig}"
        except Exception:
            cache_key = ""

        disable_cache = bool(payload.get("noCache") is True or str(payload.get("noCache") or "").lower() == "true")
        if cache_key and not disable_cache:
            cached = _prompt_cache_get(cache_key)
            if cached:
                return cached

        out = build_image_prompt(adapted)
        if isinstance(out, dict) and out.get("ok") and cache_key and not disable_cache:
            ttl = int(os.getenv("AI_FORM_IMAGE_PROMPT_CACHE_TTL_SEC") or "60")
            _prompt_cache_set(cache_key, out, ttl_sec=ttl)
        return out

    @compat_router.post("/image")
    def image_compat(payload: Dict[str, Any] = Body(default_factory=dict)) -> Any:
        instance_id = ""
        if isinstance(payload.get("instanceId"), str):
            instance_id = str(payload.get("instanceId") or "").strip()
        if not instance_id and isinstance(payload.get("session"), dict):
            instance_id = str((payload.get("session") or {}).get("instanceId") or "").strip()
        if not instance_id:
            return {"ok": False, "error": "instanceId is required"}

        for k in ("prompt", "promptTemplate"):
            if k in payload and payload.get(k) not in (None, ""):
                return JSONResponse(
                    status_code=HTTP_400_BAD_REQUEST,
                    content={
                        "ok": False,
                        "error": "unsupported_field",
                        "message": f"Field '{k}' is not supported; prompts are generated server-side.",
                    },
                )

        adapted = to_next_steps_payload(instance_id=instance_id, body=payload)
        for k in ("prompt", "promptTemplate"):
            adapted.pop(k, None)
        for k in (
            "numOutputs",
            "outputFormat",
            "modelId",
            "negativePrompt",
            "width",
            "height",
            "numInferenceSteps",
            "guidanceScale",
            "referenceImages",
            "sceneImage",
            "productImage",
        ):
            if k in payload and payload.get(k) is not None:
                adapted[k] = payload.get(k)
        return _generate_with_optional_optimized_request(adapted)

    # Maps price_tier badges to concrete material/quality descriptors used in image prompts.
    _PRICE_TIER_DESCS: Dict[str, str] = {
        "$": "Budget-friendly, builder-grade materials, economy finishes, standard fixtures.",
        "$$": "Mid-range quality, quartz or laminate surfaces, semi-custom details.",
        "$$$": "Premium materials, natural stone, custom cabinetry, high-end fixtures.",
        "$$$$": "Luxury, bespoke finishes, marble, custom millwork, designer fixtures.",
    }

    @compat_router.post("/option-images/generate")
    @router.post("/option-images/generate")
    async def option_images_generate(payload: Dict[str, Any] = Body(default_factory=dict)) -> Any:
        step_id = str(payload.get("stepId") or payload.get("step_id") or "").strip()
        step_obj = payload.get("step") if isinstance(payload.get("step"), dict) else {}
        question = str(payload.get("question") or step_obj.get("question") or "").strip() or "Choose an option."
        options = (
            payload.get("options")
            if isinstance(payload.get("options"), list)
            else (step_obj.get("options") if isinstance(step_obj.get("options"), list) else [])
        )
        service_str = str(
            payload.get("service")
            or payload.get("serviceSummary")
            or payload.get("service_summary")
            or payload.get("industry")
            or "Service"
        ).strip() or "Service"

        # Extract overall budget context from the payload (passed from stepDataSoFar).
        budget_raw = str(
            payload.get("budgetRange")
            or payload.get("budget_range")
            or payload.get("budget")
            or ""
        ).strip()
        budget_context = ""
        if budget_raw:
            try:
                n = int(float(budget_raw))
                if n >= 1000:
                    budget_context = f"~${round(n / 1000):d}k budget"
                elif n > 0:
                    budget_context = f"~${n:d} budget"
            except Exception:
                if len(budget_raw) <= 40:
                    budget_context = budget_raw

        context_prompt = f"{service_str}: {question}"
        if budget_context:
            context_prompt = f"{context_prompt} [{budget_context}]"

        from programs.form_pipeline.orchestrator import _should_skip_option_image_for_label  # noqa: E402
        from programs.image_generator.providers.image_generation import generate_option_images_for_step  # noqa: E402

        prompts: list[str] = []
        indices: list[int] = []
        normalized: list[dict[str, Any]] = []
        # Hard cap: prevent runaway costs if client sends large option lists.
        try:
            max_opts = int(os.getenv("AI_FORM_OPTION_IMAGES_MAX_OPTIONS") or "24")
        except Exception:
            max_opts = 24
        max_opts = max(1, min(24, int(max_opts or 24)))

        session_id = ""
        if isinstance(payload.get("sessionId"), str):
            session_id = str(payload.get("sessionId") or "").strip()
        elif isinstance(payload.get("session"), dict):
            session_id = str((payload.get("session") or {}).get("sessionId") or "").strip()
        model_id = str(payload.get("modelId") or payload.get("model_id") or os.getenv("REPLICATE_OPTION_IMAGES_MODEL_ID") or "").strip() or "black-forest-labs/flux-schnell"
        seed_base = f"{session_id}|{model_id}" if session_id else None

        payload_reference_images = payload.get("referenceImages")
        reference_images_count = len(payload_reference_images) if isinstance(payload_reference_images, list) else 0
        _option_images_debug_log(
            "request",
            {
                "stepId": step_id or None,
                "question": question,
                "sessionId": session_id or None,
                "modelId": model_id,
                "optionsCount": len(options),
                "referenceImagesCount": reference_images_count,
                "budgetRange": budget_raw or None,
                "serviceSummary": service_str[:280],
                "options": [
                    {
                        "label": (str(opt.get("label") or opt.get("value") or "").strip() if isinstance(opt, dict) else str(opt or "").strip()),
                        "value": (str(opt.get("value") or "").strip() if isinstance(opt, dict) else str(opt or "").strip()),
                        "image_prompt": (str(opt.get("image_prompt") or opt.get("imagePrompt") or "").strip()[:200] if isinstance(opt, dict) else ""),
                        "price_tier": (str(opt.get("price_tier") or opt.get("priceTier") or "").strip() if isinstance(opt, dict) else ""),
                    }
                    for opt in options
                ],
            },
        )

        for opt in options:
            if isinstance(opt, str):
                label = opt.strip()
                value = opt.strip()
                image_prompt = ""
                price_tier = ""
            elif isinstance(opt, dict):
                label = str(opt.get("label") or opt.get("value") or "").strip()
                value = str(opt.get("value") or "").strip() or label
                image_prompt = str(opt.get("image_prompt") or opt.get("imagePrompt") or "").strip()
                price_tier = str(opt.get("price_tier") or opt.get("priceTier") or "").strip()
            else:
                continue
            item: Dict[str, Any] = {"label": label, "value": value}
            if price_tier in _PRICE_TIER_DESCS:
                item["price_tier"] = price_tier
            normalized.append(item)
            if not label or _should_skip_option_image_for_label(label):
                continue
            if len(indices) >= max_opts:
                continue
            prompt_text = image_prompt or label
            # Append price-tier material descriptor when available so images visually
            # differentiate budget levels (builder-grade vs luxury) rather than all
            # looking expensive.
            tier_suffix = ""
            if price_tier in _PRICE_TIER_DESCS:
                tier_suffix = f" {_PRICE_TIER_DESCS[price_tier]}"
            prompts.append(f"Photorealistic photo, no text, no words, no letters, no labels, no captions, no watermarks, no signs. {context_prompt}. Option: {prompt_text}.{tier_suffix}")
            indices.append(len(normalized) - 1)

        urls: list[Optional[str]] = []
        stats: dict[str, int] = {}
        if prompts:
            urls, stats = generate_option_images_for_step(prompts, model_id=model_id, seed_base=seed_base)
            for j, idx in enumerate(indices):
                if j < len(urls) and urls[j]:
                    normalized[idx]["imageUrl"] = urls[j]
        with_images = sum(1 for item in normalized if isinstance(item.get("imageUrl"), str) and str(item.get("imageUrl")).strip())
        response_obj = {"ok": True, "stepId": step_id, "question": question, "options": normalized, "stats": stats}
        _option_images_debug_log(
            "response",
            {
                "stepId": step_id or None,
                "question": question,
                "modelId": model_id,
                "optionsCount": len(normalized),
                "optionsWithImageUrl": with_images,
                "stats": stats,
            },
        )
        # Keep a compact warning always-on when generation attempted but produced no images.
        if prompts and with_images == 0:
            _option_images_debug_log(
                "warning_no_images_returned",
                {
                    "stepId": step_id or None,
                    "question": question,
                    "modelId": model_id,
                    "promptCount": len(prompts),
                    "stats": stats,
                },
                force=True,
            )
        return response_obj

    @compat_router.post("/option-images/regenerate")
    @router.post("/option-images/regenerate")
    async def option_images_regenerate(payload: Dict[str, Any] = Body(default_factory=dict)) -> Any:
        if str(os.getenv("AI_FORM_OPTION_IMAGES_REGENERATE") or "").strip().lower() not in {"1", "true", "yes"}:
            return JSONResponse(
                status_code=404,
                content={"ok": False, "error": "disabled", "message": "Option image regeneration is disabled."},
            )
        # Reuse the generator logic for now (same request shape).
        return await option_images_generate(payload)

    # Widget-style routes (ported 1:1, without credits/billing).

    @compat_router.post("/generate/try-on")
    @router.post("/generate/try-on")
    async def generate_try_on(payload: Dict[str, Any] = Body(default_factory=dict)) -> Any:
        prompt = str(payload.get("prompt") or "").strip()
        instance_id = str(payload.get("instanceId") or payload.get("instance_id") or "").strip()
        if not prompt:
            return JSONResponse(status_code=HTTP_400_BAD_REQUEST, content={"ok": False, "error": "prompt_required"})
        if not instance_id:
            return JSONResponse(status_code=HTTP_400_BAD_REQUEST, content={"ok": False, "error": "instanceId_required"})

        user_image = str(payload.get("userImage") or payload.get("user_image") or "").strip() or None
        product_image = str(payload.get("productImage") or payload.get("product_image") or "").strip() or None
        refs_in = payload.get("referenceImages") or payload.get("reference_images") or []
        refs = [x for x in (refs_in if isinstance(refs_in, list) else []) if isinstance(x, str) and x.strip()]
        reference_images = dedup_urls([u for u in [user_image, product_image, *refs] if u])
        if not reference_images:
            return JSONResponse(status_code=HTTP_400_BAD_REQUEST, content={"ok": False, "error": "referenceImages_required"})

        adapted = to_next_steps_payload(instance_id=instance_id, body=payload)
        step_data = adapted.get("stepDataSoFar") if isinstance(adapted.get("stepDataSoFar"), dict) else {}
        if prompt:
            step_data = {**step_data, "step-promptInput": prompt}
        adapted["stepDataSoFar"] = step_data
        adapted["useCase"] = "tryon"
        adapted["modelId"] = str(payload.get("modelId") or payload.get("model_id") or "google/nano-banana").strip()
        adapted["numOutputs"] = int(payload.get("numOutputs") or payload.get("gallery_max_images") or 4)
        adapted["outputFormat"] = str(payload.get("outputFormat") or payload.get("output_format") or "url")
        adapted["negativePrompt"] = str(payload.get("negativePrompt") or payload.get("negative_prompt") or "").strip() or None
        adapted["width"] = int(payload.get("width") or 1024)
        adapted["height"] = int(payload.get("height") or 1024)
        adapted["numInferenceSteps"] = int(payload.get("numInferenceSteps") or payload.get("num_inference_steps") or 18)
        adapted["guidanceScale"] = float(payload.get("guidanceScale") or payload.get("guidance_scale") or 6.0)
        adapted["referenceImages"] = reference_images
        if user_image:
            adapted["userImage"] = user_image
        if product_image:
            adapted["productImage"] = product_image
        routing_policy = _apply_replicate_routing_defaults(
            payload=payload,
            adapted=adapted,
            use_case="try-on",
            num_input_images=len(reference_images),
            has_product_image=bool(product_image),
            has_user_image=bool(user_image),
            is_edit=True,
        )

        pred = _generate_with_optional_optimized_request(adapted)
        images = normalize_output_urls(pred.get("output") if isinstance(pred, dict) else None)
        return {
            "ok": bool(isinstance(pred, dict) and pred.get("ok") and str(pred.get("status") or "").lower() == "succeeded"),
            "success": bool(isinstance(pred, dict) and pred.get("ok") and str(pred.get("status") or "").lower() == "succeeded"),
            "images": images,
            "predictionId": (pred.get("predictionId") or pred.get("id")) if isinstance(pred, dict) else None,
            "status": str(pred.get("status") or "") if isinstance(pred, dict) else "",
            "provider": _provider_from_prediction(pred),
            "modelId": adapted["modelId"],
            "instanceId": instance_id,
            "useCase": "try-on",
            "routingPolicy": routing_policy,
        }

    @compat_router.post("/generate/scene-placement")
    @router.post("/generate/scene-placement")
    async def generate_scene_placement(payload: Dict[str, Any] = Body(default_factory=dict)) -> Any:
        prompt = str(payload.get("prompt") or "").strip()
        instance_id = str(payload.get("instanceId") or payload.get("instance_id") or "").strip()
        scene_image = str(payload.get("sceneImage") or payload.get("scene_image") or "").strip()
        product_image = str(payload.get("productImage") or payload.get("product_image") or "").strip()
        if not prompt:
            return JSONResponse(status_code=HTTP_400_BAD_REQUEST, content={"ok": False, "error": "prompt_required"})
        if not instance_id:
            return JSONResponse(status_code=HTTP_400_BAD_REQUEST, content={"ok": False, "error": "instanceId_required"})
        if not scene_image:
            return JSONResponse(status_code=HTTP_400_BAD_REQUEST, content={"ok": False, "error": "sceneImage_required"})

        refs_in = payload.get("referenceImages") or payload.get("reference_images") or []
        refs = [x for x in (refs_in if isinstance(refs_in, list) else []) if isinstance(x, str) and x.strip()]
        seed_refs = [scene_image, *([product_image] if product_image else []), *refs]
        reference_images = dedup_urls(seed_refs)
        adapted = to_next_steps_payload(instance_id=instance_id, body=payload)
        step_data = adapted.get("stepDataSoFar") if isinstance(adapted.get("stepDataSoFar"), dict) else {}
        if prompt:
            step_data = {**step_data, "step-promptInput": prompt}
        adapted["stepDataSoFar"] = step_data
        adapted["useCase"] = "scene-placement"
        adapted["modelId"] = str(payload.get("modelId") or payload.get("model_id") or "xai/grok-imagine-image").strip()
        adapted["numOutputs"] = int(payload.get("numOutputs") or payload.get("gallery_max_images") or 4)
        adapted["outputFormat"] = str(payload.get("outputFormat") or payload.get("output_format") or "url")
        adapted["negativePrompt"] = str(payload.get("negativePrompt") or payload.get("negative_prompt") or "").strip() or None
        adapted["width"] = int(payload.get("width") or 1024)
        adapted["height"] = int(payload.get("height") or 1024)
        adapted["numInferenceSteps"] = int(payload.get("numInferenceSteps") or payload.get("num_inference_steps") or 18)
        adapted["guidanceScale"] = float(payload.get("guidanceScale") or payload.get("guidance_scale") or 6.0)
        adapted["referenceImages"] = reference_images
        adapted["sceneImage"] = scene_image
        if product_image:
            adapted["productImage"] = product_image
        routing_policy = _apply_replicate_routing_defaults(
            payload=payload,
            adapted=adapted,
            use_case="scene-placement",
            num_input_images=len(reference_images),
            has_scene_image=bool(scene_image),
            has_product_image=bool(product_image),
            is_edit=True,
        )

        pred = _generate_with_optional_optimized_request(adapted)
        images = normalize_output_urls(pred.get("output") if isinstance(pred, dict) else None)
        return {
            "ok": bool(isinstance(pred, dict) and pred.get("ok") and str(pred.get("status") or "").lower() == "succeeded"),
            "success": bool(isinstance(pred, dict) and pred.get("ok") and str(pred.get("status") or "").lower() == "succeeded"),
            "images": images,
            "predictionId": (pred.get("predictionId") or pred.get("id")) if isinstance(pred, dict) else None,
            "status": str(pred.get("status") or "") if isinstance(pred, dict) else "",
            "provider": _provider_from_prediction(pred),
            "modelId": adapted["modelId"],
            "instanceId": instance_id,
            "useCase": "scene-placement",
            "routingPolicy": routing_policy,
        }

    @compat_router.post("/generate/scene")
    @router.post("/generate/scene")
    async def generate_scene(payload: Dict[str, Any] = Body(default_factory=dict)) -> Any:
        prompt = str(payload.get("prompt") or "").strip()
        instance_id = str(payload.get("instanceId") or payload.get("instance_id") or "").strip()
        if not prompt:
            return JSONResponse(status_code=HTTP_400_BAD_REQUEST, content={"ok": False, "error": "prompt_required"})
        if not instance_id:
            return JSONResponse(status_code=HTTP_400_BAD_REQUEST, content={"ok": False, "error": "instanceId_required"})

        refs_in = payload.get("referenceImages") or payload.get("reference_images") or []
        refs = [x for x in (refs_in if isinstance(refs_in, list) else []) if isinstance(x, str) and x.strip()]
        ordered_candidates = [
            str(payload.get("userImage") or payload.get("user_image") or "").strip() or None,
            str(payload.get("sceneImage") or payload.get("scene_image") or "").strip() or None,
            str(payload.get("productImage") or payload.get("product_image") or "").strip() or None,
            *refs,
        ]
        ordered = [x for x in ordered_candidates if isinstance(x, str) and x]
        deduped = dedup_urls(ordered)
        is_edit = len(deduped) > 0
        primary_image = deduped[0] if is_edit else None

        model_id_default = "black-forest-labs/flux-kontext-pro" if is_edit else "black-forest-labs/flux-1.1-pro"
        adapted = to_next_steps_payload(instance_id=instance_id, body=payload)
        step_data = adapted.get("stepDataSoFar") if isinstance(adapted.get("stepDataSoFar"), dict) else {}
        if prompt:
            step_data = {**step_data, "step-promptInput": prompt}
        adapted["stepDataSoFar"] = step_data
        adapted["useCase"] = "scene"
        adapted["modelId"] = str(payload.get("modelId") or payload.get("model_id") or model_id_default).strip()
        adapted["numOutputs"] = int(payload.get("numOutputs") or payload.get("gallery_max_images") or 4)
        adapted["outputFormat"] = str(payload.get("outputFormat") or payload.get("output_format") or "url")
        adapted["negativePrompt"] = str(payload.get("negativePrompt") or payload.get("negative_prompt") or "").strip() or None
        adapted["width"] = int(payload.get("width") or 1024)
        adapted["height"] = int(payload.get("height") or 1024)
        adapted["numInferenceSteps"] = int(payload.get("numInferenceSteps") or payload.get("num_inference_steps") or (20 if is_edit else 18))
        adapted["guidanceScale"] = float(payload.get("guidanceScale") or payload.get("guidance_scale") or (4.0 if is_edit else 6.0))
        adapted["referenceImages"] = [primary_image] if primary_image else []
        adapted["sceneImage"] = primary_image or None
        routing_policy = _apply_replicate_routing_defaults(
            payload=payload,
            adapted=adapted,
            use_case="scene",
            num_input_images=len(adapted["referenceImages"]) if isinstance(adapted.get("referenceImages"), list) else 0,
            has_scene_image=bool(primary_image),
            is_edit=bool(is_edit),
        )

        pred = _generate_with_optional_optimized_request(adapted)
        images = normalize_output_urls(pred.get("output") if isinstance(pred, dict) else None)
        return {
            "ok": bool(isinstance(pred, dict) and pred.get("ok") and str(pred.get("status") or "").lower() == "succeeded"),
            "success": bool(isinstance(pred, dict) and pred.get("ok") and str(pred.get("status") or "").lower() == "succeeded"),
            "images": images,
            "predictionId": (pred.get("predictionId") or pred.get("id")) if isinstance(pred, dict) else None,
            "status": str(pred.get("status") or "") if isinstance(pred, dict) else "",
            "provider": _provider_from_prediction(pred),
            "modelId": adapted["modelId"],
            "instanceId": instance_id,
            "useCase": "scene",
            "isEdit": bool(is_edit),
            "routingPolicy": routing_policy,
        }

    @compat_router.post("/generate/drilldown")
    @router.post("/generate/drilldown")
    async def generate_drilldown(payload: Dict[str, Any] = Body(default_factory=dict)) -> Any:
        prompt = str(payload.get("prompt") or "").strip()
        instance_id = str(payload.get("instanceId") or payload.get("instance_id") or "").strip()
        if not prompt:
            return JSONResponse(status_code=HTTP_400_BAD_REQUEST, content={"ok": False, "error": "prompt_required"})
        if not instance_id:
            return JSONResponse(status_code=HTTP_400_BAD_REQUEST, content={"ok": False, "error": "instanceId_required"})

        selected_image = str(payload.get("selectedImage") or payload.get("selected_image") or "").strip() or None
        refs_in = payload.get("referenceImages") or payload.get("reference_images") or []
        refs = [x for x in (refs_in if isinstance(refs_in, list) else []) if isinstance(x, str) and x.strip()]
        reference_images = dedup_urls([u for u in [selected_image, *refs] if u])
        if not reference_images:
            return JSONResponse(status_code=HTTP_400_BAD_REQUEST, content={"ok": False, "error": "referenceImages_required"})

        adapted = to_next_steps_payload(instance_id=instance_id, body=payload)
        step_data = adapted.get("stepDataSoFar") if isinstance(adapted.get("stepDataSoFar"), dict) else {}
        if prompt:
            step_data = {**step_data, "step-promptInput": prompt}
        adapted["stepDataSoFar"] = step_data
        adapted["useCase"] = "scene"
        adapted["modelId"] = str(payload.get("modelId") or payload.get("model_id") or "google/nano-banana").strip()
        adapted["numOutputs"] = 1
        adapted["outputFormat"] = str(payload.get("outputFormat") or payload.get("output_format") or "url")
        adapted["negativePrompt"] = str(payload.get("negativePrompt") or payload.get("negative_prompt") or "").strip() or None
        adapted["width"] = int(payload.get("width") or 1024)
        adapted["height"] = int(payload.get("height") or 1024)
        adapted["numInferenceSteps"] = int(payload.get("numInferenceSteps") or payload.get("num_inference_steps") or 18)
        adapted["guidanceScale"] = float(payload.get("guidanceScale") or payload.get("guidance_scale") or 6.0)
        adapted["referenceImages"] = reference_images
        adapted["sceneImage"] = selected_image or (reference_images[0] if reference_images else None)
        adapted["selectedImage"] = selected_image
        routing_policy = _apply_replicate_routing_defaults(
            payload=payload,
            adapted=adapted,
            use_case="drilldown",
            num_input_images=len(reference_images),
            has_scene_image=bool(adapted.get("sceneImage")),
            is_edit=True,
        )

        pred = _generate_with_optional_optimized_request(adapted)
        images = normalize_output_urls(pred.get("output") if isinstance(pred, dict) else None)
        return {
            "ok": bool(isinstance(pred, dict) and pred.get("ok") and str(pred.get("status") or "").lower() == "succeeded"),
            "success": bool(isinstance(pred, dict) and pred.get("ok") and str(pred.get("status") or "").lower() == "succeeded"),
            "images": images,
            "predictionId": (pred.get("predictionId") or pred.get("id")) if isinstance(pred, dict) else None,
            "status": str(pred.get("status") or "") if isinstance(pred, dict) else "",
            "provider": _provider_from_prediction(pred),
            "modelId": adapted["modelId"],
            "instanceId": instance_id,
            "useCase": "drilldown",
            "routingPolicy": routing_policy,
        }
