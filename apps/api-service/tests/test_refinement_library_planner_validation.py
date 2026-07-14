from programs.refinement_library_planner import orchestrator
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


def test_excluded_component_keys_are_removed_with_their_seeds() -> None:
    raw = {
        "components": [
            {"key": "vanity", "label": "Vanity", "priority": 1, "reason": "Bathroom fixture"},
            {"key": "Pavers", "label": "Pavers", "priority": 2, "reason": "Exterior hardscape"},
        ],
        "optionSeeds": [
            {
                "componentKey": "vanity",
                "options": [
                    {
                        "label": "Floating oak",
                        "value": "floating_oak",
                        "imagePrompt": "Floating oak vanity in a finished contemporary bathroom",
                    }
                ],
            },
            {
                "componentKey": "pavers",
                "options": [
                    {
                        "label": "Concrete",
                        "value": "concrete",
                        "imagePrompt": "Concrete pavers across an exterior garden walkway",
                    }
                ],
            },
        ],
    }

    ok, err, norm = validate_and_normalize_planner_payload(
        raw,
        target_component_count=10,
        target_options_per_component=6,
        excluded_component_keys=["PAVERS"],
    )

    assert ok and not err
    assert [component["key"] for component in norm["components"]] == ["vanity"]
    assert [group["componentKey"] for group in norm["optionSeeds"]] == ["vanity"]


def test_planner_request_passes_and_enforces_excluded_keys(monkeypatch) -> None:
    calls = []

    def fake_run_planner_once(
        *,
        ctx,
        excluded_component_keys,
        existing_components,
        target_component_count,
        target_options_per_component,
        retry_hint,
    ):
        calls.append(
            {
                "excluded": excluded_component_keys,
                "existing": existing_components,
                "retry_hint": retry_hint,
            }
        )
        return (
            {
                "components": [
                    {"key": "vanity", "label": "Vanity", "priority": 1, "reason": "Bathroom fixture"},
                    {"key": "pavers", "label": "Pavers", "priority": 2, "reason": "Exterior hardscape"},
                ],
                "optionSeeds": [
                    {
                        "componentKey": "vanity",
                        "options": [
                            {
                                "label": "Floating oak",
                                "value": "floating_oak",
                                "imagePrompt": "Floating oak vanity in a finished contemporary bathroom",
                            }
                        ],
                    },
                    {
                        "componentKey": "pavers",
                        "options": [
                            {
                                "label": "Concrete",
                                "value": "concrete",
                                "imagePrompt": "Concrete pavers across an exterior garden walkway",
                            }
                        ],
                    },
                ],
            },
            None,
        )

    monkeypatch.setattr(orchestrator, "_run_planner_once", fake_run_planner_once)
    response = orchestrator.plan_refinement_library(
        {
            "service": "Bathroom Remodeling",
            "excludedComponentKeys": ["Pavers", "pavers"],
            "existingComponents": [
                {"key": "vanity", "label": "Vanity"},
                {"key": "pavers", "label": "Pavers"},
            ],
        }
    )

    assert response["ok"] is True
    assert response["excludedComponentKeys"] == ["pavers"]
    assert [component["key"] for component in response["components"]] == ["vanity"]
    assert calls == [
        {
            "excluded": ["pavers"],
            "existing": [{"key": "vanity", "label": "Vanity", "priority": None}],
            "retry_hint": None,
        }
    ]
