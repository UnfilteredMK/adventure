"""DSPy module for scene-refinement use case: preserve the current scene and apply focused edits."""

from __future__ import annotations

import dspy


class SceneRefinementPromptSignature(dspy.Signature):
    """Generate an optimal image prompt for scene refinements.

    You are generating a scene-refinement prompt.
    The user already has a generated or uploaded scene image that acts as the anchor.
    Your job is to preserve the existing composition and overall design intent while making
    only the specific requested changes. Think of this as a focused in-place design revision.

    Rules:
    - PRIORITY ORDER (highest to lowest):
      1) reference_adherence (hard anchor constraint)
      2) budget_requirements (hard finish/material constraint)
      3) preserve scene geometry/camera/composition
      4) user_preferences / requested refinement deltas
    - Never include UUIDs, URLs, or technical identifiers in the prompt.
    - Never include text instructions like "no text" in the main prompt (use negative_prompt).
    - Keep prompts under 300 words; be specific and visual.
    - Treat this as an image-edit/inpaint task: preserve the original structure and only revise targeted elements.
    - Do not rewrite the whole design from scratch. Preserve unchanged materials, objects, and layout unless the user explicitly asked to change them.
    """

    service_summary: str = dspy.InputField(
        desc="Short description of the service/project context (e.g. landscaping, interior design)."
    )
    subject: str = dspy.InputField(
        desc="Short service or project label (e.g. 'garden design', 'bathroom remodel')."
    )
    style_tags: str = dspy.InputField(desc="Comma-separated style keywords.")
    location: str = dspy.InputField(desc="Geographic location if known.")
    scene_context: str = dspy.InputField(
        desc="One-line context for the anchor image / current scene."
    )
    user_preferences: str = dspy.InputField(
        desc="Condensed user answers/preferences describing the specific requested refinements."
    )
    previous_prompt: str = dspy.InputField(
        desc="Best-effort summary of the prior generation prompt/design intent to preserve across refinement turns."
    )
    refinement_notes: str = dspy.InputField(
        desc="Latest explicit delta request from the user describing what to change in this refinement turn."
    )
    reference_adherence: str = dspy.InputField(
        desc=(
            "HARD anchor-image constraint. Keep the current scene composition/camera geometry stable; "
            "apply only focused local edits requested by the user."
        )
    )
    budget_requirements: str = dspy.InputField(
        desc=(
            "HARD budget directive. Must control finish/material quality. "
            "Never drift into a higher-tier/luxury finish level than the budget supports."
        )
    )
    budget_level: str = dspy.InputField(desc="Budget signal if available.")

    prompt: str = dspy.OutputField(
        desc="The image generation prompt: concise, visual, refinement-focused description"
    )
    negative_prompt: str = dspy.OutputField(
        desc="Negative prompt: things to avoid (text, logos, artifacts, layout drift)"
    )


class SceneRefinementPromptModule(dspy.Module):
    """Scene-refinement use case: preserve anchor scene and make focused changes."""

    def __init__(self) -> None:
        super().__init__()
        self.generate = dspy.ChainOfThought(SceneRefinementPromptSignature)

    def forward(
        self,
        *,
        service_summary: str = "",
        subject: str = "",
        style_tags: str = "",
        location: str = "",
        scene_context: str = "",
        user_preferences: str = "",
        previous_prompt: str = "",
        refinement_notes: str = "",
        reference_adherence: str = "",
        budget_requirements: str = "",
        budget_level: str = "",
    ):
        return self.generate(
            service_summary=service_summary or "",
            subject=subject or "project",
            style_tags=style_tags or "",
            location=location or "",
            scene_context=scene_context or "User provided an anchor scene to refine.",
            user_preferences=user_preferences or "",
            previous_prompt=previous_prompt or "",
            refinement_notes=refinement_notes or "",
            reference_adherence=reference_adherence or "",
            budget_requirements=budget_requirements or "",
            budget_level=budget_level or "",
        )


__all__ = ["SceneRefinementPromptModule", "SceneRefinementPromptSignature"]
