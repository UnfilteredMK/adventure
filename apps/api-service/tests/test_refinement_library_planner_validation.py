from programs.refinement_library_planner.validation import validate_and_normalize_planner_payload


def test_bathroom_like_plan_drops_outdoor_when_not_in_raw() -> None:
    raw = {
        "components": [
            {"key": "vanity_style", "label": "Vanity", "priority": 1, "reason": "Main focal fixture"},
            {"key": "shower_tile", "label": "Shower tile", "priority": 2, "reason": "Wet-area visual"},
        ],
        "optionSeeds": [
            {
                "componentKey": "vanity_style",
                "options": [
                    {
                        "label": "Floating walnut",
                        "value": "floating_walnut",
                        "imagePrompt": "Floating walnut vanity in a bright modern bathroom, photorealistic detail",
                    },
                    {
                        "label": "Classic white",
                        "value": "classic_white",
                        "imagePrompt": "Classic white double vanity with marble top, soft natural light",
                    },
                ],
            },
            {
                "componentKey": "shower_tile",
                "options": [
                    {
                        "label": "Large stone look",
                        "value": "large_stone",
                        "imagePrompt": "Large format stone look shower tile, spa bathroom, crisp grout lines",
                    },
                    {
                        "label": "Subway stack",
                        "value": "subway_stack",
                        "imagePrompt": "Vertical white subway shower tile with black accents",
                    },
                ],
            },
        ],
    }
    ok, err, norm = validate_and_normalize_planner_payload(
        raw, target_component_count=10, target_options_per_component=6
    )
    assert ok and not err
    keys = {c["key"] for c in norm["components"]}
    assert "vanity_style" in keys
    assert "shower_tile" in keys
    assert "pavers" not in keys
    assert "outdoor_lighting" not in keys


def test_drops_process_like_components() -> None:
    raw = {
        "components": [
            {"key": "flooring", "label": "Flooring", "priority": 1, "reason": "Visual finish"},
            {"key": "bad", "label": "Permit timeline", "priority": 2, "reason": "Admin"},
        ],
        "optionSeeds": [
            {
                "componentKey": "flooring",
                "options": [
                    {
                        "label": "Oak plank",
                        "value": "oak",
                        "imagePrompt": "Warm oak wide plank flooring in a finished living room scene",
                    },
                    {
                        "label": "Polished concrete",
                        "value": "concrete",
                        "imagePrompt": "Polished concrete floors with soft daylight and minimal furniture",
                    },
                ],
            }
        ],
    }
    ok, err, norm = validate_and_normalize_planner_payload(
        raw, target_component_count=10, target_options_per_component=6
    )
    assert ok
    assert len(norm["components"]) == 1
    assert norm["components"][0]["key"] == "flooring"


def test_requires_option_seeds_per_component() -> None:
    raw = {
        "components": [{"key": "roofing", "label": "Roofing", "priority": 1, "reason": "Curb appeal"}],
        "optionSeeds": [],
    }
    ok, err, _norm = validate_and_normalize_planner_payload(
        raw, target_component_count=10, target_options_per_component=6
    )
    assert not ok
    assert "missing_option_seeds" in err


def test_dedupes_component_and_option_values() -> None:
    raw = {
        "components": [
            {"key": "Flooring Style", "label": "Flooring", "priority": 1, "reason": "x"},
            {"key": "flooring style", "label": "Flooring dup", "priority": 2, "reason": "y"},
        ],
        "optionSeeds": [
            {
                "componentKey": "flooring_style",
                "options": [
                    {
                        "label": "Oak",
                        "value": "oak_plank",
                        "imagePrompt": "Oak plank flooring photorealistic interior wide shot",
                    },
                    {
                        "label": "Walnut",
                        "value": "oak_plank",
                        "imagePrompt": "Walnut plank flooring rich tones photorealistic",
                    },
                ],
            }
        ],
    }
    ok, _, norm = validate_and_normalize_planner_payload(
        raw, target_component_count=10, target_options_per_component=6
    )
    assert ok
    assert len(norm["components"]) == 1
    assert len(norm["optionSeeds"][0]["options"]) == 1
