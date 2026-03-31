"""Compatibility wrappers around the simplified image model catalog."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Dict, Optional, Tuple

from programs.image_generator.model_catalog import resolve_model_entry


@dataclass
class ModelRecommendation:
    model_id: str
    guidance_scale: float
    num_inference_steps: int
    max_reference_images: int
    aspect_ratio: str = ""
    output_format: str = "png"
    prompt_upsampling: Optional[bool] = None
    safety_tolerance: int = 2

    def to_dict(self) -> Dict[str, Any]:
        d: Dict[str, Any] = {
            "modelId": self.model_id,
            "guidanceScale": self.guidance_scale,
            "numInferenceSteps": self.num_inference_steps,
            "maxReferenceImages": self.max_reference_images,
            "outputFormat": self.output_format,
            "safetyTolerance": self.safety_tolerance,
        }
        if self.aspect_ratio:
            d["aspectRatio"] = self.aspect_ratio
        if self.prompt_upsampling is not None:
            d["promptUpsampling"] = self.prompt_upsampling
        return d


@dataclass
class RoutingPolicy:
    provider: str = "replicate"
    priorities: Tuple[str, ...] = ("highest_quality", "lowest_latency", "lowest_cost")
    traits: Tuple[str, ...] = ("high_prompt_adherence",)
    required_tags: Tuple[str, ...] = ()
    notes: str = ""
    prompt_strength: Optional[float] = None
    image_prompt_strength: Optional[float] = None
    go_fast: Optional[bool] = None

    def to_dict(self) -> Dict[str, Any]:
        out: Dict[str, Any] = {
            "provider": self.provider,
            "priorities": list(self.priorities),
            "traits": list(self.traits),
            "requiredTags": list(self.required_tags),
            "notes": self.notes,
        }
        if self.prompt_strength is not None:
            out["promptStrength"] = float(self.prompt_strength)
        if self.image_prompt_strength is not None:
            out["imagePromptStrength"] = float(self.image_prompt_strength)
        if self.go_fast is not None:
            out["goFast"] = bool(self.go_fast)
        return out


def _normalize_use_case(raw: str) -> str:
    return str(raw or "").strip().lower().replace("_", "-")


def select_routing_policy(
    *,
    use_case: str = "scene",
    is_edit: bool = False,
) -> RoutingPolicy:
    """
    Compatibility policy object derived from the simplified model table.
    """
    uc = _normalize_use_case(use_case)

    if uc == "drilldown":
        return RoutingPolicy(
            provider="replicate",
            priorities=("highest_quality", "lowest_latency", "lowest_cost"),
            traits=("high_prompt_adherence", "inpainting", "edit_preservation"),
            notes="Preserve the reference strongly and apply focused inpaint-style edits from prompt deltas.",
            prompt_strength=0.82,
            image_prompt_strength=0.9,
            go_fast=True,
        )

    if uc in ("tryon", "try-on"):
        return RoutingPolicy(
            provider="replicate",
            priorities=("highest_quality", "highest_reliability", "lowest_latency"),
            traits=("high_prompt_adherence", "human_shape_preservation", "identity_preservation"),
            required_tags=("faces", "portraits"),
            notes="Try-on should preserve the person's body shape/pose and identity while changing outfit styling.",
            prompt_strength=0.72,
            image_prompt_strength=0.88,
            go_fast=False,
        )

    if uc == "scene-placement":
        return RoutingPolicy(
            provider="replicate",
            priorities=("highest_quality", "lowest_latency", "lowest_cost"),
            traits=("high_prompt_adherence", "inpainting", "composition_preservation"),
            notes="Placement is inpainting-dominant: preserve scene context while integrating the subject naturally.",
            prompt_strength=0.84,
            image_prompt_strength=0.9,
            go_fast=False,
        )

    if uc == "scene-refinement":
        return RoutingPolicy(
            provider="replicate",
            priorities=("highest_quality", "highest_reliability", "lowest_latency"),
            traits=("high_prompt_adherence", "inpainting", "edit_preservation", "composition_preservation"),
            notes="Refinement is a preserve-and-edit path: keep the anchor scene intact and apply focused local changes.",
            prompt_strength=0.86,
            image_prompt_strength=0.92,
            go_fast=False,
        )

    entry = resolve_model_entry(
        use_case=uc,
        has_reference_images=is_edit,
        has_scene_image=is_edit,
    )
    traits = entry.traits
    if uc == "scene":
        traits = ("high_prompt_adherence", "landscape_preservation" if is_edit else "landscape_generation")
    return RoutingPolicy(
        provider="replicate",
        priorities=entry.priorities,
        traits=traits,
        required_tags=entry.required_tags,
        notes=entry.notes or (
            "Preserve scene structure/materials from the uploaded image."
            if is_edit
            else "Prioritize photorealistic landscape/scene coherence."
        ),
        prompt_strength=entry.prompt_strength,
        image_prompt_strength=entry.image_prompt_strength,
        go_fast=entry.go_fast,
    )


def select_model(
    *,
    use_case: str = "scene",
    num_input_images: int = 0,
    has_scene_image: bool = False,
    has_product_image: bool = False,
    has_user_image: bool = False,
    is_thumbnail: bool = False,
) -> ModelRecommendation:
    """Resolve the active image model from the simplified model table."""
    entry = resolve_model_entry(
        use_case=_normalize_use_case(use_case),
        has_reference_images=max(0, int(num_input_images or 0)) > 0,
        has_scene_image=bool(has_scene_image),
        has_product_image=bool(has_product_image),
        has_user_image=bool(has_user_image),
        is_thumbnail=bool(is_thumbnail),
    )
    return ModelRecommendation(
        model_id=entry.model_id,
        guidance_scale=entry.guidance_scale,
        num_inference_steps=entry.num_inference_steps,
        max_reference_images=entry.max_reference_images,
        aspect_ratio=entry.aspect_ratio,
        output_format=entry.output_format,
        prompt_upsampling=entry.prompt_upsampling,
        safety_tolerance=entry.safety_tolerance,
    )


__all__ = ["ModelRecommendation", "RoutingPolicy", "select_model", "select_routing_policy"]
