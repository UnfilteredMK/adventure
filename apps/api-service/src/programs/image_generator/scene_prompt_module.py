"""DSPy module for scene use case: text-to-image or edit of a space (design/renovation preview)."""

from __future__ import annotations

import dspy


class ScenePromptSignature(dspy.Signature):
    """Generate an optimal image generation prompt for a professional services design preview (scene).

    You are an expert prompt engineer for AI image generation models (Flux, Stable Diffusion).
    Given structured context about a service project and user preferences, produce a
    concise, visually descriptive prompt that will generate a photorealistic design preview.
    The service could be anything — home renovation, landscaping, jewelry, automotive,
    fashion, commercial fit-out, etc. Derive all domain-specific visual language from
    service_name and service_summary; never assume a specific industry.

    Rules:
    - PRIORITY ORDER (highest to lowest):
      1) reference_adherence (hard constraint for edit mode)
      2) budget_level material/quality fit
      3) user_preferences/style details
    - Never include UUIDs, URLs, or technical identifiers in the prompt.
    - Never include text instructions like "no text" in the main prompt (use negative_prompt).
    - Always describe a single finished image, never a before/after comparison, split screen, side-by-side layout,
      diptych, collage, storyboard, annotated mockup, or any design with visible text overlays.
    - For edit mode (is_edit=true): The uploaded reference image is the BEFORE state.
      Generate the fully-completed, professional AFTER state.
      Use service_name and service_summary to understand exactly what this project entails —
      what elements would be replaced, upgraded, or transformed — and make ALL of those things
      look brand-new and professionally done. Nothing the service would have touched should look
      old, worn, or original. Preserve only the structural/contextual elements that would NOT
      be changed by this service (e.g. background environment, camera angle, unchanged parts of
      the subject). Replace or transform everything the service covers. Treat the upload as source context only,
      not as one half of a comparison graphic.
    - For generation mode (is_edit=false): use descriptive language painting the final result.
      Use service_summary to understand the scope of work and ensure the scene reflects a
      fully-completed professional project rendered as one coherent final scene.
    - Focus on materials, colors, textures, lighting, and spatial arrangement.
    - Keep prompts under 300 words; be specific and visual, not abstract.
    - CRITICAL: Budget level MUST be reflected in the visual quality shown.
      Do NOT default to luxury finishes or materials when budget is low or mid-range.
      Apply this principle to whatever domain the service is in:
        Low budget:    entry-level, builder-grade, standard, off-the-shelf quality
        Mid budget:    mid-range, good quality, professionally selected
        High budget:   premium, custom, high-end, designer quality
        Luxury budget: bespoke, top-of-the-line, finest available materials/finishes
      Translate these quality tiers into the specific materials/finishes appropriate for
      the service_name and service_summary — do not assume a home renovation context.
    """

    service_name: str = dspy.InputField(desc="Name of the service (e.g. 'Bathroom Remodeling')")
    service_summary: str = dspy.InputField(
        desc=(
            "Description of what this service entails — use this to understand what gets replaced/upgraded. "
            "For edit mode: any element this service would touch must look brand-new in the output."
        )
    )
    is_edit: bool = dspy.InputField(desc="True if editing an uploaded image, False for text-to-image")
    user_preferences: str = dspy.InputField(
        desc="Structured user preferences as key-value pairs (style, materials, colors, etc.)"
    )
    reference_adherence: str = dspy.InputField(
        desc=(
            "HARD reference-image constraint for edit mode. Treat uploaded image as anchor: "
            "preserve camera/framing, room geometry, perspective, lighting direction, and unchanged objects. "
            "Only edit requested scope."
        )
    )
    style_tags: str = dspy.InputField(desc="Comma-separated style keywords (e.g. 'modern, coastal')")
    budget_level: str = dspy.InputField(
        desc=(
            "Budget range that DIRECTLY controls the visual material quality shown. "
            "Map to materials: "
            "~$1k-10k = vinyl/laminate/stock/basic; "
            "~$10k-30k = engineered hardwood/quartz/semi-custom; "
            "~$30k-70k = hardwood/natural stone/custom cabinetry; "
            "~$70k+ = marble/bespoke/luxury. "
            "Never show luxury materials for a low budget."
        )
    )
    location: str = dspy.InputField(desc="Geographic location if known")

    prompt: str = dspy.OutputField(
        desc="The image generation prompt: concise, visual, photorealistic description"
    )
    negative_prompt: str = dspy.OutputField(
        desc="Negative prompt: things to avoid (text, logos, artifacts, low quality)"
    )


class ScenePromptModule(dspy.Module):
    """Scene use case: full design/renovation prompt (text-to-image or edit)."""

    def __init__(self) -> None:
        super().__init__()
        self.generate = dspy.ChainOfThought(ScenePromptSignature)

    def forward(
        self,
        *,
        service_name: str = "",
        service_summary: str = "",
        is_edit: bool = False,
        user_preferences: str = "",
        reference_adherence: str = "",
        style_tags: str = "",
        budget_level: str = "",
        location: str = "",
    ):
        return self.generate(
            service_name=service_name or "Home improvement",
            service_summary=service_summary or "",
            is_edit=is_edit,
            user_preferences=user_preferences,
            reference_adherence=reference_adherence or "",
            style_tags=style_tags,
            budget_level=budget_level,
            location=location,
        )


__all__ = ["ScenePromptModule", "ScenePromptSignature"]
