from __future__ import annotations

from programs.pricing import orchestrator
from programs.pricing.service_calibration import match_service_calibration


def test_match_service_calibration_prefers_matching_service() -> None:
    assert match_service_calibration("Luxury bathroom remodel with custom tile and fixtures.").key == "bathroom_remodel"
    assert match_service_calibration("Landscape redesign with planting, pavers, and lighting.").key == "landscape_design"


def test_estimate_pricing_initial_without_baseline_returns_total_only(monkeypatch) -> None:
    def _fake_build_context(_payload):
        return {
            "services_summary": "Bathroom remodeling service.",
            "industry": "Home services",
            "service": "Bathroom remodel",
        }

    def _fake_vlm(_payload, *, preview_image_url, calibration):
        assert preview_image_url == "https://example.com/after-bathroom.png"
        assert calibration.key == "bathroom_remodel"
        return {"rangeLow": 4_000, "rangeHigh": 6_000, "basis": "ai_v2", "confidence": "high"}

    monkeypatch.setattr(orchestrator, "build_context", _fake_build_context)
    monkeypatch.setattr(orchestrator, "estimate_pricing_with_vlm", _fake_vlm)

    resp = orchestrator.estimate_pricing(
        {
            "previewImageUrl": "https://example.com/after-bathroom.png",
            "pricingScenario": "initial",
        }
    )

    assert resp["ok"] is True
    assert resp["calibrationKey"] == "bathroom_remodel"
    assert resp["rangeHigh"] - resp["rangeLow"] <= 12_000
    assert resp["rangeLow"] >= 5_000
    assert "baselinePriceRange" not in resp
    assert "deltaPriceRange" not in resp
    assert "No visible baseline" in " ".join(resp["notes"])


def test_estimate_pricing_prefers_provided_baseline_range_over_baseline_image(monkeypatch) -> None:
    calls: list[str] = []

    def _fake_build_context(_payload):
        return {
            "services_summary": "Bathroom remodeling service.",
            "industry": "Home services",
            "service": "Bathroom remodel",
        }

    def _fake_vlm(_payload, *, preview_image_url, calibration):
        calls.append(preview_image_url)
        assert calibration.key == "bathroom_remodel"
        return {"rangeLow": 26_000, "rangeHigh": 30_000, "basis": "ai_v2", "confidence": "high"}

    monkeypatch.setattr(orchestrator, "build_context", _fake_build_context)
    monkeypatch.setattr(orchestrator, "estimate_pricing_with_vlm", _fake_vlm)

    resp = orchestrator.estimate_pricing(
        {
            "previewImageUrl": "https://example.com/after-bathroom.png",
            "baselineImageUrl": "https://example.com/before-bathroom.png",
            "baselinePriceRange": {"low": 12_000, "high": 18_000},
            "pricingScenario": "comparison",
        }
    )

    assert resp["ok"] is True
    assert calls == ["https://example.com/after-bathroom.png"]
    assert resp["baselinePriceRange"] == {"low": 12_000, "high": 18_000}
    assert resp["deltaDirection"] == "up"
    assert "provided_price_range" in " ".join(resp["notes"])


def test_estimate_pricing_with_baseline_image_returns_total_plus_delta(monkeypatch) -> None:
    calls: list[str] = []

    def _fake_build_context(_payload):
        return {
            "services_summary": "Bathroom remodeling service.",
            "industry": "Home services",
            "service": "Bathroom remodel",
        }

    def _fake_vlm(_payload, *, preview_image_url, calibration):
        calls.append(preview_image_url)
        assert calibration.key == "bathroom_remodel"
        if preview_image_url.endswith("before-bathroom.png"):
            return {"rangeLow": 12_000, "rangeHigh": 14_000, "basis": "ai_v2", "confidence": "high"}
        return {"rangeLow": 28_000, "rangeHigh": 32_000, "basis": "ai_v2", "confidence": "high"}

    monkeypatch.setattr(orchestrator, "build_context", _fake_build_context)
    monkeypatch.setattr(orchestrator, "estimate_pricing_with_vlm", _fake_vlm)

    resp = orchestrator.estimate_pricing(
        {
            "previewImageUrl": "https://example.com/after-bathroom.png",
            "baselineImageUrl": "https://example.com/before-bathroom.png",
            "pricingScenario": "comparison",
        }
    )

    assert resp["ok"] is True
    assert calls == [
        "https://example.com/after-bathroom.png",
        "https://example.com/before-bathroom.png",
    ]
    assert resp["baselinePriceRange"]["low"] >= 5_000
    assert resp["deltaDirection"] == "up"
    assert resp["deltaPriceRange"]["high"] > 0


def test_estimate_pricing_refinement_applies_delta_floor_for_material_changes(monkeypatch) -> None:
    def _fake_build_context(_payload):
        return {
            "services_summary": "Landscape design and backyard renovation service.",
            "industry": "Home services",
            "service": "Landscape remodel",
        }

    def _fake_vlm(_payload, *, preview_image_url, calibration):
        assert preview_image_url == "https://example.com/after-yard.png"
        assert calibration.key == "landscape_design"
        return {"rangeLow": 25_000, "rangeHigh": 27_000, "basis": "ai_v2", "confidence": "high"}

    monkeypatch.setattr(orchestrator, "build_context", _fake_build_context)
    monkeypatch.setattr(orchestrator, "estimate_pricing_with_vlm", _fake_vlm)

    resp = orchestrator.estimate_pricing(
        {
            "previewImageUrl": "https://example.com/after-yard.png",
            "baselinePriceRange": {"low": 20_000, "high": 22_000},
            "pricingScenario": "refinement",
            "changedRefinementKeys": [
                {"key": "step-yard-bushes", "label": "Added bushes"},
                {"key": "step-patio-finish", "label": "Upgraded patio tile and pavers"},
            ],
        }
    )

    assert resp["ok"] is True
    assert resp["deltaDirection"] == "up"
    assert {driver["key"] for driver in resp["priceDrivers"]} >= {"planting_density", "hardscape"}
    delta = resp["deltaPriceRange"]
    assert ((delta["low"] + delta["high"]) / 2) >= 12_000
