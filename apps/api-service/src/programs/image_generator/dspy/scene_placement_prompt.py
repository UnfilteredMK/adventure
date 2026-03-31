"""DSPy module for reference-guided placement into an existing scene."""

from __future__ import annotations

import dspy


class ScenePlacementPromptSignature(dspy.Signature):
    """Generate a prompt for inpainting/compositing an object into an existing image.

    This use case is called "scene-placement" in our app, but the image-model task is
    standard image editing: reference-guided inpainting/compositing into an existing scene.

    The user provides:
    - a base scene image that should remain the anchor
    - a product/reference image that should be integrated into that scene

    Write a prompt that image-editing models can follow clearly. The result should look
    like a real photograph captured in one shot, not a pasted collage or mockup.
    Emphasize physical realism: scale, perspective, occlusion, shadow direction,
    reflections, texture, lens consistency, and color temperature.

    Rules:
    - PRIORITY ORDER (highest to lowest):
      1) budget_requirements (hard constraint)
      2) reference_adherence (hard anchor constraint)
      3) preserve scene geometry/camera and believable inpainting/compositing
      4) user_preferences/style details
    - Never include UUIDs, URLs, or technical identifiers in the prompt.
    - Never include text instructions like "no text" in the main prompt (use negative_prompt).
    - Keep prompts under 300 words; be specific and visual.
    - Treat this as image editing with a strong anchor image.
    - Preserve the base scene's camera viewpoint, room geometry, horizon, framing, depth, and lighting logic.
    - Only modify the local area needed to insert or replace the requested object/material.
    - Do not describe a brand-new scene from scratch unless explicitly required by the inputs.
    """

    service_summary: str = dspy.InputField(
        desc="Short project context that tells the model what kind of real-world scene is being edited."
    )
    subject: str = dspy.InputField(
        desc="Short label for the project or install type, used to ground the visual domain."
    )
    style_tags: str = dspy.InputField(
        desc="Comma-separated visual style tags that should influence the edited result."
    )
    location: str = dspy.InputField(desc="Geographic context if it affects materials, climate, or styling.")
    scene_context: str = dspy.InputField(
        desc="One-line description of the anchor/base image that must be preserved."
    )
    product_context: str = dspy.InputField(
        desc="One-line description of the reference object/material that should be inserted or matched."
    )
    user_preferences: str = dspy.InputField(
        desc="Condensed user preferences that shape the edit after anchor preservation and budget constraints."
    )
    reference_adherence: str = dspy.InputField(
        desc=(
            "Hard anchor-image instructions. Preserve composition, perspective, geometry, and lighting; "
            "limit edits to the local inpaint/composite region."
        )
    )
    budget_requirements: str = dspy.InputField(
        desc=(
            "Hard budget directive that must control material quality, finish level, and realism."
        )
    )
    budget_level: str = dspy.InputField(
        desc="Normalized budget signal if available (e.g. '$$', 'mid-range', '~10k')."
    )

    prompt: str = dspy.OutputField(
        desc="A concise image-editing prompt for realistic inpainting/compositing into the anchor image."
    )
    negative_prompt: str = dspy.OutputField(
        desc="Negative prompt covering common edit failures like artifacts, bad perspective, fake shadows, and text."
    )


class ScenePlacementPromptModule(dspy.Module):
    """Reference-guided inpainting/compositing into an existing scene."""

    def __init__(self) -> None:
        super().__init__()
        self.generate = dspy.Predict(ScenePlacementPromptSignature)

    def forward(
        self,
        *,
        service_summary: str = "",
        subject: str = "",
        style_tags: str = "",
        location: str = "",
        scene_context: str = "",
        product_context: str = "",
        user_preferences: str = "",
        reference_adherence: str = "",
        budget_requirements: str = "",
        budget_level: str = "",
    ):
        return self.generate(
            service_summary=service_summary or "",
            subject=subject or "project",
            style_tags=style_tags or "",
            location=location or "",
            scene_context=scene_context or "User provided a scene as background.",
            product_context=product_context or "User provided a product to place in the scene.",
            user_preferences=user_preferences or "",
            reference_adherence=reference_adherence or "",
            budget_requirements=budget_requirements or "",
            budget_level=budget_level or "",
        )


__all__ = ["ScenePlacementPromptModule", "ScenePlacementPromptSignature"]
