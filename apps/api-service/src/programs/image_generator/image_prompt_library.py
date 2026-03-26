"""
System prompts, negative prompt templates, and quality constraints for image generation.

DSPy can optimize these via BootstrapFewShot or MIPROv2. The deterministic builder
also references these templates directly.
"""

from __future__ import annotations

import re
from typing import Dict

from programs.common.visual_text_safety import ANTI_COMPARISON_NEGATIVE_TERMS, ANTI_TEXT_OVERLAY_NEGATIVE_TERMS

# ---------------------------------------------------------------------------
# Negative prompt templates per model family
# ---------------------------------------------------------------------------

NEGATIVE_PROMPTS: Dict[str, str] = {
    "default": (
        f"{ANTI_TEXT_OVERLAY_NEGATIVE_TERMS}, "
        "blurry, cartoon, anime, painting, illustration, low quality, deformed, "
        f"artifacts, noise, pixelated, oversaturated, {ANTI_COMPARISON_NEGATIVE_TERMS}"
    ),
    "flux-schnell": (
        f"{ANTI_TEXT_OVERLAY_NEGATIVE_TERMS}, stamp, "
        "blurry, low quality, deformed, distorted, disfigured, "
        "cartoon, anime, painting, illustration, sketch, "
        "oversaturated, artifacts, noise, pixelated, "
        f"extra limbs, extra fingers, mutated hands, {ANTI_COMPARISON_NEGATIVE_TERMS}"
    ),
    "flux-kontext": (
        f"{ANTI_TEXT_OVERLAY_NEGATIVE_TERMS}, blurry, "
        "cartoon, anime, illustration, low quality, deformed, "
        f"dramatic layout changes, added windows, removed walls, {ANTI_COMPARISON_NEGATIVE_TERMS}"
    ),
    "flux-pro": (
        f"{ANTI_TEXT_OVERLAY_NEGATIVE_TERMS}, blurry, "
        "cartoon, anime, painting, illustration, low quality, deformed, "
        f"artifacts, noise, oversaturated, {ANTI_COMPARISON_NEGATIVE_TERMS}"
    ),
    "nano-banana": (
        f"{ANTI_TEXT_OVERLAY_NEGATIVE_TERMS}, blurry, "
        "cartoon, anime, low quality, deformed, artifacts, "
        f"mismatched lighting, floating objects, wrong perspective, {ANTI_COMPARISON_NEGATIVE_TERMS}"
    ),
}


def get_negative_prompt(model_id: str = "") -> str:
    mid = (model_id or "").lower()
    if "schnell" in mid:
        return NEGATIVE_PROMPTS["flux-schnell"]
    if "kontext" in mid:
        return NEGATIVE_PROMPTS["flux-kontext"]
    if "nano-banana" in mid or "nano_banana" in mid:
        return NEGATIVE_PROMPTS["nano-banana"]
    if "flux" in mid:
        return NEGATIVE_PROMPTS["flux-pro"]
    return NEGATIVE_PROMPTS["default"]


# ---------------------------------------------------------------------------
# Use-case system prompts (for DSPy module instructions)
# ---------------------------------------------------------------------------

SCENE_INITIAL_SYSTEM = """\
You are generating a text-to-image prompt for a home service design preview.
The user has NOT uploaded a photo -- generate a complete scene from scratch.
Focus on creating a photorealistic interior/exterior that matches the user's
style preferences, materials, colors, and budget level.
Be specific about materials (e.g. "brushed nickel faucets" not just "nice faucets").
Describe lighting naturally (e.g. "warm afternoon sunlight through sheer curtains").
Never mention budget numbers, prices, or text in the visual description."""

SCENE_EDIT_SYSTEM = """\
You are generating an image-editing prompt. The user uploaded a photo of their space.
Your prompt must tell the model what the completed standalone result should look like for that same space.
Use imperative language: "Replace the flooring with...", "Add subway tile backsplash...",
"Change the vanity to a rustic wood style...".
Hard anchor constraint: preserve camera angle, composition/framing, room geometry, perspective, windows, doors, overall layout.
Transform: finishes, fixtures, materials, colors, styling, decor.
Be specific about the desired end result, not the process.
Treat the upload as source context only. Output one finished scene, never the original condition plus the result in a comparison layout.
Never mention budget numbers, prices, or text in the visual description."""

