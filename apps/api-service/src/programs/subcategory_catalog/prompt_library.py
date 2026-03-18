"""
Prompt library for subcategory catalog planning.
"""

from __future__ import annotations

from typing import Iterable, List


CONTEXT_JSON_FIELDS = """`catalog_context_json` typically includes:
- `service_summary`: the best plain-English summary of the service/subcategory
- `industry`: parent industry or category
- `service`: the service / subcategory name
- `category_name`: optional broader category label
- `subcategory_name`: optional explicit subcategory label
- `target_count`: desired number of starter catalog concepts
""".strip()


def _lines(*parts: str) -> str:
    out: List[str] = []
    for part in parts:
        text = str(part or "").strip()
        if text:
            out.append(text)
    return "\n\n".join(out).strip() + "\n"


def _bullets(title: str, bullets: Iterable[str]) -> str:
    items = [f"- {str(item).strip()}" for item in bullets if str(item or "").strip()]
    if not items:
        return ""
    return _lines(title.strip(), "\n".join(items))


def build_subcategory_catalog_prompt() -> str:
    return _lines(
        "Create a starter catalog of service-specific visual directions for reusable image thumbnails.",
        "GOAL AND INSTRUCTIONS:",
        (
            "You are the Subcategory Catalog Planner. Your job is to create a diverse set of image concepts "
            "for one specific service/subcategory so those images can be generated once, stored, and reused later.\n"
            "\n"
            "The concepts must be specific to the actual service context. Bathroom remodeling concepts should feel like "
            "bathroom remodeling. Landscaping hardscape concepts should feel like hardscape design. Do not output a generic "
            "universal mood-board list that could fit any business.\n"
            "\n"
            "Think like a design director building the first image grid a customer would see. The set should be broad enough "
            "to cover realistic taste clusters, material directions, quality tiers, and visual identities for that service."
        ),
        _lines("CONTEXT FIELDS:", CONTEXT_JSON_FIELDS),
        _bullets(
            "INPUTS:",
            [
                "`catalog_context_json`: compact JSON string with service context.",
                "`target_count`: desired number of concepts to emit.",
            ],
        ),
        _bullets(
            "OUTPUT SHAPE:",
            [
                "Return JSON only in `catalog_plan_json`.",
                "Return a single JSON object with this shape: "
                '{"question":"...","concepts":[{"label":"...","value":"...","image_prompt":"...","description":"...","price_tier":"$|$$|$$$|$$$$"}]}',
                "`question` should be a short user-facing prompt for the image grid.",
                "`concepts` should contain as many high-quality options as possible up to `target_count`.",
            ],
        ),
        _bullets(
            "CONCEPT RULES:",
            [
                "Every concept must be visually distinct from the others.",
                "Use concrete, service-specific labels such as design directions, material stories, or aesthetic clusters.",
                "Each `label` should be short, natural, and user-facing.",
                "Each `value` must be snake_case and stable.",
                "Each `image_prompt` must explicitly describe the service result and the visual direction so an image model can render it.",
                "Each `description` should briefly explain what defines that direction in plain English.",
                "Use `price_tier` only from '$', '$$', '$$$', '$$$$'. If used, the image_prompt must visually reflect that tier.",
                "Do not ask for before/after comparisons, split screens, collages, mockups with labels, or any visible text in the generated image.",
                "Do not include 'Other', 'Not sure', placeholders, duplicates, or generic filler options.",
                "Avoid generic words like 'nice', 'beautiful', or 'premium' unless grounded in real materials or design cues.",
                "Favor broad-but-real customer preference clusters, not tiny detail tweaks.",
            ],
        ),
        _bullets(
            "QUALITY BAR:",
            [
                "The set should feel like a strong starting gallery for this exact service.",
                "Cover a healthy spread of styles and budgets without drifting outside the service category.",
                "Concepts should be suitable for photorealistic thumbnail generation.",
            ],
        ),
        _bullets(
            "HARD RULES:",
            [
                "Output JSON only. No prose, markdown, or code fences.",
                "Do not echo the prompt or inputs.",
                "Do not emit more than `target_count` concepts.",
                "Prefer 12 or more concepts when enough service-specific variety exists.",
            ],
        ),
    )


__all__ = ["CONTEXT_JSON_FIELDS", "build_subcategory_catalog_prompt"]
