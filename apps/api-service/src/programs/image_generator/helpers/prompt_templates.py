"""Active shared prompt templates and negative-prompt helpers for image generation."""

from __future__ import annotations

import re
from typing import Dict

from programs.common.visual_text_safety import (
    ANTI_COMPARISON_NEGATIVE_TERMS,
    ANTI_TEXT_OVERLAY_NEGATIVE_TERMS,
)

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


def build_option_image_prompt(
    label: str,
    context_hint: str = "",
    *,
    step_id: str = "",
    question: str = "",
) -> str:
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
    "OPTION_IMAGE_SCENE_TEMPLATE",
    "OPTION_IMAGE_TEMPLATE",
    "build_option_image_prompt",
    "get_negative_prompt",
]
