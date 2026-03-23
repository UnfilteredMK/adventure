from __future__ import annotations

from dataclasses import dataclass
from typing import Dict, Iterable, Literal, Optional


BudgetTier = Literal["starter", "standard", "premium", "luxury"]


@dataclass(frozen=True)
class PriceRange:
    low: int
    high: int

    def normalized(self) -> "PriceRange":
        return PriceRange(low=min(int(self.low), int(self.high)), high=max(int(self.low), int(self.high)))

    def midpoint(self) -> int:
        rng = self.normalized()
        return int(round((rng.low + rng.high) / 2.0))

    def to_dict(self) -> dict[str, int]:
        rng = self.normalized()
        return {"low": rng.low, "high": rng.high}


@dataclass(frozen=True)
class ServiceCalibration:
    key: str
    hints: tuple[str, ...]
    service_price_range: PriceRange
    visible_band_clamp: PriceRange
    starter_baseline: PriceRange
    tier_ranges: dict[BudgetTier, PriceRange]
    default_price_drivers: tuple[str, ...]

    def normalized_service_range(self) -> PriceRange:
        return self.service_price_range.normalized()

    def normalized_visible_band_clamp(self) -> PriceRange:
        return self.visible_band_clamp.normalized()

    def normalized_starter_baseline(self) -> PriceRange:
        return self.starter_baseline.normalized()

    def normalized_tier_ranges(self) -> dict[BudgetTier, PriceRange]:
        return {key: value.normalized() for key, value in self.tier_ranges.items()}

    def budget_tier_ranges_dict(self) -> dict[str, dict[str, int]]:
        return {key: value.to_dict() for key, value in self.normalized_tier_ranges().items()}


DEFAULT_SERVICE_CALIBRATION = ServiceCalibration(
    key="general_service",
    hints=(),
    service_price_range=PriceRange(2_000, 100_000),
    visible_band_clamp=PriceRange(2_000, 12_000),
    starter_baseline=PriceRange(4_000, 9_000),
    tier_ranges={
        "starter": PriceRange(2_000, 12_000),
        "standard": PriceRange(12_000, 30_000),
        "premium": PriceRange(30_000, 60_000),
        "luxury": PriceRange(60_000, 100_000),
    },
    default_price_drivers=("materials", "labor", "scope"),
)


