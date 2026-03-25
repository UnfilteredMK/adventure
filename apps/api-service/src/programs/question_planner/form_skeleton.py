"""
Form skeleton – single source of truth for the deterministic form flow.

The skeleton defines the fixed order. Each slot has a PART CONTRACT that specifies
which parts are AI-generated vs deterministic (copy, options, range/component).

Edit this file to change the canonical funnel and which slots the planner fills.

Flow: choose service → scope → choose styles → budget → upload image → generate
"""

from __future__ import annotations

from typing import Literal

# ---------------------------------------------------------------------------
# Deterministic step IDs (frontend-owned – planner never generates full steps for these)
# ---------------------------------------------------------------------------
DETERMINISTIC_STEP_IDS: tuple[str, ...] = (
    "step-service-primary",      # 1. Choose service
    "step-style-direction",       # 3. Choose styles (planner: copy + component hints only)
    "step-budget-range",          # 4. Budget (planner: copy only; range from pricing API)
    "step-upload-scene-image",    # 5. Upload image – fully deterministic
    "step-upload-user-image",
    "step-upload-product-image",
    "step-promptInput",           # User prompt; not a planned question
)

# Step IDs to exclude from planner context (answered_qa, asked_step_ids).
# Prevents context drift when frontend deterministic answers are sent back.
PLANNER_EXCLUDED_STEP_IDS: tuple[str, ...] = (
    "step-style-direction",
    "step-budget-range",
    "step-upload-scene-image",
    "step-upload-user-image",
    "step-upload-product-image",
)

# ---------------------------------------------------------------------------
# SLOT ORDER AND PART CONTRACT
# Each slot: what the planner generates vs what comes from frontend/DB/API
# ---------------------------------------------------------------------------
SlotPartSource = Literal["ai", "deterministic", "db", "api"]

# Skeleton order: keys in sequence. Used to determine "next slot" from asked_step_ids.
SKELETON_SLOT_KEYS: tuple[str, ...] = (
    "step-service-primary",   # 1. Fully deterministic
    "scope",                  # 2. Scope questions: full AI (copy + options)
    "step-style-direction",   # 3. Copy + component: AI. Options: DB.
    "step-budget-range",     # 4. Copy: AI. Range: API.
    "step-upload-scene-image",  # 5. Fully deterministic (scene/user/product variants)
)

# Per-slot: which parts are AI-generated vs deterministic.
# Keys: step_id or "scope" for the scope slot.
# "copy" = question/headline/subtext; "options" = choice options; "range" = min/max/step.
SLOT_PART_SOURCES: dict[str, dict[str, SlotPartSource]] = {
    "step-service-primary": {"copy": "deterministic", "options": "db", "range": "n/a"},
    "step-style-direction": {"copy": "ai", "options": "db", "range": "n/a"},
    "scope": {"copy": "ai", "options": "ai", "range": "n/a"},
    "step-budget-range": {"copy": "ai", "options": "n/a", "range": "api"},
    "step-upload-scene-image": {"copy": "deterministic", "options": "n/a", "range": "n/a"},
}

# Slots where planner outputs COPY ONLY (no options, no range). Frontend merges with DB/API.
COPY_ONLY_SLOTS: tuple[str, ...] = ("step-style-direction", "step-budget-range")

# ---------------------------------------------------------------------------
# Planner slots: steps the planner FILLS (gaps in the skeleton)
# Pre-concept: only scope for FULL output. Style + budget for COPY ONLY.
# ---------------------------------------------------------------------------
SCOPE_KEYS: tuple[str, ...] = (
    "project_type",       # New/install, Update/redesign, Repair/fix - always first scope question
    "project_parts",      # What parts to update
    "update_areas",       # What areas to focus on
    "remodel_intensity",  # Light refresh / partial / full
)

# Keys the planner must NOT use before concept (those belong to refinements API).
BANNED_PRE_CONCEPT_KEYS: tuple[str, ...] = (
    "fixture_preference",
    "material_preference",
    "finish_style",
    "lighting_style",
    "storage_style",
    "color_tone",
    "countertop_material",
    "flooring_material",
)

# ---------------------------------------------------------------------------
# Human-readable skeleton for prompts and docs
# ---------------------------------------------------------------------------
SKELETON_ORDER: tuple[str, ...] = (
    "1. Choose the service",
    "2. What's the scope? (project_type / project_parts / update_areas / remodel_intensity)",
    "3. Choose some styles you like",
    "4. Budget",
    "5. Upload an image if you have one",
    "6. Generate the image",
)

SKELETON_DESCRIPTION = (
    "The form follows a fixed skeleton. The planner FILLS GAPS by outputting the appropriate "
    "content for each slot. Per-slot contract:\n"
    "- Service: deterministic (planner does nothing)\n"
    "- Scope: FULL (question + option_hints). Use keys: project_type (always first), project_parts, update_areas, remodel_intensity.\n"
    "- Style: COPY + component hints only (question, min_selections, max_selections). Options come from DB.\n"
    "- Budget: COPY only (question/headline, subtext). Range comes from pricing API.\n"
    "- Upload: deterministic (planner does nothing)\n"
    "Output only the next slot that is not yet done. If it's done, output empty."
)


def is_deterministic_step(step_id: str) -> bool:
    """True if the step is frontend-owned (planner may still generate copy for copy-only slots)."""
    s = str(step_id or "").strip()
    if not s:
        return False
    return s in DETERMINISTIC_STEP_IDS


# Scope slot maps to these step IDs (from derive_step_id_from_key).
_SCOPE_STEP_IDS: frozenset[str] = frozenset({
    "step-project-type",
    "step-project-parts",
    "step-update-areas",
    "step-remodel-intensity",
})


def get_next_slot_from_asked(asked_step_ids: list[str]) -> str | None:
    """
    Given asked_step_ids, return the next skeleton slot key that hasn't been asked.
    Returns None if all pre-concept slots are done (planner does nothing for upload).
    """
    asked = set(str(x or "").strip() for x in asked_step_ids if str(x or "").strip())
    if "step-service-primary" not in asked:
        return "step-service-primary"  # Planner does nothing; frontend owns this
    if not (asked & _SCOPE_STEP_IDS):
        return "scope"
    if "step-style-direction" not in asked:
        return "step-style-direction"
    if "step-budget-range" not in asked:
        return "step-budget-range"
    return None


def is_scope_key(key: str) -> bool:
    """True if the key is an allowed scope step for pre-concept planning."""
    k = str(key or "").strip().lower()
    return k in {x.lower() for x in SCOPE_KEYS}


def is_banned_pre_concept_key(key: str) -> bool:
    """True if the key is banned in pre-concept planning (belongs to refinements)."""
    k = str(key or "").strip().lower()
    return k in {x.lower() for x in BANNED_PRE_CONCEPT_KEYS}


__all__ = [
    "BANNED_PRE_CONCEPT_KEYS",
    "COPY_ONLY_SLOTS",
    "DETERMINISTIC_STEP_IDS",
    "PLANNER_EXCLUDED_STEP_IDS",
    "SCOPE_KEYS",
    "SKELETON_DESCRIPTION",
    "SKELETON_ORDER",
    "SKELETON_SLOT_KEYS",
    "SLOT_PART_SOURCES",
    "get_next_slot_from_asked",
    "is_banned_pre_concept_key",
    "is_deterministic_step",
    "is_scope_key",
]
