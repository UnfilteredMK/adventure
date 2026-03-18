from __future__ import annotations

from programs.common.visual_text_safety import sanitize_visual_context_text
from programs.image_generator.image_prompt_library import build_option_image_prompt, get_negative_prompt
from programs.image_generator.prompt_builder import build_image_prompt_text
from programs.subcategory_catalog.orchestrator import _resolve_strings


def test_sanitize_visual_context_text_removes_before_after_phrase() -> None:
    text = "AI visualization for Before/After House Flips services."
    assert sanitize_visual_context_text(text) == "AI visualization for House Flips services."


def test_scene_prompt_builder_avoids_comparison_language() -> None:
    payload = {
        "useCase": "scene",
        "instanceContext": {
            "service": {"name": "Before/After House Flips"},
            "serviceSummary": "AI visualization for Before/After House Flips services.",
        },
    }

    spec = build_image_prompt_text(payload)
    prompt = str(spec.get("prompt") or "").lower()
    negative_prompt = str(spec.get("negativePrompt") or "").lower()

    assert "before/after" not in prompt
    assert "before and after" not in prompt
    assert "single finished scene" in prompt
    assert "split screen" in negative_prompt


def test_negative_prompt_library_blocks_comparison_layouts() -> None:
    negative = get_negative_prompt("black-forest-labs/flux-1.1-pro").lower()
    assert "split screen" in negative
    assert "before-and-after graphic" in negative


def test_option_image_prompt_uses_scene_template_for_style_direction_step() -> None:
    prompt = build_option_image_prompt(
        "nature-inspired and earthy",
        "Garden Design - What color scheme do you envision for your garden?",
        step_id="step-style-direction",
        question="What style direction fits best?",
    ).lower()

    assert "completed scene preview" in prompt
    assert "finished service outcome" in prompt
    assert "product/material photograph" not in prompt


def test_option_image_prompt_uses_detail_template_for_material_step() -> None:
    prompt = build_option_image_prompt(
        "brushed brass",
        "Kitchen remodel - What finish do you prefer?",
        step_id="step-finish-style",
        question="What finish style do you prefer?",
    ).lower()

    assert "product/material photograph" in prompt
    assert "completed scene preview" not in prompt


def test_subcategory_context_resolution_sanitizes_comparison_terms() -> None:
    service_summary, industry, service, subcategory_name = _resolve_strings(
        {
            "industry": "Real Estate",
            "service": "Before/After House Flips",
            "serviceSummary": "AI visualization for Before/After House Flips services.",
            "subcategoryName": "Before/After House Flips",
        }
    )

    assert service_summary == "AI visualization for House Flips services."
    assert industry == "Real Estate"
    assert service == "House Flips"
    assert subcategory_name == "House Flips"
