from __future__ import annotations

import re
import time
from typing import Any, Dict, Iterable, List, Optional, Tuple

from programs.form_pipeline.context_builder import build_context
from programs.pricing.replicate_vlm import estimate_pricing_with_vlm
from programs.pricing.service_calibration import (
    PriceRange,
    ServiceCalibration,
    calibration_response_payload,
    match_service_calibration,
    resolve_budget_tier,
)


_CURRENCY_RE = re.compile(r"(?i)\b(usd|cad|aud|gbp|eur)\b")

_DRIVER_DEFINITIONS: dict[str, dict[str, object]] = {
    "hardscape": {
        "label": "Hardscape",
        "tokens": ("hardscape", "paver", "patio", "walkway", "masonry", "retaining wall"),
        "delta_floor": 8_000,
    },
    "tile": {
        "label": "Tile",
        "tokens": ("tile", "backsplash", "shower wall", "shower tile", "terrazzo"),
        "delta_floor": 4_500,
    },
    "cabinetry": {
        "label": "Cabinetry",
        "tokens": ("cabinet", "cabinetry", "vanity", "built-in", "millwork"),
        "delta_floor": 7_000,
    },
    "fixtures": {
        "label": "Fixtures",
        "tokens": ("fixture", "faucet", "hardware", "sink", "toilet", "tub", "shower", "mirror", "towel"),
        "delta_floor": 3_000,
    },
    "planting_density": {
        "label": "Planting density",
        "tokens": ("plant", "plants", "bush", "bushes", "shrub", "tree", "garden", "flower", "sod"),
        "delta_floor": 4_000,
    },
    "lighting": {
        "label": "Lighting",
        "tokens": ("light", "lighting", "pendant", "sconce", "recessed", "landscape lighting"),
        "delta_floor": 2_500,
    },
    "layout": {
        "label": "Layout",
        "tokens": ("layout", "reconfigure", "move", "relocate", "expand", "open up", "island"),
        "delta_floor": 10_000,
    },
    "finish_level": {
        "label": "Finish level",
        "tokens": ("finish", "finishes", "material", "materials", "premium", "luxury", "budget"),
        "delta_floor": 4_000,
    },
    "materials": {
        "label": "Materials",
        "tokens": ("countertop", "stone", "marble", "quartz", "wood", "flooring", "surface"),
        "delta_floor": 3_500,
    },
    "labor": {
        "label": "Labor",
        "tokens": ("labor", "installation", "install", "demolition"),
        "delta_floor": 2_500,
    },
    "scope": {
        "label": "Project scope",
        "tokens": ("scope", "full", "complete", "entire", "major"),
        "delta_floor": 3_000,
    },
    "equipment": {
        "label": "Equipment",
        "tokens": ("equipment", "unit", "system", "appliance"),
        "delta_floor": 3_000,
    },
}

_TIER_ORDER = ("starter", "standard", "premium", "luxury")


def _get_preview_image_url(payload: Dict[str, Any]) -> Optional[str]:
    url = (
        payload.get("previewImageUrl")
        or payload.get("preview_image_url")
        or payload.get("imageUrl")
        or payload.get("image_url")
    )
    if isinstance(url, str) and url.strip():
        u = url.strip()
        if u.startswith("http://") or u.startswith("https://"):
            return u
    return None


def _get_baseline_image_url(payload: Dict[str, Any]) -> Optional[str]:
    url = payload.get("baselineImageUrl") or payload.get("baseline_image_url")
    if isinstance(url, str) and url.strip():
        u = url.strip()
        if u.startswith("http://") or u.startswith("https://"):
            return u
    return None


def _parse_money_token(raw: str) -> Optional[int]:
    t = str(raw or "").strip().lower()
    if not t:
        return None
    t = t.replace(",", "")
    t = t.replace("$", "")

    m = re.match(r"^([0-9]+(?:\.[0-9]+)?)\s*k$", t)
    if m:
        try:
            return int(float(m.group(1)) * 1000)
        except Exception:
            return None

    m = re.match(r"^([0-9]+(?:\.[0-9]+)?)$", t)
    if m:
        try:
            return int(float(m.group(1)))
        except Exception:
            return None
    return None


