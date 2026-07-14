from __future__ import annotations

from programs.refinement_library_planner import semantic_validator


def _bathroom_candidates():
    return [
        {"key": "vanity", "label": "Vanity", "priority": 1, "reason": "Focal fixture"},
        {"key": "shower_tile", "label": "Shower Tile", "priority": 2, "reason": "Wet-area finish"},
        {"key": "pavers", "label": "Pavers", "priority": 3, "reason": "Hardscape finish"},
        {"key": "outdoor_lighting", "label": "Outdoor Lighting", "priority": 4, "reason": "Exterior lighting"},
        {"key": "walkway", "label": "Walkway", "priority": 5, "reason": "Exterior path"},
    ]


def test_normalizes_one_fail_closed_result_per_candidate() -> None:
    candidates = semantic_validator.resolve_candidate_components({"components": _bathroom_candidates()})
    results = semantic_validator.normalize_semantic_validation_results(
        candidates,
        [
            {"key": "vanity", "relevanceScore": 0.98, "reason": "Core bathroom fixture."},
            {"key": "shower_tile", "relevance_score": 0.75, "reason": "Core bathroom finish."},
            {"key": "pavers", "score": 0.1, "reason": "Exterior hardscape, not a bathroom choice."},
            {"key": "outdoor_lighting", "relevanceScore": "not-a-number", "reason": "Wrong trade."},
            # walkway is deliberately omitted; omissions must become a score of zero.
            {"key": "invented_key", "relevanceScore": 1.0, "reason": "Must be ignored."},
        ],
    )

    assert [result["key"] for result in results] == [
        "vanity",
        "shower_tile",
        "pavers",
        "outdoor_lighting",
        "walkway",
    ]
    scores = {result["key"]: result["relevanceScore"] for result in results}
    assert scores == {
        "vanity": 0.98,
        "shower_tile": 0.75,
        "pavers": 0.1,
        "outdoor_lighting": 0.0,
        "walkway": 0.0,
    }
    assert all(result["reason"] for result in results)


def test_duplicate_or_out_of_range_scores_fail_closed() -> None:
    candidates = semantic_validator.resolve_candidate_components(
        {"components": [{"key": "flooring", "label": "Flooring"}, {"key": "lighting", "label": "Lighting"}]}
    )
    results = semantic_validator.normalize_semantic_validation_results(
        candidates,
        [
            {"key": "flooring", "relevanceScore": 0.9, "reason": "Relevant."},
            {"key": "flooring", "relevanceScore": 0.2, "reason": "Ambiguous duplicate."},
            {"key": "lighting", "relevanceScore": 1.5, "reason": "Out of range."},
        ],
    )

    assert results[0]["relevanceScore"] == 0.0
    assert results[1]["relevanceScore"] == 0.0


def test_validate_endpoint_contract_returns_threshold_and_all_candidates(monkeypatch) -> None:
    def fake_run_validator_once(*, context, candidates, retry_hint):
        assert context["subcategory_name"] == "Bathroom Remodeling"
        assert len(candidates) == 5
        assert retry_hint is None
        return (
            {
                "results": [
                    {"key": item["key"], "relevanceScore": 0.8, "reason": "Grounded in service context."}
                    for item in candidates[:-1]
                ]
            },
            {"tokens": 12},
        )

    monkeypatch.setattr(semantic_validator, "_run_validator_once", fake_run_validator_once)

    response = semantic_validator.validate_refinement_components(
        {
            "subcategoryName": "Bathroom Remodeling",
            "serviceSummary": "Renovate interior bathroom fixtures and finishes.",
            "components": _bathroom_candidates(),
        }
    )

    assert response["ok"] is True
    assert response["threshold"] == 0.75
    assert len(response["results"]) == 5
    assert response["results"][-1]["key"] == "walkway"
    assert response["results"][-1]["relevanceScore"] == 0.0


def test_validate_endpoint_retries_only_malformed_contract(monkeypatch) -> None:
    calls = []

    def fake_run_validator_once(*, context, candidates, retry_hint):
        calls.append(retry_hint)
        if len(calls) == 1:
            return None, None
        return {
            "results": [
                {"key": candidates[0]["key"], "relevanceScore": 0.9, "reason": "Relevant."},
            ]
        }, None

    monkeypatch.setattr(semantic_validator, "_run_validator_once", fake_run_validator_once)
    response = semantic_validator.validate_refinement_components(
        {
            "service": "Bathroom Remodeling",
            "components": [{"key": "vanity", "label": "Vanity"}],
        }
    )

    assert response["ok"] is True
    assert calls[0] is None
    assert "exactly one" in calls[1]


def test_validate_endpoint_requires_context_and_candidates() -> None:
    assert semantic_validator.validate_refinement_components({"components": _bathroom_candidates()})["error"] == "missing_service_context"
    assert semantic_validator.validate_refinement_components({"service": "Bathroom Remodeling"})["error"] == "missing_components"
