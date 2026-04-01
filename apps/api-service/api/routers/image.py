from __future__ import annotations

import json
import os
import re
import time
from typing import Any, Dict, Optional

from fastapi import APIRouter, Body
from fastapi.responses import JSONResponse
from starlette.status import HTTP_400_BAD_REQUEST

from api.request_adapter import to_next_steps_payload
from api.utils import dedup_urls, normalize_output_urls
from programs.common.visual_text_safety import sanitize_visual_context_text
from programs.image_generator.orchestrator import generate_image
from programs.image_generator.request_normalizer import resolve_image_request


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

    _ROUTER_REQUEST_FIELDS = (
        "generationIntent",
        "generationIndex",
        "guidanceScale",
        "height",
        "imagePromptStrength",
        "modelId",
        "negativePrompt",
        "numInferenceSteps",
        "numOutputs",
        "originalReferenceImage",
        "outputFormat",
        "previousPrompt",
        "productImage",
        "promptStrength",
        "promptUpsampling",
        "referenceImages",
        "refinementNotes",
        "safetyTolerance",
        "sceneImage",
        "selectedImage",
        "userImage",
        "useCase",
        "variationMode",
        "width",
    )

    def _provider_from_prediction(pred: Any) -> str:
        if isinstance(pred, dict):
            provider = str(pred.get("provider") or "").strip().lower()
            if provider:
                return provider
        return "replicate"

    def _extract_instance_id(payload: Dict[str, Any]) -> str:
        if isinstance(payload.get("instanceId"), str):
            return str(payload.get("instanceId") or "").strip()
        if isinstance(payload.get("session"), dict):
            return str((payload.get("session") or {}).get("instanceId") or "").strip()
        return ""

    def _reject_client_prompt_fields(payload: Dict[str, Any]) -> Optional[JSONResponse]:
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
        return None

    def _copy_router_fields(adapted: Dict[str, Any], payload: Dict[str, Any]) -> None:
        for key in _ROUTER_REQUEST_FIELDS:
            alias = f"{key[0].lower()}{key[1:]}" if key and key[0].isupper() else key
            snake = re.sub(r"([a-z0-9])([A-Z])", r"\1_\2", key).lower()
            if key in payload and payload.get(key) is not None:
                adapted[key] = payload.get(key)
            elif alias in payload and payload.get(alias) is not None:
                adapted[key] = payload.get(alias)
            elif snake in payload and payload.get(snake) is not None:
                adapted[key] = payload.get(snake)

    def _resolve_widget_request(
        *,
        instance_id: str,
        payload: Dict[str, Any],
        route_name: str = "image",
        use_case: Optional[str] = None,
        prompt_to_step_input: bool = False,
        overrides: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        _image_route_log(
            "incoming",
            {
                "route": route_name,
                "summary": _image_payload_summary(payload),
                "rawKeys": sorted(list(payload.keys()))[:40],
            },
            force=True,
        )
        adapted = to_next_steps_payload(instance_id=instance_id, body=payload)
        _copy_router_fields(adapted, payload)
        if prompt_to_step_input:
            prompt = str(payload.get("prompt") or "").strip()
            if prompt:
                step_data = adapted.get("stepDataSoFar") if isinstance(adapted.get("stepDataSoFar"), dict) else {}
                adapted["stepDataSoFar"] = {**step_data, "step-promptInput": prompt}
        adapted.pop("prompt", None)
        adapted.pop("promptTemplate", None)
        if use_case:
            adapted["useCase"] = use_case
        for key, value in (overrides or {}).items():
            if value is not None:
                adapted[key] = value
        _image_route_log(
            "adapted",
            {
                "route": route_name,
                "summary": _image_payload_summary(adapted),
                "appliedUseCase": use_case,
                "overrideKeys": sorted(list((overrides or {}).keys())),
            },
            force=True,
        )
        resolved = resolve_image_request(adapted)
        _image_route_log(
            "resolved",
            {
                "route": route_name,
                "summary": _image_payload_summary(resolved),
            },
            force=True,
        )
        return resolved

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

    def _image_route_debug_enabled() -> bool:
        return str(os.getenv("IMAGE_ROUTE_DEBUG_LOG") or "").strip().lower() in {"1", "true", "yes", "on"}

    def _image_route_log(label: str, data: Dict[str, Any], *, force: bool = False) -> None:
        if not force and not _image_route_debug_enabled():
            return
        try:
            text = json.dumps(data, ensure_ascii=False, sort_keys=True)
            if len(text) > 6000:
                text = text[:6000] + "…"
            print(f"[image_route] {label} {text}", flush=True)
        except Exception:
            print(f"[image_route] {label} (unable to serialize)", flush=True)

    def _image_payload_summary(payload: Dict[str, Any]) -> Dict[str, Any]:
        step_data = payload.get("stepDataSoFar") if isinstance(payload.get("stepDataSoFar"), dict) else {}
        answered = payload.get("answeredQA") if isinstance(payload.get("answeredQA"), list) else []
        refs = payload.get("referenceImages") if isinstance(payload.get("referenceImages"), list) else []
        routing = payload.get("routingPolicy") if isinstance(payload.get("routingPolicy"), dict) else {}
        session = payload.get("session") if isinstance(payload.get("session"), dict) else {}
        return {
            "instanceId": str(payload.get("instanceId") or session.get("instanceId") or "")[:80] or None,
            "sessionId": str(payload.get("sessionId") or session.get("sessionId") or "")[:80] or None,
            "useCase": str(payload.get("useCase") or "")[:40] or None,
            "modelId": str(payload.get("modelId") or "")[:120] or None,
            "generationIntent": str(payload.get("generationIntent") or "")[:40] or None,
            "variationMode": str(payload.get("variationMode") or "")[:40] or None,
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

    # Canonical image generation routes. These are the primary endpoints for the
    # active image-generation runtime and should stay aligned with the orchestrator.
    @router.post("/image")
    def image(payload: Dict[str, Any] = Body(default_factory=dict)) -> Any:
        instance_id = _extract_instance_id(payload)
        if not instance_id:
            return {"ok": False, "error": "instanceId is required"}

        rejected = _reject_client_prompt_fields(payload)
        if rejected:
            return rejected

        resolved = _resolve_widget_request(instance_id=instance_id, payload=payload, route_name="image")
        return generate_image(resolved)

    @router.post("/image/prompt")
    def image_prompt(payload: Dict[str, Any] = Body(default_factory=dict)) -> Any:
        return JSONResponse(
            status_code=410,
            content={
                "ok": False,
                "error": "deprecated",
                "message": "Prompt generation now happens inside /generate requests. Do not call /image/prompt.",
            },
        )

    # Compatibility routes below preserve older payload shapes while delegating
    # into the same generation path where possible.
    @compat_router.post("/image")
    def image_compat(payload: Dict[str, Any] = Body(default_factory=dict)) -> Any:
        instance_id = _extract_instance_id(payload)
        if not instance_id:
            return {"ok": False, "error": "instanceId is required"}

        rejected = _reject_client_prompt_fields(payload)
        if rejected:
            return rejected

        resolved = _resolve_widget_request(instance_id=instance_id, payload=payload, route_name="image_compat")
        return _generate_with_optional_optimized_request(resolved)

    # Maps price_tier badges to concrete material/quality descriptors used in image prompts.
    _PRICE_TIER_DESCS: Dict[str, str] = {
        "$": "Budget-friendly, builder-grade materials, economy finishes, standard fixtures.",
        "$$": "Mid-range quality, quartz or laminate surfaces, semi-custom details.",
        "$$$": "Premium materials, natural stone, custom cabinetry, high-end fixtures.",
        "$$$$": "Luxury, bespoke finishes, marble, custom millwork, designer fixtures.",
    }

    @compat_router.post("/subcategory-catalog/generate")
    @router.post("/subcategory-catalog/generate")
    async def subcategory_catalog_generate(payload: Dict[str, Any] = Body(default_factory=dict)) -> Any:
        from programs.form_pipeline.orchestrator import _should_skip_option_image_for_label  # noqa: E402
        from programs.image_generator.providers.image_generation import generate_option_images_for_step  # noqa: E402
        from programs.subcategory_catalog.orchestrator import generate_subcategory_catalog  # noqa: E402

        planned = generate_subcategory_catalog(payload)
        if not planned.get("ok"):
            error = str(planned.get("error") or "").strip().lower()
            status = HTTP_400_BAD_REQUEST if error == "missing_service_context" else 500
            return JSONResponse(status_code=status, content=planned)

        question = sanitize_visual_context_text(planned.get("question") or "", max_len=240) or "Choose a starting visual direction."
        concepts = planned.get("concepts") if isinstance(planned.get("concepts"), list) else []
        service_str = sanitize_visual_context_text(
            payload.get("serviceSummary")
            or payload.get("service_summary")
            or payload.get("service")
            or payload.get("subcategoryName")
            or payload.get("subcategory_name")
            or payload.get("industry")
            or payload.get("categoryName")
            or "Service",
            max_len=320,
        ) or "Service"
        context_prompt = f"{service_str}: {question}"

        try:
            max_opts = int(os.getenv("AI_FORM_SUBCATEGORY_CATALOG_MAX_OPTIONS") or "40")
        except Exception:
            max_opts = 40
        max_opts = max(1, min(40, int(max_opts or 40)))

        model_id = str(payload.get("modelId") or payload.get("model_id") or os.getenv("REPLICATE_OPTION_IMAGES_MODEL_ID") or "").strip() or "black-forest-labs/flux-schnell"
        subcategory_id = str(payload.get("subcategoryId") or payload.get("subcategory_id") or "").strip()
        seed_label = subcategory_id or str(payload.get("service") or payload.get("subcategoryName") or service_str).strip()
        seed_label = re.sub(r"[^a-z0-9]+", "-", seed_label.lower()).strip("-") or "subcategory"
        seed_base = f"subcategory-catalog:{seed_label}|{model_id}"

        prompts: list[str] = []
        indices: list[int] = []
        normalized: list[dict[str, Any]] = []

        for concept in concepts:
            if not isinstance(concept, dict):
                continue
            label = sanitize_visual_context_text(concept.get("label") or concept.get("value") or "", max_len=120)
            value = str(concept.get("value") or "").strip() or re.sub(r"[^a-z0-9]+", "_", label.lower()).strip("_") or label
            image_prompt = sanitize_visual_context_text(concept.get("image_prompt") or concept.get("imagePrompt") or label, max_len=320)
            description = sanitize_visual_context_text(concept.get("description") or concept.get("descriptor") or "", max_len=200)
            price_tier = str(concept.get("price_tier") or concept.get("priceTier") or "").strip()
            if not label or not image_prompt:
                continue

            item: Dict[str, Any] = {
                "image_prompt": image_prompt,
                "label": label,
                "value": value,
            }
            if description:
                item["description"] = description
            if price_tier in _PRICE_TIER_DESCS:
                item["price_tier"] = price_tier
            normalized.append(item)

            if _should_skip_option_image_for_label(label) or len(indices) >= max_opts:
                continue

            prompt_text = image_prompt
            if description and description.lower() not in image_prompt.lower():
                prompt_text = f"{prompt_text}, {description}"
            tier_suffix = f" {_PRICE_TIER_DESCS[price_tier]}" if price_tier in _PRICE_TIER_DESCS else ""
            prompts.append(
                f"Photorealistic photo of one finished scene, not a split-screen or before-and-after layout. "
                f"No text, no words, no letters, no labels, no captions, no watermarks, no signs. "
                f"{context_prompt}. Option: {prompt_text}.{tier_suffix}"
            )
            indices.append(len(normalized) - 1)

        stats: Dict[str, int] = {}
        if prompts:
            urls, stats = generate_option_images_for_step(prompts, model_id=model_id, seed_base=seed_base)
            for j, idx in enumerate(indices):
                if j < len(urls) and urls[j]:
                    normalized[idx]["imageUrl"] = urls[j]

        return {
            "concepts": concepts,
            "imageStats": stats,
            "modelId": model_id,
            "ok": True,
            "options": normalized,
            "plannerLmUsage": planned.get("lmUsage"),
            "plannerSource": planned.get("source"),
            "question": question,
            "requestId": planned.get("requestId"),
            "targetCount": planned.get("targetCount"),
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
        from programs.image_generator.helpers.prompt_templates import build_option_image_prompt  # noqa: E402
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
            prompts.append(
                build_option_image_prompt(
                    f"{prompt_text}.{tier_suffix}".strip(),
                    context_prompt,
                    step_id=step_id,
                    question=question,
                )
            )
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

    @compat_router.post("/refinement-library-planner/plan")
    @router.post("/refinement-library-planner/plan")
    async def refinement_library_plan(payload: Dict[str, Any] = Body(default_factory=dict)) -> Any:
        from programs.refinement_library_planner.orchestrator import plan_refinement_library  # noqa: E402

        planned = plan_refinement_library(payload)
        if not planned.get("ok"):
            error = str(planned.get("error") or "").strip().lower()
            status = HTTP_400_BAD_REQUEST if error == "missing_service_context" else 500
            return JSONResponse(status_code=status, content=planned)
        return planned

    @compat_router.post("/subcategory-scope/suggest")
    @router.post("/subcategory-scope/suggest")
    async def subcategory_scope_suggest(payload: Dict[str, Any] = Body(default_factory=dict)) -> Any:
        from programs.subcategory_scope_suggester.orchestrator import suggest_subcategory_scope  # noqa: E402

        suggested = suggest_subcategory_scope(payload)
        if not suggested.get("ok"):
            error = str(suggested.get("error") or "").strip().lower()
            status = HTTP_400_BAD_REQUEST if error == "missing_service_context" else 500
            return JSONResponse(status_code=status, content=suggested)
        return suggested

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
        instance_id = str(payload.get("instanceId") or payload.get("instance_id") or "").strip()
        if not instance_id:
            return JSONResponse(status_code=HTTP_400_BAD_REQUEST, content={"ok": False, "error": "instanceId_required"})

        user_image = str(payload.get("userImage") or payload.get("user_image") or "").strip() or None
        product_image = str(payload.get("productImage") or payload.get("product_image") or "").strip() or None
        refs_in = payload.get("referenceImages") or payload.get("reference_images") or []
        refs = [x for x in (refs_in if isinstance(refs_in, list) else []) if isinstance(x, str) and x.strip()]
        reference_images = dedup_urls([u for u in [user_image, product_image, *refs] if u])
        if not reference_images:
            return JSONResponse(status_code=HTTP_400_BAD_REQUEST, content={"ok": False, "error": "referenceImages_required"})

        adapted = _resolve_widget_request(
            instance_id=instance_id,
            payload=payload,
            route_name="generate_try_on",
            use_case="tryon",
            prompt_to_step_input=True,
            overrides={
                "numOutputs": int(payload.get("numOutputs") or payload.get("gallery_max_images") or 4),
                "width": int(payload.get("width") or 1024),
                "height": int(payload.get("height") or 1024),
                "referenceImages": reference_images,
                "userImage": user_image,
                "productImage": product_image,
            },
        )
        routing_policy = adapted.get("routingPolicy")

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
        instance_id = str(payload.get("instanceId") or payload.get("instance_id") or "").strip()
        scene_image = str(payload.get("sceneImage") or payload.get("scene_image") or "").strip()
        product_image = str(payload.get("productImage") or payload.get("product_image") or "").strip()
        if not instance_id:
            return JSONResponse(status_code=HTTP_400_BAD_REQUEST, content={"ok": False, "error": "instanceId_required"})
        if not scene_image:
            return JSONResponse(status_code=HTTP_400_BAD_REQUEST, content={"ok": False, "error": "sceneImage_required"})

        refs_in = payload.get("referenceImages") or payload.get("reference_images") or []
        refs = [x for x in (refs_in if isinstance(refs_in, list) else []) if isinstance(x, str) and x.strip()]
        seed_refs = [scene_image, *([product_image] if product_image else []), *refs]
        reference_images = dedup_urls(seed_refs)
        adapted = _resolve_widget_request(
            instance_id=instance_id,
            payload=payload,
            route_name="generate_scene_placement",
            use_case="scene-placement",
            prompt_to_step_input=True,
            overrides={
                "numOutputs": int(payload.get("numOutputs") or payload.get("gallery_max_images") or 4),
                "width": int(payload.get("width") or 1024),
                "height": int(payload.get("height") or 1024),
                "referenceImages": reference_images,
                "sceneImage": scene_image,
                "productImage": product_image or None,
            },
        )
        routing_policy = adapted.get("routingPolicy")

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

    @compat_router.post("/generate/scene-refinement")
    @router.post("/generate/scene-refinement")
    async def generate_scene_refinement(payload: Dict[str, Any] = Body(default_factory=dict)) -> Any:
        instance_id = str(payload.get("instanceId") or payload.get("instance_id") or "").strip()
        scene_image = str(payload.get("sceneImage") or payload.get("scene_image") or "").strip()
        if not instance_id:
            return JSONResponse(status_code=HTTP_400_BAD_REQUEST, content={"ok": False, "error": "instanceId_required"})
        if not scene_image:
            return JSONResponse(status_code=HTTP_400_BAD_REQUEST, content={"ok": False, "error": "sceneImage_required"})

        refs_in = payload.get("referenceImages") or payload.get("reference_images") or []
        refs = [x for x in (refs_in if isinstance(refs_in, list) else []) if isinstance(x, str) and x.strip()]
        reference_images = dedup_urls([scene_image, *refs])
        adapted = _resolve_widget_request(
            instance_id=instance_id,
            payload=payload,
            route_name="generate_scene_refinement",
            use_case="scene-refinement",
            prompt_to_step_input=True,
            overrides={
                "numOutputs": int(payload.get("numOutputs") or payload.get("gallery_max_images") or 1),
                "width": int(payload.get("width") or 1024),
                "height": int(payload.get("height") or 1024),
                "referenceImages": reference_images,
                "sceneImage": scene_image,
            },
        )
        routing_policy = adapted.get("routingPolicy")

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
            "useCase": "scene-refinement",
            "routingPolicy": routing_policy,
        }

    @compat_router.post("/generate/scene")
    @router.post("/generate/scene")
    async def generate_scene(payload: Dict[str, Any] = Body(default_factory=dict)) -> Any:
        instance_id = str(payload.get("instanceId") or payload.get("instance_id") or "").strip()
        if not instance_id:
            return JSONResponse(status_code=HTTP_400_BAD_REQUEST, content={"ok": False, "error": "instanceId_required"})

        refs_in = payload.get("referenceImages") or payload.get("reference_images") or []
        refs = [x for x in (refs_in if isinstance(refs_in, list) else []) if isinstance(x, str) and x.strip()]
        ref_mode = str(payload.get("referenceMode") or payload.get("reference_mode") or "").strip().lower()
        user_img = str(payload.get("userImage") or payload.get("user_image") or "").strip() or None
        scene_img = str(payload.get("sceneImage") or payload.get("scene_image") or "").strip() or None
        product_img = str(payload.get("productImage") or payload.get("product_image") or "").strip() or None
        explicit_anchor = user_img or scene_img or product_img

        if explicit_anchor:
            # Keep the client's anchor + any extra reference URLs (e.g. style cards) for DSPy routing.
            primary_image = explicit_anchor
            rest = [u for u in refs if u and u != primary_image]
            reference_images_out = dedup_urls([primary_image, *rest])
            is_edit = True
        elif ref_mode == "guide_only":
            # Style-reference URLs only: do not promote the first URL to sceneImage.
            primary_image = None
            reference_images_out = dedup_urls(refs)
            is_edit = False
        else:
            ordered_candidates = [user_img, scene_img, product_img, *refs]
            ordered = [x for x in ordered_candidates if isinstance(x, str) and x]
            deduped = dedup_urls(ordered)
            is_edit = len(deduped) > 0
            primary_image = deduped[0] if is_edit else None
            reference_images_out = [primary_image] if primary_image else []

        scene_overrides: Dict[str, Any] = {
            "numOutputs": int(payload.get("numOutputs") or payload.get("gallery_max_images") or 4),
            "width": int(payload.get("width") or 1024),
            "height": int(payload.get("height") or 1024),
            "referenceImages": reference_images_out,
        }
        # When the client already sent an explicit anchor (room/product/person), keep those fields; only
        # normalize referenceImages. Legacy paths without explicit anchors still promote the primary URL.
        if not explicit_anchor:
            scene_overrides["sceneImage"] = primary_image or None

        adapted = _resolve_widget_request(
            instance_id=instance_id,
            payload=payload,
            route_name="generate_scene",
            use_case="scene",
            prompt_to_step_input=True,
            overrides=scene_overrides,
        )
        routing_policy = adapted.get("routingPolicy")

        pred = _generate_with_optional_optimized_request(adapted)
        if (
            isinstance(pred, dict)
            and str(adapted.get("variationMode") or adapted.get("variation_mode") or "").strip().lower() == "price_ladder_9"
        ):
            return pred
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
        instance_id = str(payload.get("instanceId") or payload.get("instance_id") or "").strip()
        if not instance_id:
            return JSONResponse(status_code=HTTP_400_BAD_REQUEST, content={"ok": False, "error": "instanceId_required"})

        selected_image = str(payload.get("selectedImage") or payload.get("selected_image") or "").strip() or None
        refs_in = payload.get("referenceImages") or payload.get("reference_images") or []
        refs = [x for x in (refs_in if isinstance(refs_in, list) else []) if isinstance(x, str) and x.strip()]
        reference_images = dedup_urls([u for u in [selected_image, *refs] if u])
        if not reference_images:
            return JSONResponse(status_code=HTTP_400_BAD_REQUEST, content={"ok": False, "error": "referenceImages_required"})

        adapted = _resolve_widget_request(
            instance_id=instance_id,
            payload=payload,
            route_name="generate_drilldown",
            use_case="drilldown",
            prompt_to_step_input=True,
            overrides={
                "numOutputs": 1,
                "width": int(payload.get("width") or 1024),
                "height": int(payload.get("height") or 1024),
                "referenceImages": reference_images,
                "sceneImage": selected_image or (reference_images[0] if reference_images else None),
                "selectedImage": selected_image,
            },
        )
        routing_policy = adapted.get("routingPolicy")

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