def _extract_money_range(value: Any) -> Tuple[Optional[int], Optional[int]]:
    if value is None:
        return None, None
    if isinstance(value, (int, float)):
        v = int(value)
        return (v, v) if v > 0 else (None, None)
    if isinstance(value, dict):
        for a, b in (("min", "max"), ("low", "high"), ("rangeLow", "rangeHigh"), ("range_low", "range_high")):
            lo = _extract_money_range(value.get(a))[0]
            hi = _extract_money_range(value.get(b))[1]
            if lo or hi:
                return lo, hi
        return _extract_money_range(value.get("value"))
    if isinstance(value, list) and value:
        for item in value[:3]:
            lo, hi = _extract_money_range(item)
            if lo or hi:
                return lo, hi
        return None, None

    s_norm = str(value).replace(",", "")
    toks = re.findall(r"\$?\s*\d+(?:\.\d+)?\s*k?\b", s_norm, flags=re.IGNORECASE)
    vals: List[int] = []
    for tok in toks[:4]:
        v = _parse_money_token(tok)
        if isinstance(v, int) and v > 0:
            vals.append(v)
    if not vals:
        return None, None
    vals = sorted(vals)
    return (vals[0], vals[-1]) if len(vals) > 1 else (vals[0], vals[0])


def _extract_budget_hint(step_data: Dict[str, Any]) -> Tuple[Optional[int], Optional[int]]:
    if not isinstance(step_data, dict):
        return None, None
    for k in list(step_data.keys()):
        key = str(k or "").strip().lower()
        if not key:
            continue
        if "budget" in key or "price" in key or "cost" in key:
            lo, hi = _extract_money_range(step_data.get(k))
            if lo or hi:
                return lo, hi
    return None, None


def _extract_int(value: Any) -> Optional[int]:
    if value is None or isinstance(value, bool):
        return None
    if isinstance(value, int):
        return value if value > 0 else None
    if isinstance(value, float):
        return int(value) if value > 0 else None
    if isinstance(value, dict):
        return _extract_int(value.get("value"))
    if isinstance(value, list) and value:
        for item in value[:3]:
            v = _extract_int(item)
            if v:
                return v
    m = re.search(r"(\d{1,7})", str(value or "").strip().lower())
    if not m:
        return None
    try:
        n = int(m.group(1))
    except Exception:
        return None
    return n if n > 0 else None


def _extract_quantity_hints(step_data: Dict[str, Any]) -> Dict[str, int]:
    if not isinstance(step_data, dict):
        return {}
    hints: Dict[str, int] = {}
    for k, v in step_data.items():
        key = str(k or "").strip().lower()
        if not key:
            continue
        if key in {"sqft", "squarefeet", "square_feet", "squarefootage", "square_footage", "area"}:
            n = _extract_int(v)
            if n:
                hints["sqft"] = n
        elif key in {"rooms", "room_count", "bedrooms", "bathrooms"}:
            n = _extract_int(v)
            if n:
                hints[key] = n
    return hints


def _detect_currency(payload: Dict[str, Any]) -> str:
    raw = payload.get("currency") or payload.get("Currency")
    if isinstance(raw, str) and raw.strip():
        return raw.strip().upper()[:8]
    for k in ("serviceSummary", "service_summary", "companySummary", "company_summary"):
        v = payload.get(k)
        if isinstance(v, str):
            m = _CURRENCY_RE.search(v)
            if m:
                return m.group(1).upper()
    return "USD"


def _multiplier_from_text(text: str) -> float:
    t = (text or "").lower()
    mult = 1.0
    if any(w in t for w in ("luxury", "high end", "high-end", "premium", "custom", "designer")):
        mult *= 1.25
    if any(w in t for w in ("budget", "basic", "affordable", "cheap", "builder-grade")):
        mult *= 0.85
    if any(w in t for w in ("full", "complete", "gut", "total", "entire")):
        mult *= 1.15
    if any(w in t for w in ("partial", "refresh", "touch up", "touch-up", "minor")):
        mult *= 0.9
    return max(0.65, min(1.9, mult))


def _normalize_range(lo: int, hi: int) -> PriceRange:
    return PriceRange(low=min(int(lo), int(hi)), high=max(int(lo), int(hi)))


def _clamp_int(value: int, low: int, high: int) -> int:
    return max(low, min(high, int(value)))


def _build_visible_range(midpoint: int, calibration: ServiceCalibration) -> PriceRange:
    service_range = calibration.normalized_service_range()
    band_clamp = calibration.normalized_visible_band_clamp()
    service_span = max(1, service_range.high - service_range.low)
    width = int(round(service_span * 0.1))
    width = max(band_clamp.low, min(band_clamp.high, width))
    width = max(1_000, min(width, service_span))
    mid = _clamp_int(midpoint, service_range.low, service_range.high)
    low = int(round(mid - width / 2.0))
    high = int(round(mid + width / 2.0))
    if low < service_range.low:
        shift = service_range.low - low
        low += shift
        high += shift
    if high > service_range.high:
        shift = high - service_range.high
        low -= shift
        high -= shift
    low = max(service_range.low, low)
    high = min(service_range.high, high)
    if high <= low:
        high = min(service_range.high, low + max(1_000, band_clamp.low))
        if high <= low:
            low = max(service_range.low, high - 1_000)
    return _normalize_range(low, high)


