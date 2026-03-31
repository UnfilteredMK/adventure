from __future__ import annotations

from typing import Any, Dict, Iterable, List, Optional

from programs.image_generator.model_catalog import normalize_use_case
from programs.image_generator.model_selector import select_model, select_routing_policy
from programs.image_generator.request_context import has_explicit_anchor_image, is_guide_only_style_refs


_LIST_KEYS = {"referenceImages", "traits", "requiredTags", "routingPriorities"}
_STRING_KEYS = {
    "generationIntent",
    "instanceId",
    "modelId",
    "referenceMode",
    "negativePrompt",
    "originalReferenceImage",
    "outputFormat",
    "previousPrompt",
    "productImage",
    "prompt",
    "provider",
    "refinementNotes",
    "sceneImage",
    "selectedImage",
    "useCase",
    "userImage",
    "variationMode",
}


def _normalize_list(values: Any) -> List[str]:
    if not isinstance(values, list):
        return []
    out: List[str] = []
    seen: set[str] = set()
    for item in values:
        if not isinstance(item, str):
            continue
        value = item.strip()
        if not value or value in seen:
            continue
        out.append(value)
        seen.add(value)
    return out


def _coerce_str(value: Any) -> Optional[str]:
    if value is None:
        return None
    text = str(value).strip()
    return text or None


def _merge_alias(target: Dict[str, Any], payload: Dict[str, Any], canonical: str, aliases: Iterable[str]) -> None:
    for key in aliases:
        if key not in payload:
            continue
        value = payload.get(key)
        if canonical in _LIST_KEYS:
            normalized = _normalize_list(value)
            if normalized:
                target[canonical] = normalized
            continue
        if canonical in _STRING_KEYS:
            normalized = _coerce_str(value)
            if normalized is not None:
                target[canonical] = normalized
            continue
        if value is not None:
            target[canonical] = value


def _has_explicit_value(payload: Dict[str, Any], key: str) -> bool:
    if key not in payload:
        return False
    value = payload.get(key)
    if value is None:
        return False
    if isinstance(value, str):
        return bool(value.strip())
    if isinstance(value, (list, tuple, dict)):
        return len(value) > 0
    return True


def normalize_image_request(payload: Dict[str, Any]) -> Dict[str, Any]:
    source = payload if isinstance(payload, dict) else {}
    normalized: Dict[str, Any] = dict(source)

    session = source.get("session") if isinstance(source.get("session"), dict) else {}
    if not _has_explicit_value(normalized, "instanceId"):
        instance_from_session = _coerce_str(session.get("instanceId"))
        if instance_from_session:
            normalized["instanceId"] = instance_from_session

    _merge_alias(normalized, source, "useCase", ("useCase", "use_case"))
    normalized["useCase"] = normalize_use_case(str(normalized.get("useCase") or "scene"))

    _merge_alias(normalized, source, "modelId", ("modelId", "model_id"))
    _merge_alias(normalized, source, "outputFormat", ("outputFormat", "output_format"))
    _merge_alias(normalized, source, "negativePrompt", ("negativePrompt", "negative_prompt"))
    _merge_alias(normalized, source, "referenceImages", ("referenceImages", "reference_images"))
    _merge_alias(normalized, source, "sceneImage", ("sceneImage", "scene_image"))
    _merge_alias(normalized, source, "productImage", ("productImage", "product_image"))
    _merge_alias(normalized, source, "userImage", ("userImage", "user_image"))
    _merge_alias(normalized, source, "selectedImage", ("selectedImage", "selected_image"))
    _merge_alias(normalized, source, "generationIntent", ("generationIntent", "generation_intent"))
    _merge_alias(normalized, source, "previousPrompt", ("previousPrompt", "previous_prompt"))
    _merge_alias(normalized, source, "refinementNotes", ("refinementNotes", "refinement_notes"))
    _merge_alias(normalized, source, "variationMode", ("variationMode", "variation_mode"))
    _merge_alias(normalized, source, "referenceMode", ("referenceMode", "reference_mode"))
    _merge_alias(normalized, source, "originalReferenceImage", ("originalReferenceImage", "original_reference_image"))
    _merge_alias(normalized, source, "routingPriorities", ("routingPriorities", "routing_priorities"))
    _merge_alias(normalized, source, "requiredTags", ("requiredTags", "required_tags"))
    _merge_alias(normalized, source, "promptStrength", ("promptStrength", "prompt_strength", "strength"))
    _merge_alias(normalized, source, "imagePromptStrength", ("imagePromptStrength", "image_prompt_strength"))
    _merge_alias(normalized, source, "guidanceScale", ("guidanceScale", "guidance_scale"))
    _merge_alias(normalized, source, "numInferenceSteps", ("numInferenceSteps", "num_inference_steps"))
    _merge_alias(normalized, source, "safetyTolerance", ("safetyTolerance", "safety_tolerance"))
    _merge_alias(normalized, source, "promptUpsampling", ("promptUpsampling", "prompt_upsampling"))
    _merge_alias(normalized, source, "goFast", ("goFast", "go_fast"))

    if not isinstance(normalized.get("referenceImages"), list):
        normalized["referenceImages"] = _normalize_list(normalized.get("referenceImages"))
    if not isinstance(normalized.get("requiredTags"), list):
        normalized["requiredTags"] = _normalize_list(normalized.get("requiredTags"))
    if not isinstance(normalized.get("routingPriorities"), list):
        normalized["routingPriorities"] = _normalize_list(normalized.get("routingPriorities"))
    if not isinstance(normalized.get("traits"), list):
        normalized["traits"] = _normalize_list(normalized.get("traits"))

    return normalized


