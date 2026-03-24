from __future__ import annotations

import dspy

from programs.refinement_library_planner.prompt_library import build_refinement_library_prompt


class RefinementLibraryPlannerSignature(dspy.Signature):
    """Plan per-service refinement components and seeded option image prompts."""

    planner_context_json: str = dspy.InputField(
        desc="JSON string with category/service context, summaries, targets, and optional existing components."
    )
    target_component_count: int = dspy.InputField(desc="Maximum refinement components to output.")
    target_options_per_component: int = dspy.InputField(desc="Maximum option seeds per component.")

    refinement_library_plan_json: str = dspy.OutputField(
        desc="JSON object with `components` and `optionSeeds` arrays only, no markdown.",
    )


RefinementLibraryPlannerSignature.__doc__ = build_refinement_library_prompt()

__all__ = ["RefinementLibraryPlannerSignature"]