def _range_midpoint(price_range: PriceRange) -> int:
    return price_range.midpoint()


def _align_midpoint_to_budget(
    *,
    raw_midpoint: int,
    calibration: ServiceCalibration,
    budget_value: Optional[int],
) -> int:
    if not isinstance(budget_value, int) or budget_value <= 0:
        return raw_midpoint
    service_range = calibration.normalized_service_range()
    clamped_budget = _clamp_int(budget_value, service_range.low, service_range.high)
    blended = int(round((raw_midpoint * 0.35) + (clamped_budget * 0.65)))
    return _clamp_int(blended, service_range.low, service_range.high)


def _starter_floor_midpoint(calibration: ServiceCalibration) -> int:
    return calibration.normalized_starter_baseline().midpoint()


def _internal_starter_baseline(calibration: ServiceCalibration) -> PriceRange:
    return calibration.normalized_starter_baseline()


def _coerce_pricing_scenario(payload: Dict[str, Any], *, has_visible_baseline: bool) -> str:
    raw = str(payload.get("pricingScenario") or payload.get("pricing_scenario") or "").strip().lower()
    if raw in {"initial", "comparison", "refinement"}:
        return raw
    return "comparison" if has_visible_baseline else "initial"


def _coerce_baseline_price_range(payload: Dict[str, Any]) -> Optional[PriceRange]:
    raw = payload.get("baselinePriceRange") or payload.get("baseline_price_range")
    lo, hi = _extract_money_range(raw)
    if not isinstance(lo, int) or not isinstance(hi, int) or lo <= 0 or hi <= 0:
        return None
    return _normalize_range(lo, hi)


def _coerce_changed_refinement_keys(payload: Dict[str, Any]) -> list[dict[str, str]]:
    raw = payload.get("changedRefinementKeys") or payload.get("changed_refinement_keys")
    if not isinstance(raw, list):
        return []
    out: list[dict[str, str]] = []
    for item in raw:
        if isinstance(item, str):
            key = item.strip()
            label = key.replace("_", " ").replace("-", " ").strip().title()
        elif isinstance(item, dict):
            key = str(item.get("key") or item.get("id") or item.get("value") or "").strip()
            label = str(item.get("label") or item.get("name") or key).strip()
        else:
            continue
        if not key:
            continue
        out.append({"key": key[:80], "label": (label or key)[:120]})
    return out[:10]


def _driver_key_for_text(text: str) -> Optional[str]:
    haystack = str(text or "").lower()
    for key, meta in _DRIVER_DEFINITIONS.items():
        tokens = meta.get("tokens") or ()
        if any(token in haystack for token in tokens):
            return key
    return None


def _build_price_drivers(
    *,
    calibration: ServiceCalibration,
    changed_refinement_keys: list[dict[str, str]],
    budget_tier_shift: bool,
) -> list[dict[str, str]]:
    drivers: list[dict[str, str]] = []
    seen: set[str] = set()

    def _push(driver_key: str) -> None:
        if not driver_key or driver_key in seen:
            return
        meta = _DRIVER_DEFINITIONS.get(driver_key) or {}
        label = str(meta.get("label") or driver_key.replace("_", " ").title()).strip()
        seen.add(driver_key)
        drivers.append({"key": driver_key, "label": label})

    for item in changed_refinement_keys:
        matched = _driver_key_for_text(f"{item.get('key', '')} {item.get('label', '')}")
        if matched:
            _push(matched)

    if budget_tier_shift:
        _push("finish_level")

    if not drivers:
        for default_driver in calibration.default_price_drivers:
            matched = _driver_key_for_text(default_driver) or default_driver.replace(" ", "_")
            _push(matched)
            if len(drivers) >= 3:
                break

    return drivers[:3]


def _delta_floor_for_drivers(calibration: ServiceCalibration, drivers: Iterable[dict[str, str]]) -> int:
    service_range = calibration.normalized_service_range()
    service_span = max(1, service_range.high - service_range.low)
    floor = 0
    for driver in drivers:
        driver_key = str(driver.get("key") or "").strip()
        meta = _DRIVER_DEFINITIONS.get(driver_key) or {}
        floor += int(meta.get("delta_floor") or 2_500)
    if floor <= 0:
        floor = 2_500
    return min(floor, max(5_000, int(service_span * 0.4)))


