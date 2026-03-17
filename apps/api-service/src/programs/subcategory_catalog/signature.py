from __future__ import annotations

import dspy

from programs.subcategory_catalog.prompt_library import build_subcategory_catalog_prompt


class SubcategoryCatalogSignature(dspy.Signature):
    catalog_context_json: str = dspy.InputField(
        desc="JSON string ONLY. Service/subcategory context used to plan reusable thumbnail concepts."
    )
    target_count: int = dspy.InputField(desc="Target number of concepts to emit.")
    catalog_plan_json: str = dspy.OutputField(
        desc=(
            "JSON string ONLY. Single object with top-level `question` and `concepts` array. "
            "Each concept must include `label`, `value`, `image_prompt`, `description`, and optional `price_tier` "
            "using only '$', '$$', '$$$', '$$$$'."
        )
    )


SubcategoryCatalogSignature.__doc__ = build_subcategory_catalog_prompt()

__all__ = ["SubcategoryCatalogSignature"]
