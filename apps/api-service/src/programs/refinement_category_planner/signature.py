from __future__ import annotations

import dspy

from programs.refinement_category_planner.prompt_library import build_refinement_category_prompt


class RefinementCategoryPlannerSignature(dspy.Signature):
    planner_context_json: str = dspy.InputField(
        desc="JSON string ONLY. Category/subcategory context plus optional company/service summary."
    )
    target_categories: int = dspy.InputField(desc="Preferred number of categories to emit.")
    min_categories: int = dspy.InputField(desc="Minimum number of categories to emit.")
    max_categories: int = dspy.InputField(desc="Hard cap for category count.")
    refinement_category_plan_json: str = dspy.OutputField(
        desc=(
            "JSON string ONLY. Single object with top-level `vertical` and `categories` array. "
            "Each category item must include `raw_name`, `priority`, and `reason`."
        )
    )


RefinementCategoryPlannerSignature.__doc__ = build_refinement_category_prompt()

__all__ = ["RefinementCategoryPlannerSignature"]
