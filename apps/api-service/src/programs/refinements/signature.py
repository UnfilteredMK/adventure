from __future__ import annotations

import dspy

from programs.refinements.prompt_library import build_refinements_prompt


class RefinementsPlannerSignature(dspy.Signature):
    """
    Refinements planner signature.
    Generates question copy only for DB-backed refinement image grids.
    """

    planner_context_json: str = dspy.InputField(
        desc=(
            "JSON string ONLY. Refinement context + memory (services_summary, industry/service, answered_qa, asked_step_ids, "
            "and refinement_catalog with component labels + option labels for the existing image grids)."
        )
    )
    max_steps: int = dspy.InputField(desc="Maximum number of refinement image-grid questions to emit.")
    allowed_mini_types: list[str] = dspy.InputField(desc="Allowed UI step types. Use image_choice_grid for every refinement step.")
    refinement_plan_json: str = dspy.OutputField(
        desc=(
            "JSON string ONLY. Single object with top-level `plan` array. Each item must include: "
            "component_key (copied from refinement_catalog), question (user-facing), and type_hint='image_choice_grid'. "
            "Do not generate option_hints, option labels, image prompts, or new component keys. "
            "Questions should be service-specific stylistic inpainting refinements for the provided component."
        )
    )


RefinementsPlannerSignature.__doc__ = build_refinements_prompt()

__all__ = ["RefinementsPlannerSignature"]