def _tier_index(tier: str) -> int:
    try:
        return _TIER_ORDER.index(str(tier or "").strip().lower())
    except ValueError:
        return -1


def _compute_delta_range(
    *,
    current_range: PriceRange,
    baseline_range: PriceRange,
    calibration: ServiceCalibration,
    drivers: list[dict[str, str]],
    current_budget_tier: str,
    baseline_budget_tier: str,
) -> Tuple[Optional[PriceRange], Optional[str]]:
    raw_low = current_range.low - baseline_range.high
    raw_high = current_range.high - baseline_range.low
    delta_range = _normalize_range(raw_low, raw_high)
    delta_mid = _range_midpoint(delta_range)
    direction = "flat"
    if delta_mid > 750:
        direction = "up"
    elif delta_mid < -750:
        direction = "down"

    tier_shift = _tier_index(current_budget_tier) - _tier_index(baseline_budget_tier)
    if direction == "flat" and tier_shift > 0:
        direction = "up"
    elif direction == "flat" and tier_shift < 0:
        direction = "down"

    if direction != "flat" and drivers:
        target_abs_mid = max(abs(delta_mid), _delta_floor_for_drivers(calibration, drivers))
        signed_mid = target_abs_mid if direction == "up" else -target_abs_mid
        width = max(1_500, min(calibration.normalized_visible_band_clamp().low, 4_000))
        delta_range = _normalize_range(int(round(signed_mid - width / 2.0)), int(round(signed_mid + width / 2.0)))

    if delta_range.low == 0 and delta_range.high == 0:
        return None, None
    return delta_range, direction


def _estimate_heuristic_range(
    *,
    basis_text: str,
    calibration: ServiceCalibration,
    budget_value: Optional[int],
    quantity_hints: Dict[str, int],
    apply_starter_floor: bool,
) -> PriceRange:
    if isinstance(budget_value, int) and budget_value > 0:
        center = budget_value
    else:
        center = _starter_floor_midpoint(calibration)

    mult = _multiplier_from_text(basis_text)
    if isinstance(quantity_hints.get("sqft"), int):
        sqft = int(quantity_hints["sqft"])
        mult *= max(0.8, min(2.8, sqft / 700.0))
    elif isinstance(quantity_hints.get("rooms"), int):
        rooms = int(quantity_hints["rooms"])
        mult *= max(0.85, min(1.8, rooms / 3.0))

    center = int(round(center * mult))
    center = _clamp_int(center, calibration.normalized_service_range().low, calibration.normalized_service_range().high)
    if apply_starter_floor:
        center = max(center, _starter_floor_midpoint(calibration))
    return _build_visible_range(center, calibration)


def _estimate_current_range(
    *,
    payload: Dict[str, Any],
    calibration: ServiceCalibration,
    preview_url: Optional[str],
    budget_value: Optional[int],
    basis_text: str,
    quantity_hints: Dict[str, int],
    apply_starter_floor: bool,
) -> tuple[PriceRange, str, str]:
    if preview_url:
        try:
            vlm_result = estimate_pricing_with_vlm(payload, preview_image_url=preview_url, calibration=calibration)
            raw_range = _normalize_range(int(vlm_result["rangeLow"]), int(vlm_result["rangeHigh"]))
            midpoint = _range_midpoint(raw_range)
            if apply_starter_floor:
                midpoint = max(midpoint, _starter_floor_midpoint(calibration))
            midpoint = _align_midpoint_to_budget(
                raw_midpoint=midpoint,
                calibration=calibration,
                budget_value=budget_value,
            )
            return _build_visible_range(midpoint, calibration), str(vlm_result.get("basis") or "ai_v2"), str(
                vlm_result.get("confidence") or "medium"
            )
        except Exception:
            pass

    return (
        _estimate_heuristic_range(
            basis_text=basis_text,
            calibration=calibration,
            budget_value=budget_value,
            quantity_hints=quantity_hints,
            apply_starter_floor=apply_starter_floor,
        ),
        "heuristic_v2",
        "medium" if budget_value or quantity_hints else "low",
    )