SCENE_PLACEMENT_SYSTEM = """\
You are generating a scene-placement/compositing prompt.
The user provided a scene photo and a product photo.
Your prompt must describe how to naturally integrate the product into the scene.
Focus on matching: lighting direction, shadow angles, scale/perspective, color temperature.
The result should look like the product was photographed in that exact environment.
Hard anchor constraint: treat the scene image as immutable base (composition, camera, geometry, and lighting).
Treat this as inpainting/editing: preserve scene geometry and camera viewpoint; apply only local edits for placement.
Hard constraint: budget tier must control quality/material level. Do not upscale to luxury when budget is low."""

TRYON_SYSTEM = """\
You are generating a virtual try-on prompt.
The user provided a photo of themselves and a product image.
Your prompt must describe the product being worn/applied naturally on the person.
Preserve: the person's body shape, pose, skin tone, facial features.
Focus on: natural draping/fit, correct shadows, fabric behavior, color accuracy."""

SYSTEM_PROMPTS: Dict[str, str] = {
    "scene_initial": SCENE_INITIAL_SYSTEM,
    "scene_edit": SCENE_EDIT_SYSTEM,
    "scene-placement": SCENE_PLACEMENT_SYSTEM,
    "tryon": TRYON_SYSTEM,
}


def get_system_prompt(use_case: str, is_edit: bool = False) -> str:
    if use_case == "scene":
        return SYSTEM_PROMPTS["scene_edit"] if is_edit else SYSTEM_PROMPTS["scene_initial"]
    return SYSTEM_PROMPTS.get(use_case, SYSTEM_PROMPTS["scene_initial"])


# ---------------------------------------------------------------------------
# Option image prompt template (for schnell thumbnail generation)
# ---------------------------------------------------------------------------

OPTION_IMAGE_TEMPLATE = (
    "A photorealistic close-up product/material photograph of {label}. "
    "Clean white or neutral studio background. "
    "Sharp focus, even lighting, no shadows on background. "
    "Professional product photography style. "
    "No text, no numbers, no labels, no watermarks."
)

OPTION_IMAGE_SCENE_TEMPLATE = (
    "A photorealistic completed scene preview showing the '{label}' direction for {context}. "
    "Single real-world environment, natural lighting, realistic materials, editorial-quality photography. "
    "Show a believable finished service outcome, not a product cutout, icon, collage, diagram, or illustration. "
    "No text, no numbers, no labels, no watermarks."
)

_OPTION_SCENE_SIGNAL_RE = re.compile(
    r"\b(style|direction|color|palette|tone|look|vibe|mood|theme|layout|lighting|ambience|aesthetic)\b",
    re.IGNORECASE,
)
_OPTION_DETAIL_SIGNAL_RE = re.compile(
    r"\b(material|finish|texture|shape|pattern|fixture|hardware|tile|countertop|flooring|fabric|upholstery)\b",
    re.IGNORECASE,
)


def _option_prompt_mode(*, step_id: str = "", question: str = "") -> str:
    text = f"{step_id} {question}".strip()
    if not text:
        return "scene"
    if _OPTION_DETAIL_SIGNAL_RE.search(text):
        return "detail"
    if _OPTION_SCENE_SIGNAL_RE.search(text):
        return "scene"
    return "scene"


def build_option_image_prompt(label: str, context_hint: str = "", *, step_id: str = "", question: str = "") -> str:
    clean_label = label.strip()
    clean_context = " ".join(str(context_hint or "").split()).strip()
    if _option_prompt_mode(step_id=step_id, question=question) == "scene":
        scene_context = clean_context[:180] if clean_context else "this design brief"
        return OPTION_IMAGE_SCENE_TEMPLATE.format(label=clean_label, context=scene_context)

    base = OPTION_IMAGE_TEMPLATE.format(label=clean_label)
    if clean_context:
        base = f"{base}\nContext: {clean_context[:120]}."
    return base


__all__ = [
    "NEGATIVE_PROMPTS",
    "SYSTEM_PROMPTS",
    "get_negative_prompt",
    "get_system_prompt",
    "build_option_image_prompt",
    "OPTION_IMAGE_TEMPLATE",
]