SERVICE_CALIBRATIONS: tuple[ServiceCalibration, ...] = (
    ServiceCalibration(
        key="bathroom_remodel",
        hints=("bathroom", "bath", "primary bath", "guest bath", "powder room"),
        service_price_range=PriceRange(5_000, 150_000),
        visible_band_clamp=PriceRange(3_000, 12_000),
        starter_baseline=PriceRange(8_000, 15_000),
        tier_ranges={
            "starter": PriceRange(5_000, 15_000),
            "standard": PriceRange(15_000, 35_000),
            "premium": PriceRange(35_000, 70_000),
            "luxury": PriceRange(70_000, 150_000),
        },
        default_price_drivers=("tile", "cabinetry", "fixtures"),
    ),
    ServiceCalibration(
        key="kitchen_remodel",
        hints=("kitchen",),
        service_price_range=PriceRange(10_000, 250_000),
        visible_band_clamp=PriceRange(4_000, 15_000),
        starter_baseline=PriceRange(15_000, 25_000),
        tier_ranges={
            "starter": PriceRange(10_000, 25_000),
            "standard": PriceRange(25_000, 60_000),
            "premium": PriceRange(60_000, 120_000),
            "luxury": PriceRange(120_000, 250_000),
        },
        default_price_drivers=("cabinetry", "layout", "fixtures"),
    ),
    ServiceCalibration(
        key="landscape_design",
        hints=("landscape", "landscaping", "yard", "garden", "backyard", "front yard", "outdoor"),
        service_price_range=PriceRange(5_000, 175_000),
        visible_band_clamp=PriceRange(3_000, 15_000),
        starter_baseline=PriceRange(6_000, 14_000),
        tier_ranges={
            "starter": PriceRange(5_000, 15_000),
            "standard": PriceRange(15_000, 45_000),
            "premium": PriceRange(45_000, 90_000),
            "luxury": PriceRange(90_000, 175_000),
        },
        default_price_drivers=("hardscape", "planting density", "lighting"),
    ),
    ServiceCalibration(
        key="pool_build",
        hints=("pool", "spa"),
        service_price_range=PriceRange(15_000, 200_000),
        visible_band_clamp=PriceRange(5_000, 18_000),
        starter_baseline=PriceRange(25_000, 45_000),
        tier_ranges={
            "starter": PriceRange(15_000, 40_000),
            "standard": PriceRange(40_000, 75_000),
            "premium": PriceRange(75_000, 130_000),
            "luxury": PriceRange(130_000, 200_000),
        },
        default_price_drivers=("layout", "materials", "lighting"),
    ),
    ServiceCalibration(
        key="deck_patio",
        hints=("deck", "patio", "pergola"),
        service_price_range=PriceRange(5_000, 60_000),
        visible_band_clamp=PriceRange(2_500, 10_000),
        starter_baseline=PriceRange(7_000, 14_000),
        tier_ranges={
            "starter": PriceRange(5_000, 12_000),
            "standard": PriceRange(12_000, 25_000),
            "premium": PriceRange(25_000, 40_000),
            "luxury": PriceRange(40_000, 60_000),
        },
        default_price_drivers=("hardscape", "materials", "lighting"),
    ),
    ServiceCalibration(
        key="roofing",
        hints=("roof", "roofing"),
        service_price_range=PriceRange(5_000, 50_000),
        visible_band_clamp=PriceRange(2_500, 8_000),
        starter_baseline=PriceRange(7_000, 12_000),
        tier_ranges={
            "starter": PriceRange(5_000, 10_000),
            "standard": PriceRange(10_000, 18_000),
            "premium": PriceRange(18_000, 30_000),
            "luxury": PriceRange(30_000, 50_000),
        },
        default_price_drivers=("materials", "labor", "scope"),
    ),
    ServiceCalibration(
        key="hvac",
        hints=("hvac", "air conditioning", "air conditioner", "furnace", "heating", "cooling"),
        service_price_range=PriceRange(3_000, 25_000),
        visible_band_clamp=PriceRange(2_000, 6_000),
        starter_baseline=PriceRange(4_000, 8_000),
        tier_ranges={
            "starter": PriceRange(3_000, 6_000),
            "standard": PriceRange(6_000, 10_000),
            "premium": PriceRange(10_000, 16_000),
            "luxury": PriceRange(16_000, 25_000),
        },
        default_price_drivers=("equipment", "labor", "scope"),
    ),
    ServiceCalibration(
        key="flooring",
        hints=("floor", "flooring", "hardwood", "tile floor", "lvp", "laminate"),
        service_price_range=PriceRange(2_000, 50_000),
        visible_band_clamp=PriceRange(2_000, 8_000),
        starter_baseline=PriceRange(4_000, 8_000),
        tier_ranges={
            "starter": PriceRange(2_000, 7_000),
            "standard": PriceRange(7_000, 15_000),
            "premium": PriceRange(15_000, 30_000),
            "luxury": PriceRange(30_000, 50_000),
        },
        default_price_drivers=("materials", "layout", "labor"),
    ),
    ServiceCalibration(
        key="painting",
        hints=("paint", "painting"),
        service_price_range=PriceRange(1_000, 25_000),
        visible_band_clamp=PriceRange(2_000, 5_000),
        starter_baseline=PriceRange(2_000, 5_000),
        tier_ranges={
            "starter": PriceRange(1_000, 3_000),
            "standard": PriceRange(3_000, 7_000),
            "premium": PriceRange(7_000, 14_000),
            "luxury": PriceRange(14_000, 25_000),
        },
        default_price_drivers=("materials", "labor", "scope"),
    ),
    ServiceCalibration(
        key="windows_siding",
        hints=("window", "windows", "siding"),
        service_price_range=PriceRange(4_000, 85_000),
        visible_band_clamp=PriceRange(2_500, 10_000),
        starter_baseline=PriceRange(6_000, 12_000),
        tier_ranges={
            "starter": PriceRange(4_000, 12_000),
            "standard": PriceRange(12_000, 25_000),
            "premium": PriceRange(25_000, 45_000),
            "luxury": PriceRange(45_000, 85_000),
        },
        default_price_drivers=("materials", "scope", "labor"),
    ),
    ServiceCalibration(
        key="generic_remodel",
        hints=("remodel", "renovation"),
        service_price_range=PriceRange(5_000, 150_000),
        visible_band_clamp=PriceRange(3_000, 12_000),
        starter_baseline=PriceRange(8_000, 16_000),
        tier_ranges={
            "starter": PriceRange(5_000, 15_000),
            "standard": PriceRange(15_000, 35_000),
            "premium": PriceRange(35_000, 70_000),
            "luxury": PriceRange(70_000, 150_000),
        },
        default_price_drivers=("materials", "fixtures", "layout"),
    ),
)


def iter_calibrations() -> Iterable[ServiceCalibration]:
    yield from SERVICE_CALIBRATIONS


def match_service_calibration(text: str) -> ServiceCalibration:
    haystack = str(text or "").lower()
    if not haystack.strip():
        return DEFAULT_SERVICE_CALIBRATION
    best: Optional[tuple[int, int, ServiceCalibration]] = None
    for idx, calibration in enumerate(SERVICE_CALIBRATIONS):
        score = sum(1 for hint in calibration.hints if hint and hint in haystack)
        if score <= 0:
            continue
        candidate = (score, -idx, calibration)
        if best is None or candidate > best:
            best = candidate
    return best[2] if best else DEFAULT_SERVICE_CALIBRATION


def resolve_budget_tier(calibration: ServiceCalibration, budget_value: Optional[int]) -> BudgetTier:
    tier_ranges = calibration.normalized_tier_ranges()
    if not isinstance(budget_value, int) or budget_value <= 0:
        return "starter"
    for tier in ("starter", "standard", "premium", "luxury"):
        bounds = tier_ranges[tier]
        if budget_value <= bounds.high:
            return tier
    return "luxury"


def tier_range_for_budget(calibration: ServiceCalibration, budget_value: Optional[int]) -> PriceRange:
    return calibration.normalized_tier_ranges()[resolve_budget_tier(calibration, budget_value)]


def calibration_response_payload(calibration: ServiceCalibration) -> Dict[str, object]:
    return {
        "calibrationKey": calibration.key,
        "servicePriceRange": calibration.normalized_service_range().to_dict(),
        "visibleBandClamp": calibration.normalized_visible_band_clamp().to_dict(),
        "starterBaseline": calibration.normalized_starter_baseline().to_dict(),
        "budgetTierRanges": calibration.budget_tier_ranges_dict(),
    }


__all__ = [
    "BudgetTier",
    "DEFAULT_SERVICE_CALIBRATION",
    "PriceRange",
    "ServiceCalibration",
    "SERVICE_CALIBRATIONS",
    "calibration_response_payload",
    "match_service_calibration",
    "resolve_budget_tier",
    "tier_range_for_budget",
]
