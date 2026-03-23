"""
Intelligent model selection based on task requirements.

Instead of hardcoding model choices per API route, this module examines
the input signals (number of images, use case, transformation type) and
returns the optimal model + parameters.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Dict, Optional, Tuple


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


# ---- Model presets ----

FLUX_PRO = ModelRecommendation(
    model_id="black-forest-labs/flux-1.1-pro",
    guidance_scale=6.0,
    num_inference_steps=18,
    max_reference_images=0,
    aspect_ratio="1:1",
    output_format="png",
)

FLUX_KONTEXT = ModelRecommendation(
    model_id="black-forest-labs/flux-kontext-pro",
    guidance_scale=5.5,
    num_inference_steps=25,
    max_reference_images=1,
    aspect_ratio="match_input_image",
    output_format="png",
    prompt_upsampling=True,
)

NANO_BANANA = ModelRecommendation(
    model_id="google/nano-banana",
    guidance_scale=6.0,
    num_inference_steps=18,
    max_reference_images=4,
    output_format="jpg",
)

GROK_IMAGINE_IMAGE = ModelRecommendation(
    model_id="xai/grok-imagine-image",
    guidance_scale=6.0,
    num_inference_steps=18,
    max_reference_images=1,
    # Ignored for image-edit mode; retained for text-to-image fallback.
    aspect_ratio="1:1",
    output_format="jpg",
)

FLUX_SCHNELL = ModelRecommendation(
    model_id="black-forest-labs/flux-schnell",
    guidance_scale=3.5,
    num_inference_steps=4,
    max_reference_images=0,
    aspect_ratio="1:1",
    output_format="webp",
)


def _normalize_use_case(raw: str) -> str:
    return str(raw or "").strip().lower().replace("_", "-")


def select_routing_policy(
    *,
    use_case: str = "scene",
    is_edit: bool = False,
) -> RoutingPolicy:
    """
    Service-side route intent policy for image generation.

    The field names intentionally mirror Switchboard request concepts
    (provider/priorities/traits/requiredTags) so this policy can be reused when
    we route through Switchboard.
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

    # Default scene
    return RoutingPolicy(
        provider="replicate",
        priorities=("highest_quality", "highest_reliability", "lowest_cost"),
        traits=("high_prompt_adherence", "landscape_preservation" if is_edit else "landscape_generation"),
        required_tags=("landscapes",),
        notes=(
            "Preserve scene structure/materials from the uploaded image."
            if is_edit
            else "Prioritize photorealistic landscape/scene coherence."
        ),
        prompt_strength=0.66 if is_edit else None,
        image_prompt_strength=0.86 if is_edit else None,
        go_fast=False,
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
    """
    Select the best model and parameters for the given task.

    Priority logic:
    1. Thumbnails/option images -> Schnell (fast, cheap)
    2. Try-on (user + product) -> Nano Banana (multi-image)
    3. Scene-placement (scene + product) -> Nano Banana (multi-image)
    4. Drilldown -> Kontext Pro (reference-preserving edit)
    5. Scene with references -> Kontext Pro (preserve uploaded scene)
    6. Scene without references -> Flux 1.1 Pro (text-to-image)
    """
    if is_thumbnail:
        return FLUX_SCHNELL

    uc = _normalize_use_case(use_case)

    if uc in ("tryon", "try-on"):
        if has_user_image and has_product_image:
            return NANO_BANANA
        if num_input_images >= 2:
            return NANO_BANANA
        if num_input_images == 1:
            return FLUX_KONTEXT
        return FLUX_PRO

    if uc == "scene-placement":
        # Scene placement is an inpainting/edit-heavy path.
        # xai/grok-imagine-image supports native `image` editing and is preferred here.
        return GROK_IMAGINE_IMAGE

    if uc == "scene-refinement":
        return GROK_IMAGINE_IMAGE

    if uc == "drilldown":
        if num_input_images >= 1:
            return FLUX_KONTEXT
        return FLUX_PRO

    # Default "scene" use case
    if num_input_images >= 1:
        return FLUX_KONTEXT
    return FLUX_PRO


__all__ = ["ModelRecommendation", "RoutingPolicy", "select_model", "select_routing_policy"]
