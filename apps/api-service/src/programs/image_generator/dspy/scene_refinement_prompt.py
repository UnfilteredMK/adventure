"""DSPy module for reference-guided scene refinement and localized image editing."""

from __future__ import annotations

import dspy


class SceneRefinementPromptSignature(dspy.Signature):
    """Generate a prompt for refining an existing generated or uploaded scene image.

    This use case is called "scene-refinement" in our app, but for the model this is
    reference-guided image editing: preserve the anchor image and apply targeted edits.

    The user already has a scene image that serves as the anchor. Your job is to keep
    the composition, camera, and overall structure stable while changing only the parts
    requested in the current refinement turn. Think in terms of localized inpainting or
    tightly constrained image editing, not a fresh text-to-image generation.

    Rules:
    - PRIORITY ORDER (highest to lowest):
      1) reference_adherence (hard anchor constraint)
      2) budget_requirements (hard finish/material constraint)
      3) preserve scene geometry/camera/composition
      4) user_preferences / requested refinement deltas
    - Never include UUIDs, URLs, or technical identifiers in the prompt.
    - Never include text instructions like "no text" in the main prompt (use negative_prompt).
    - Keep prompts under 300 words; be specific and visual.
    - Treat this as image editing with a strong anchor image.
    - Preserve composition, camera viewpoint, perspective, room geometry, major layout, and lighting logic.
    - Change only the requested elements unless the instructions explicitly allow broader replacement.
    - If this is a budget tier shift, keep the same scene structure but allow a wider material/finish overhaul.
    """

    service_summary: str = dspy.InputField(
        desc="Short project context that defines the real-world domain and renovation scope."
    )
    subject: str = dspy.InputField(
        desc="Short visual subject label for the edited project."
    )
    style_tags: str = dspy.InputField(desc="Comma-separated style keywords for the refined result.")
    location: str = dspy.InputField(desc="Geographic context if relevant to finishes, lighting, or styling.")
    scene_context: str = dspy.InputField(
        desc="One-line description of the current anchor image that should stay recognizable."
    )
    user_preferences: str = dspy.InputField(
        desc="Condensed preferences that shape the refinement after anchor preservation."
    )
    previous_prompt: str = dspy.InputField(
        desc="Best-effort summary of the prior prompt or design direction that should still be respected."
    )
    refinement_notes: str = dspy.InputField(
        desc="The latest explicit edit request describing exactly what should change in this turn."
    )
    reference_adherence: str = dspy.InputField(
        desc=(
            "Hard anchor-image instructions. Preserve composition, geometry, and viewpoint; "
            "apply only the requested focused edits unless broader replacement is explicitly allowed."
        )
    )
    budget_requirements: str = dspy.InputField(
        desc=(
            "Hard budget directive controlling finish quality, material tier, and realism."
        )
    )
    budget_level: str = dspy.InputField(desc="Normalized budget signal if available.")

    prompt: str = dspy.OutputField(
        desc="A concise reference-guided image-editing prompt for the refinement step."
    )
    negative_prompt: str = dspy.OutputField(
        desc="Negative prompt covering layout drift, artifacts, text, and other edit failures."
    )


class SceneRefinementPromptModule(dspy.Module):
    """Reference-guided scene refinement with strong anchor preservation."""

    def __init__(self) -> None:
        super().__init__()
        self.generate = dspy.Predict(SceneRefinementPromptSignature)

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
