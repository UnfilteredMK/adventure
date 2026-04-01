from __future__ import annotations

import dspy


class SubcategoryScopeSuggesterSignature(dspy.Signature):
    """
    Propose early-step "scope" checklist items: concrete parts of the job a customer
    might want (select all that apply), specific to the industry and service.
    """

    scope_context_json: str = dspy.InputField(
        desc=(
            "JSON with industry/category name, service name, service summary, optional company summary, "
            "and refinement components (visual parts of the offering). Use these to infer realistic scope splits."
        )
    )
    min_scope_count: int = dspy.InputField(desc="Minimum number of scope items (typically 3).")
    max_scope_count: int = dspy.InputField(desc="Maximum number of scope items (typically 8).")

    scope_options_json: str = dspy.OutputField(
        desc='A single JSON object: {"scopes": ["Short label 1", "..."]} — short phrase per line, no markdown.'
    )


SCOPE_SUGGESTER_INSTRUCTIONS = """
You generate checklist labels for the FIRST step of a home-services or similar intake flow.

Rules:
- Output ONLY valid JSON: an object with a single key "scopes" whose value is an array of strings.
- Between min_scope_count and max_scope_count items (inclusive).
- Each string is 2–6 words: a common way customers carve up THIS service (what they might want done).
- Must be realistic for the given industry and service; use the refinement components as hints for how the trade is decomposed.
- Examples of intent: "Full remodel" vs "Vanity only" for bathrooms; "Outdoor kitchen" vs "Lawn + beds" for landscape — not generic filler.
- No duplicates; no "Other", "Not sure", or administrative options.
- No pricing, timelines, or questions — only scope-of-work phrases.
"""


SubcategoryScopeSuggesterSignature.__doc__ = SCOPE_SUGGESTER_INSTRUCTIONS

__all__ = ["SubcategoryScopeSuggesterSignature", "SCOPE_SUGGESTER_INSTRUCTIONS"]