def resolve_image_request(payload: Dict[str, Any]) -> Dict[str, Any]:
    resolved = normalize_image_request(payload)

    reference_images = resolved.get("referenceImages") if isinstance(resolved.get("referenceImages"), list) else []
    has_scene_image = bool(_coerce_str(resolved.get("sceneImage")))
    has_product_image = bool(_coerce_str(resolved.get("productImage")))
    has_user_image = bool(_coerce_str(resolved.get("userImage")))
    has_selected_image = bool(_coerce_str(resolved.get("selectedImage")))
    if is_guide_only_style_refs(resolved) and not has_explicit_anchor_image(resolved):
        is_edit = False
        num_input_images_for_model = 0
    else:
        is_edit = bool(reference_images or has_scene_image or has_product_image or has_user_image or has_selected_image)
        num_input_images_for_model = len(reference_images)

    recommendation = select_model(
        use_case=str(resolved.get("useCase") or "scene"),
        num_input_images=num_input_images_for_model,
        has_scene_image=has_scene_image,
        has_product_image=has_product_image,
        has_user_image=has_user_image,
    )
    routing_policy = select_routing_policy(
        use_case=str(resolved.get("useCase") or "scene"),
        is_edit=is_edit,
    )

    if not _has_explicit_value(resolved, "modelId"):
        resolved["modelId"] = recommendation.model_id
    if not _has_explicit_value(resolved, "guidanceScale"):
        resolved["guidanceScale"] = recommendation.guidance_scale
    if not _has_explicit_value(resolved, "numInferenceSteps"):
        resolved["numInferenceSteps"] = recommendation.num_inference_steps
    if not _has_explicit_value(resolved, "outputFormat"):
        resolved["outputFormat"] = recommendation.output_format
    if recommendation.prompt_upsampling is not None and not _has_explicit_value(resolved, "promptUpsampling"):
        resolved["promptUpsampling"] = recommendation.prompt_upsampling
    if not _has_explicit_value(resolved, "safetyTolerance"):
        resolved["safetyTolerance"] = recommendation.safety_tolerance
    if routing_policy.prompt_strength is not None and not _has_explicit_value(resolved, "promptStrength"):
        resolved["promptStrength"] = routing_policy.prompt_strength
    if routing_policy.image_prompt_strength is not None and not _has_explicit_value(resolved, "imagePromptStrength"):
        resolved["imagePromptStrength"] = routing_policy.image_prompt_strength
    if routing_policy.go_fast is not None and not _has_explicit_value(resolved, "goFast"):
        resolved["goFast"] = routing_policy.go_fast
    if routing_policy.required_tags and not _has_explicit_value(resolved, "requiredTags"):
        resolved["requiredTags"] = list(routing_policy.required_tags)
    if not _has_explicit_value(resolved, "traits"):
        resolved["traits"] = list(routing_policy.traits)
    if not _has_explicit_value(resolved, "routingPriorities"):
        resolved["routingPriorities"] = list(routing_policy.priorities)

    resolved["provider"] = "replicate"
    resolved["routingPolicy"] = routing_policy.to_dict()
    try:
        print(
            "[image_generator] request_routing",
            {
                "useCase": str(resolved.get("useCase") or "scene"),
                "isEdit": is_edit,
                "hasSceneImage": has_scene_image,
                "hasProductImage": has_product_image,
                "hasUserImage": has_user_image,
                "referenceImagesCount": len(reference_images),
                "selectedModelId": recommendation.model_id,
                "provider": "replicate",
                "routingPolicy": routing_policy.to_dict(),
            },
            flush=True,
        )
    except Exception:
        pass
    return resolved


__all__ = ["normalize_image_request", "resolve_image_request"]
