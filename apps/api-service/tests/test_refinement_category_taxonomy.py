from programs.refinement_category_planner.taxonomy import (
    default_refinement_category_keys,
    normalize_refinement_category_key,
    normalize_refinement_plan_items,
)


def test_normalize_refinement_category_key_maps_aliases() -> None:
    assert normalize_refinement_category_key("patio flooring") == "pavers"
    assert normalize_refinement_category_key("privacy greenery") == "privacy_planting"
    assert normalize_refinement_category_key("overhead cover") == "pergola_shade"


def test_default_refinement_category_keys_no_longer_backfills_generic_defaults() -> None:
    keys = default_refinement_category_keys(category_name="Landscaping", subcategory_name="Patio & Deck Design", limit=4)
    assert keys == []


def test_normalize_refinement_plan_items_keeps_supported_matches_without_backfill() -> None:
    out = normalize_refinement_plan_items(
        [
            {"raw_name": "patio flooring", "priority": 1, "reason": "Main surface direction."},
            {"raw_name": "privacy greenery", "priority": 2, "reason": "Screening style."},
        ],
        category_name="Landscaping",
        subcategory_name="Patio & Deck Design",
        target_categories=4,
        min_categories=3,
        max_categories=5,
    )
    keys = [item["canonical_key"] for item in out]
    assert keys == ["pavers", "privacy_planting"]


def test_normalize_refinement_plan_items_drops_duplicates_and_unsupported_without_backfill() -> None:
    out = normalize_refinement_plan_items(
        [
            {"raw_name": "patio flooring", "priority": 1, "reason": "Main surface direction."},
            {"raw_name": "pavers", "priority": 2, "reason": "Duplicate of patio flooring."},
            {"raw_name": "permit packet", "priority": 3, "reason": "Not a visible refinement."},
        ],
        category_name="Landscaping",
        subcategory_name="Patio & Deck Design",
        target_categories=4,
        min_categories=3,
        max_categories=5,
    )
    keys = [item["canonical_key"] for item in out]
    assert keys == ["pavers"]


def test_normalize_refinement_plan_items_excludes_existing_component_keys() -> None:
    out = normalize_refinement_plan_items(
        [
            {"raw_name": "paver style", "priority": 1, "reason": "Already covered."},
            {"raw_name": "privacy planting", "priority": 2, "reason": "Still missing."},
            {"raw_name": "fire pit style", "priority": 3, "reason": "Still missing."},
        ],
        category_name="Landscaping",
        subcategory_name="Patio & Deck Design",
        exclude_keys=["pavers"],
        target_categories=4,
        min_categories=0,
        max_categories=4,
    )
    keys = [item["canonical_key"] for item in out]
    assert keys == ["privacy_planting", "firepit"]
