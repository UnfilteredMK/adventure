"""DSPy module for tryon use case: virtual try-on (product on person)."""

from __future__ import annotations

import dspy


class TryonPromptSignature(dspy.Signature):
    """Generate an optimal image prompt for virtual try-on (product worn/applied on person).

    You are generating a virtual try-on prompt.
    The user provided a photo of themselves and a product image.
    Your prompt must describe the product being worn/applied naturally on the person.
    Preserve: the person's body shape, pose, skin tone, facial features.
    Focus on: natural draping/fit, correct shadows, fabric behavior, color accuracy.

    Rules:
    - Never include UUIDs, URLs, or technical identifiers in the prompt.
    - Never include text instructions like "no text" in the main prompt (use negative_prompt).
    - Keep prompts under 300 words; be specific and visual.
    """

    product_or_style_context: str = dspy.InputField(
        desc="Context about the product or style (e.g. from step data, service summary)."
    )
    style_direction: str = dspy.InputField(
        desc="Style direction (e.g. 'photorealistic try-on', 'modern', comma-separated keywords)."
    )
    constraints: str = dspy.InputField(
        desc="Constraints or negative hints (e.g. 'natural fit, correct draping', or empty)."
    )

    prompt: str = dspy.OutputField(
        desc="The image generation prompt: concise, try-on focused, photorealistic description"
    )
    negative_prompt: str = dspy.OutputField(
        desc="Negative prompt: things to avoid (text, logos, artifacts, wrong proportions)"
    )


class TryonPromptModule(dspy.Module):
    """Tryon use case: virtual try-on (product on person)."""

    def __init__(self) -> None:
        super().__init__()
        self.generate = dspy.Predict(TryonPromptSignature)

    def forward(
        self,
        *,
        product_or_style_context: str = "",
        style_direction: str = "",
        constraints: str = "",
    ):
        return self.generate(
            product_or_style_context=product_or_style_context or "Photorealistic virtual try-on.",
            style_direction=style_direction or "photorealistic try-on",
            constraints=constraints or "Natural fit, correct draping and shadows.",
        )


__all__ = ["TryonPromptModule", "TryonPromptSignature"]