def estimate_pricing(payload: Dict[str, Any]) -> Dict[str, Any]:
    request_id = f"pricing_{int(time.time() * 1000)}"
    preview_url = _get_preview_image_url(payload)
    baseline_image_url = _get_baseline_image_url(payload)
    baseline_price_range = _coerce_baseline_price_range(payload)
    changed_refinement_keys = _coerce_changed_refinement_keys(payload)

    ctx = build_context(payload)
    services_summary = str(ctx.get("services_summary") or ctx.get("service_summary") or "").strip()
    industry = str(ctx.get("industry") or "").strip()
    service = str(ctx.get("service") or "").strip()
    basis_text = " ".join([services_summary, industry, service]).strip()
    if not basis_text:
        return {
            "ok": False,
            "error": "Missing service context (provide serviceSummary/service_summary or industry/service).",
            "requestId": request_id,
        }

    calibration = match_service_calibration(basis_text)
    calibration_payload = calibration_response_payload(calibration)
    currency = _detect_currency(payload)

    step_data_raw = payload.get("stepDataSoFar") or payload.get("step_data_so_far") or {}
    step_data = step_data_raw if isinstance(step_data_raw, dict) else {}
    budget_lo, budget_hi = _extract_budget_hint(step_data)
    top_level_budget = _extract_int(payload.get("budgetRange") or payload.get("budget_range") or payload.get("budget"))
    budget_value = top_level_budget
    if not isinstance(budget_value, int) or budget_value <= 0:
        if isinstance(budget_hi, int) and budget_hi > 0:
            budget_value = budget_hi
        elif isinstance(budget_lo, int) and budget_lo > 0:
            budget_value = budget_lo
        else:
            budget_value = None

    scenario = _coerce_pricing_scenario(
        payload,
        has_visible_baseline=bool(baseline_price_range or baseline_image_url),
    )
    quantity_hints = _extract_quantity_hints(step_data)

    current_range, basis, confidence = _estimate_current_range(
        payload=payload,
        calibration=calibration,
        preview_url=preview_url,
        budget_value=budget_value,
        basis_text=basis_text,
        quantity_hints=quantity_hints,
        apply_starter_floor=True,
    )

    current_budget_tier = resolve_budget_tier(calibration, budget_value or _range_midpoint(current_range))
    visible_baseline_range: Optional[PriceRange] = None
    baseline_budget_tier = resolve_budget_tier(calibration, _internal_starter_baseline(calibration).midpoint())
    baseline_source = None

    if baseline_price_range is not None:
        visible_baseline_range = baseline_price_range
        baseline_budget_tier = resolve_budget_tier(calibration, _range_midpoint(visible_baseline_range))
        baseline_source = "provided_price_range"
    elif baseline_image_url:
        visible_baseline_range, baseline_basis, baseline_confidence = _estimate_current_range(
            payload={**payload, "previewImageUrl": baseline_image_url},
            calibration=calibration,
            preview_url=baseline_image_url,
            budget_value=None,
            basis_text=basis_text,
            quantity_hints=quantity_hints,
            apply_starter_floor=False,
        )
        baseline_budget_tier = resolve_budget_tier(calibration, _range_midpoint(visible_baseline_range))
        baseline_source = "baseline_image"
        if basis.startswith("heuristic") and baseline_basis.startswith("ai"):
            basis = baseline_basis
            confidence = baseline_confidence

    budget_tier_shift = visible_baseline_range is not None and baseline_budget_tier != current_budget_tier
    price_drivers = _build_price_drivers(
        calibration=calibration,
        changed_refinement_keys=changed_refinement_keys,
        budget_tier_shift=budget_tier_shift,
    )

    response: Dict[str, Any] = {
        "ok": True,
        "requestId": request_id,
        "currency": currency,
        "rangeLow": current_range.low,
        "rangeHigh": current_range.high,
        "imagePriceRange": current_range.to_dict(),
        "servicePriceRange": calibration_payload["servicePriceRange"],
        "confidence": confidence,
        "basis": basis,
        "budgetTier": current_budget_tier,
        "budgetTierRanges": calibration_payload["budgetTierRanges"],
        "priceDrivers": price_drivers,
        "calibrationKey": calibration.key,
        "notes": [
            "Backend-authored pricing band.",
            f"Matched calibration: {calibration.key}.",
        ],
    }

    if visible_baseline_range is not None and scenario in {"comparison", "refinement"}:
        delta_range, delta_direction = _compute_delta_range(
            current_range=current_range,
            baseline_range=visible_baseline_range,
            calibration=calibration,
            drivers=price_drivers,
            current_budget_tier=current_budget_tier,
            baseline_budget_tier=baseline_budget_tier,
        )
        response["baselinePriceRange"] = visible_baseline_range.to_dict()
        if delta_range is not None and delta_direction:
            response["deltaPriceRange"] = delta_range.to_dict()
            response["deltaDirection"] = delta_direction
        if baseline_source:
            response["notes"].append(f"Baseline source: {baseline_source}.")
    else:
        response["notes"].append("No visible baseline for upgrade delta.")

    if budget_value:
        response["notes"].append("Budget input used to place the estimate within service tiers.")
    if quantity_hints:
        response["notes"].append("Size/quantity hints used in fallback calibration.")

    return response
