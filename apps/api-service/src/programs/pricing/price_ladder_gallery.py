from __future__ import annotations

import os
import re
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import dataclass
from typing import Any, Dict, List, Optional

from programs.common.visual_text_safety import ANTI_COMPARISON_NEGATIVE_TERMS, ANTI_TEXT_OVERLAY_NEGATIVE_TERMS
from programs.form_pipeline.context_builder import build_context
from programs.image_generator.providers.image_generation import generate_images
from programs.image_generator.request_context import extract_reference_images
from programs.pricing.orchestrator import estimate_pricing
from programs.pricing.service_calibration import (
    PriceRange,
    calibration_response_payload,
    match_service_calibration,
    resolve_budget_tier,
)


_CURRENCY_RE = re.compile(r"(?i)\b(usd|cad|aud|gbp|eur)\b")
_MONEY_RE = re.compile(r"(\d+(?:\.\d+)?)\s*k?\b", re.IGNORECASE)
_REALISM_NEGATIVE_TERMS = (
    f"{ANTI_TEXT_OVERLAY_NEGATIVE_TERMS}, {ANTI_COMPARISON_NEGATIVE_TERMS}, "
    "cgi, 3d render, rendering, synthetic, artificial, fake-looking, toy-like, dollhouse, plastic surfaces, "
    "waxy finish, uncanny symmetry, exaggerated hdr, overprocessed, airbrushed, glossy fake reflections, "
    "impossible geometry, warped lines, floating objects, duplicate fixtures, malformed architecture"
)


@dataclass(frozen=True)
class VariantSlot:
    slot_id: str
    label: str
    summary: str
    material_level: str
    lighting_style: str
    detail_level: str
    layout_variation: str
    price_position: float
    span_ratio: float

    def controls(self) -> dict[str, str]:
        return {
            "materialLevel": self.material_level,
            "lightingStyle": self.lighting_style,
            "detailLevel": self.detail_level,
            "layoutVariation": self.layout_variation,
        }


VARIANT_SLOTS: tuple[VariantSlot, ...] = (
    VariantSlot(
        slot_id="safe_base",
        label="Safe Base",
        summary="closest to the chosen style direction, clean, neutral, broadly appealing",
        material_level="solid mid-range finishes with practical fixtures and restrained upgrades",
        lighting_style="balanced daylight with clean, even exposure",
        detail_level="moderate detail, edited and professional without over-layering",
        layout_variation="stay closest to the reference composition with only slight focal shifts",
        price_position=0.18,
        span_ratio=0.12,
    ),
    VariantSlot(
        slot_id="bright_airy",
        label="Bright & Airy",
        summary="lighter palette, higher brightness, more open and spacious feel",
        material_level="mid-range finishes with lighter surfaces and crisp painted elements",
        lighting_style="high-key natural light, soft white balance, airy openness",
        detail_level="moderate detail with a cleaner, lighter finish mix",
        layout_variation="slightly open up spacing, simplify the visual center, vary mirror or focal geometry",
        price_position=0.24,
        span_ratio=0.12,
    ),
    VariantSlot(
        slot_id="warm_cozy",
        label="Warm & Cozy",
        summary="warmer lighting, softer materials, more inviting and residential",
        material_level="mid-range finishes with warmer woods, textured surfaces, and softer materials",
        lighting_style="warm layered light, gentle shadows, inviting tone",
        detail_level="moderate detail with tactile, residential warmth",
        layout_variation="shift emphasis toward comfort and intimacy with a subtly different focal arrangement",
        price_position=0.30,
        span_ratio=0.13,
    ),
    VariantSlot(
        slot_id="budget_basic",
        label="Budget Basic",
        summary="simpler execution, fewer premium materials, lower cost but still attractive",
        material_level="builder-grade or budget-conscious finishes, stock components, simpler material palette",
        lighting_style="straightforward realistic lighting with minimal drama",
        detail_level="minimal detailing and simpler trim, hardware, and finish layering",
        layout_variation="use the most straightforward configuration with fewer built-in or custom-looking moves",
        price_position=0.10,
        span_ratio=0.11,
    ),
    VariantSlot(
        slot_id="balanced_mid",
        label="Balanced Mid",
        summary="the most realistic common outcome, what many customers actually choose",
        material_level="strong mid-range materials, polished but practical finish package",
        lighting_style="balanced natural and architectural light",
        detail_level="moderate detail and believable contractor-grade polish",
        layout_variation="show a realistic everyday layout with a slightly different emphasis than the safe base",
        price_position=0.40,
        span_ratio=0.13,
    ),
    VariantSlot(
        slot_id="upgrade_mid",
        label="Upgrade Mid",
        summary="slightly nicer than average, more polish and better materials",
        material_level="upper mid-range finishes with noticeable upgrades in key surfaces and fixtures",
        lighting_style="clean flattering light with more intentional contrast",
        detail_level="noticeably more detail and finish layering than balanced mid",
        layout_variation="introduce a clearer hero feature or upgraded focal element while staying believable",
        price_position=0.52,
        span_ratio=0.14,
    ),
    VariantSlot(
        slot_id="premium",
        label="Premium",
        summary="higher-end finishes, cleaner detailing, clear premium signal",
        material_level="premium materials, custom-feeling surfaces, elevated hardware and fixtures",
        lighting_style="refined light with crisp highlights and premium finish definition",
        detail_level="high detail and polished, layered finishes",
        layout_variation="shift the layout to feel more curated and intentionally designed",
        price_position=0.66,
        span_ratio=0.15,
    ),
    VariantSlot(
        slot_id="luxury",
        label="Luxury",
        summary="strong premium signal, spa or boutique-hotel feel, more drama",
        material_level="luxury materials and bespoke-looking focal surfaces appropriate to the service",
        lighting_style="more dramatic contrast, sculpted architectural lighting, elevated ambiance",
        detail_level="rich detailing, layered premium materials, sharper finish definition",
        layout_variation="make the composition feel more dramatic with a stronger hero zone and upgraded spacing",
        price_position=0.80,
        span_ratio=0.16,
    ),
    VariantSlot(
        slot_id="aspirational_anchor",
        label="Aspirational Anchor",
        summary="highest-end believable wow factor, the strongest but still realistic anchor image",
        material_level="best-in-class finish package with the most elevated materials that still feel buildable",
        lighting_style="editorial-quality natural and architectural light without becoming fantastical",
        detail_level="highest layered detail, refined craftsmanship, strongest premium signal",
        layout_variation="create the clearest hero composition with a distinct focal feature and most confident spatial choreography",
        price_position=0.92,
        span_ratio=0.17,
    ),
)


def _normalize_reference_mode(raw: Any) -> str:
    value = str(raw or "").strip().lower()
    if value == "guide_only":
        return "guide_only"
    if value == "edit_target":
        return "edit_target"
    return ""


def _normalize_use_case(raw: Any) -> str:
    value = str(raw or "scene").strip().lower().replace("_", "-")
    if value == "drilldown":
        return "scene"
    if value in {"scene", "scene-refinement", "scene-placement", "tryon", "try-on"}:
        return "scene" if value == "try-on" else value
    return "scene"


def _coerce_int(value: Any, default: int = 0) -> int:
    try:
        if value is None:
            return default
        return int(value)
    except Exception:
        return default


def _coerce_float(value: Any) -> Optional[float]:
    try:
        if value is None:
            return None
        return float(value)
    except Exception:
        return None


def _coerce_bool(value: Any) -> Optional[bool]:
    if isinstance(value, bool):
        return value
    if isinstance(value, str):
        raw = value.strip().lower()
        if raw in {"1", "true", "yes", "on"}:
            return True
        if raw in {"0", "false", "no", "off"}:
            return False
    return None


def _merge_negative_prompt(primary: Optional[str], fallback: str) -> str:
    parts: list[str] = []
    seen: set[str] = set()
    for raw in (primary or "", fallback):
        for item in str(raw or "").split(","):
            token = item.strip()
            key = token.lower()
            if not token or key in seen:
                continue
            seen.add(key)
            parts.append(token)
    return ", ".join(parts)


def _extract_step_data(payload: Dict[str, Any]) -> Dict[str, Any]:
    raw = payload.get("stepDataSoFar") or payload.get("step_data_so_far") or {}
    return raw if isinstance(raw, dict) else {}


def _parse_moneyish(value: Any) -> Optional[int]:
    if value is None:
        return None
    if isinstance(value, bool):
        return None
    if isinstance(value, (int, float)):
        amount = int(value)
        return amount if amount > 0 else None
    if isinstance(value, dict):
        for key in ("value", "high", "max", "rangeHigh", "range_high", "low", "min"):
            amount = _parse_moneyish(value.get(key))
            if amount:
                return amount
        return None
    if isinstance(value, list):
        for item in value[:4]:
            amount = _parse_moneyish(item)
            if amount:
                return amount
        return None

    raw = str(value or "").strip().lower().replace(",", "").replace("$", "")
    if not raw:
        return None
    if raw.endswith("k"):
        try:
            return int(float(raw[:-1]) * 1000)
        except Exception:
            return None
    match = _MONEY_RE.search(raw)
    if not match:
        return None
    try:
        return int(float(match.group(1)))
    except Exception:
        return None


def _extract_budget_value(payload: Dict[str, Any]) -> Optional[int]:
    direct = _parse_moneyish(payload.get("budgetRange") or payload.get("budget_range") or payload.get("budget"))
    if direct:
        return direct
    step_data = _extract_step_data(payload)
    for key in ("step-budget-range", "budget_range", "budgetRange", "step-budget"):
        amount = _parse_moneyish(step_data.get(key))
        if amount:
            return amount
    return None


def _detect_currency(payload: Dict[str, Any]) -> str:
    raw = payload.get("currency") or payload.get("Currency")
    if isinstance(raw, str) and raw.strip():
        return raw.strip().upper()[:8]
    for key in ("serviceSummary", "service_summary", "companySummary", "company_summary"):
        value = payload.get(key)
        if isinstance(value, str):
            match = _CURRENCY_RE.search(value)
            if match:
                return match.group(1).upper()
    return "USD"


def _collect_scope_text(payload: Dict[str, Any]) -> str:
    parts: List[str] = []
    step_data = _extract_step_data(payload)
    for key, value in step_data.items():
        key_text = str(key or "").lower()
        if "scope" not in key_text and "project" not in key_text and "part" not in key_text and "area" not in key_text:
            continue
        parts.append(str(value or ""))
    answered = payload.get("answeredQA") or payload.get("answered_qa") or []
    if isinstance(answered, list):
        for item in answered[:12]:
            if not isinstance(item, dict):
                continue
            question = str(item.get("question") or "")
            answer = str(item.get("answer") or "")
            haystack = f"{question} {answer}".lower()
            if any(token in haystack for token in ("scope", "project", "area", "part", "full", "partial", "refresh", "gut")):
                parts.append(f"{question} {answer}")
    return " ".join(parts).lower()


def _scope_multiplier(scope_text: str) -> float:
    if not scope_text.strip():
        return 1.0
    mult = 1.0
    if any(token in scope_text for token in ("gut", "full", "complete", "entire", "custom", "major")):
        mult *= 1.12
    if any(token in scope_text for token in ("partial", "refresh", "cosmetic", "minor", "single area", "one room")):
        mult *= 0.88
    return max(0.8, min(1.25, mult))


def _build_basis_text(payload: Dict[str, Any]) -> str:
    try:
        ctx = build_context(payload)
    except Exception:
        ctx = {}
    parts = [
        str((ctx or {}).get("services_summary") or (ctx or {}).get("service_summary") or "").strip(),
        str((ctx or {}).get("industry") or "").strip(),
        str((ctx or {}).get("service") or "").strip(),
    ]
    instance_context = payload.get("instanceContext") or payload.get("instance_context") or {}
    if isinstance(instance_context, dict):
        parts.append(str(instance_context.get("serviceSummary") or instance_context.get("service_summary") or "").strip())
    return " ".join(part for part in parts if part).strip()


def _build_gallery_envelope(
    calibration_payload: Dict[str, Any],
    *,
    budget_value: Optional[int],
    scope_text: str,
) -> PriceRange:
    service_range = calibration_payload["service_range"]
    starter_baseline = calibration_payload["starter_baseline"]
    premium_tier = calibration_payload["premium_tier"]
    visible_band = calibration_payload["visible_band"]

    floor = min(service_range.low, starter_baseline.low)
    floor = max(service_range.low, min(starter_baseline.low, calibration_payload["starter_tier"].low))
    ceiling = max(premium_tier.high, int(round(service_range.low + (service_range.high - service_range.low) * 0.42)))
    ceiling = min(service_range.high, ceiling)

    mult = _scope_multiplier(scope_text)
    floor = int(round(floor * max(0.9, min(mult, 1.05))))
    ceiling = int(round(ceiling * max(0.92, min(mult, 1.18))))

    if budget_value and budget_value > 0:
        current_mid = int(round((floor + ceiling) / 2.0))
        target_mid = max(service_range.low, min(service_range.high, budget_value))
        shift = int(round((target_mid - current_mid) * 0.35))
        floor += shift
        ceiling += shift

    min_span = max(6_000, visible_band.low * 4)
    max_span = max(min_span, visible_band.high * 6)
    span = ceiling - floor
    if span < min_span:
        ceiling = floor + min_span
    elif span > max_span:
        ceiling = floor + max_span

    if ceiling > service_range.high:
        shift = ceiling - service_range.high
        floor -= shift
        ceiling -= shift
    if floor < service_range.low:
        shift = service_range.low - floor
        floor += shift
        ceiling += shift

    floor = max(service_range.low, floor)
    ceiling = min(service_range.high, ceiling)
    if ceiling <= floor:
        ceiling = min(service_range.high, floor + max(4_000, visible_band.low * 2))
    return PriceRange(low=floor, high=ceiling).normalized()


def _coerce_price_range_dict(raw: Any) -> Optional[PriceRange]:
    if not isinstance(raw, dict):
        return None
    try:
        low = int(raw.get("low"))
        high = int(raw.get("high"))
    except Exception:
        return None
    if low <= 0 or high <= 0:
        return None
    return PriceRange(low=low, high=high).normalized()


def _price_range_for_slot(slot: VariantSlot, envelope: PriceRange, service_range: PriceRange) -> PriceRange:
    span = max(4_000, envelope.high - envelope.low)
    center = envelope.low + int(round(span * slot.price_position))
    width = max(2_500, int(round(span * slot.span_ratio)))
    low = center - int(round(width / 2.0))
    high = center + int(round(width / 2.0))
    low = max(service_range.low, low)
    high = min(service_range.high, high)
    if high <= low:
        high = min(service_range.high, low + 2_500)
    return PriceRange(low=low, high=high).normalized()


def _resolve_gallery_pricing_seed(
    payload: Dict[str, Any],
    *,
    calibration: Any,
) -> Dict[str, Any]:
    fallback = calibration_response_payload(calibration)
    fallback_service_range = calibration.normalized_service_range()
    fallback_range = calibration.normalized_starter_baseline()

    try:
        seed_payload = dict(payload)
        seed_payload.pop("previewImageUrl", None)
        seed_payload.pop("preview_image_url", None)
        seed_payload.pop("baselineImageUrl", None)
        seed_payload.pop("baseline_image_url", None)
        seed_payload.pop("baselinePriceRange", None)
        seed_payload.pop("baseline_price_range", None)
        seed_payload.pop("pricingScenario", None)
        seed_payload.pop("pricing_scenario", None)
        estimate = estimate_pricing(seed_payload)
    except Exception:
        estimate = None

    if not isinstance(estimate, dict) or not estimate.get("ok"):
        return {
            "service_range": fallback_service_range,
            "estimate_range": fallback_range,
            "budget_tier_ranges": fallback["budgetTierRanges"],
            "budget_tier": resolve_budget_tier(calibration, _extract_budget_value(payload)),
            "calibration_key": calibration.key,
            "median_price": fallback_service_range.midpoint(),
        }

    service_range = _coerce_price_range_dict(estimate.get("servicePriceRange")) or fallback_service_range
    estimate_range = (
        _coerce_price_range_dict(
            {
                "low": estimate.get("rangeLow"),
                "high": estimate.get("rangeHigh"),
            }
        )
        or _coerce_price_range_dict(estimate.get("imagePriceRange"))
        or calibration.normalized_starter_baseline()
    )
    budget_tier_ranges = estimate.get("budgetTierRanges") if isinstance(estimate.get("budgetTierRanges"), dict) else fallback["budgetTierRanges"]
    budget_tier = str(estimate.get("budgetTier") or "").strip().lower() or resolve_budget_tier(calibration, _extract_budget_value(payload))
    calibration_key = str(estimate.get("calibrationKey") or calibration.key).strip() or calibration.key
    return {
        "service_range": service_range,
        "estimate_range": estimate_range,
        "budget_tier_ranges": budget_tier_ranges,
        "budget_tier": budget_tier,
        "calibration_key": calibration_key,
        "median_price": service_range.midpoint(),
    }


def _resolve_slot_prices(payload: Dict[str, Any]) -> dict[str, Dict[str, Any]]:
    basis_text = _build_basis_text(payload)
    calibration = match_service_calibration(basis_text)
    budget_value = _extract_budget_value(payload)
    scope_text = _collect_scope_text(payload)
    pricing_seed = _resolve_gallery_pricing_seed(payload, calibration=calibration)
    calibration_meta = calibration_response_payload(calibration)
    service_range = pricing_seed["service_range"]
    envelope = _build_gallery_envelope(
        {
            "service_range": service_range,
            "visible_band": calibration.normalized_visible_band_clamp(),
            "starter_baseline": calibration.normalized_starter_baseline(),
            "starter_tier": _coerce_price_range_dict(pricing_seed["budget_tier_ranges"].get("starter"))
            or calibration.normalized_tier_ranges()["starter"],
            "premium_tier": _coerce_price_range_dict(pricing_seed["budget_tier_ranges"].get("premium"))
            or calibration.normalized_tier_ranges()["premium"],
        },
        budget_value=budget_value,
        scope_text=scope_text,
    )
    seeded_estimate_range = pricing_seed["estimate_range"]
    if seeded_estimate_range:
        envelope_mid = envelope.midpoint()
        estimate_mid = seeded_estimate_range.midpoint()
        shift = int(round((estimate_mid - envelope_mid) * 0.45))
        envelope = PriceRange(
            low=max(service_range.low, envelope.low + shift),
            high=min(service_range.high, envelope.high + shift),
        ).normalized()
    currency = _detect_currency(payload)

    slot_prices: dict[str, Dict[str, Any]] = {}
    for slot in VARIANT_SLOTS:
        price_range = _price_range_for_slot(slot, envelope, service_range)
        slot_prices[slot.slot_id] = {
            "priceRange": {**price_range.to_dict(), "currency": currency},
            "budgetTier": resolve_budget_tier(calibration, price_range.midpoint()),
            "budgetTierRanges": pricing_seed["budget_tier_ranges"] or calibration_meta["budgetTierRanges"],
            "calibrationKey": pricing_seed["calibration_key"],
            "servicePriceRange": service_range.to_dict(),
            "medianPrice": pricing_seed["median_price"],
            "seedBudgetTier": pricing_seed["budget_tier"],
        }
    return slot_prices


def _build_base_prompt_spec(payload: Dict[str, Any]) -> Dict[str, Any]:
    from programs.image_generator.orchestrator import build_image_prompt

    reference_mode = _normalize_reference_mode(payload.get("referenceMode") or payload.get("reference_mode"))
    reference_images, scene_image, _ = extract_reference_images(payload)
    prompt_payload = dict(payload)

    if reference_mode == "guide_only":
        prompt_payload["referenceImages"] = []
        prompt_payload["reference_images"] = []
        prompt_payload.pop("sceneImage", None)
        prompt_payload.pop("scene_image", None)
    elif scene_image:
        prompt_payload["referenceImages"] = [scene_image]
        prompt_payload["reference_images"] = [scene_image]
        prompt_payload["sceneImage"] = scene_image
        prompt_payload["scene_image"] = scene_image
    else:
        prompt_payload["referenceImages"] = reference_images[:1]
        prompt_payload["reference_images"] = reference_images[:1]

    prompt_result = build_image_prompt(prompt_payload)
    prompt_spec = prompt_result.get("prompt") if isinstance(prompt_result, dict) else None
    if not isinstance(prompt_spec, dict):
        error_message = "DSPy prompt generation failed for price ladder gallery."
        if isinstance(prompt_result, dict):
            error_message = str(prompt_result.get("message") or prompt_result.get("error") or error_message)
        raise RuntimeError(error_message)
    return prompt_spec


def _resolve_gallery_model_id(payload: Dict[str, Any], base_spec: Dict[str, Any], *, style_refs: List[str], scene_anchor: Optional[str]) -> str:
    explicit = str(payload.get("modelId") or payload.get("model_id") or "").strip()
    if explicit:
        return explicit
    return "black-forest-labs/flux-schnell"


def _build_slot_prompt(
    *,
    base_prompt: str,
    slot: VariantSlot,
    slot_price: Dict[str, Any],
    guide_only: bool,
    scene_anchor: Optional[str],
    style_ref_count: int,
    retry_index: int,
) -> str:
    price_range = slot_price.get("priceRange") if isinstance(slot_price, dict) else {}
    price_low = int(price_range.get("low") or 0)
    price_high = int(price_range.get("high") or 0)
    currency = str(price_range.get("currency") or "USD").upper()

    lines = [
        base_prompt.strip(),
        "This request belongs to a fixed 9-image price-ladder concept set.",
        "Generate one standalone finished image for this slot only.",
        "Same style family, different execution reality.",
        "Never return a collage, contact sheet, storyboard, multi-panel composition, or any layout with visible text or numerals.",
    ]

    if style_ref_count > 0:
        lines.append(
            "Use the provided reference image(s) only to keep the same style family, palette, and material language. "
            "Do not create a collage or copy the exact composition."
        )

    if guide_only:
        lines.append(
            "Generate one completed concept image that feels original and fully resolved. Do not show the source image, multiple stages, or any comparison treatment."
        )
    elif scene_anchor:
        lines.append(
            "Preserve the uploaded space's structural envelope, camera perspective, and overall footprint, but make the finished design visibly distinct for this slot."
        )

    lines.extend(
        [
            f"Variant target: {slot.label}. {slot.summary}.",
            f"Material level: {slot.material_level}.",
            f"Lighting style: {slot.lighting_style}.",
            f"Detail density: {slot.detail_level}.",
            f"Layout variation: {slot.layout_variation}.",
            f"Price signal: the final image should look credibly aligned with a {currency} {price_low:,}-{price_high:,} implementation for this service.",
            "Make this clearly distinct from sibling variants through layout emphasis, fixture mix, material package, and lighting mood, not by changing to a different style family.",
            "Absolute priority: this must read as a real photographed finished result, not AI art, not a mood board, and not a 3D render.",
            "Do not add text, letters, numbers, numerals, digits, captions, labels, logos, watermarks, signage, price tags, measurement marks, or callouts anywhere in the image.",
            "Use believable camera optics, accurate scale, true-to-life proportions, natural shadow falloff, grounded objects, realistic reflections, and material textures with subtle real-world imperfections.",
            "Favor documentary or high-end real-estate photography realism over stylization. Keep the scene buildable, physically plausible, and professionally executed.",
        ]
    )

    if retry_index > 0:
        lines.append(
            "Increase separation from the other variants. Change the dominant focal feature, mirror or focal geometry, fixture hierarchy, and spatial emphasis while staying realistic."
        )
        lines.append(
            "Push even harder toward realism on retry: stronger material believability, less symmetry, less showroom polish, more convincing lived-in photographic authenticity."
        )

    return "\n".join(line for line in lines if line.strip()).strip()


def _extract_output_image(provider_response: Dict[str, Any]) -> Optional[str]:
    output = provider_response.get("output")
    if isinstance(output, str) and output.strip():
        return output.strip()
    if isinstance(output, list):
        for item in output:
            if isinstance(item, str) and item.strip():
                return item.strip()
            if isinstance(item, dict):
                url = item.get("url")
                if isinstance(url, str) and url.strip():
                    return url.strip()
    return None


def _generate_slot_variant(
    *,
    slot: VariantSlot,
    slot_index: int,
    payload: Dict[str, Any],
    base_prompt: str,
    negative_prompt: Optional[str],
    slot_price: Dict[str, Any],
    model_id: str,
    guide_only: bool,
    scene_anchor: Optional[str],
    style_refs: List[str],
) -> Dict[str, Any]:
    last_error = "image_generation_failed"

    for retry_index in range(2):
        prompt = _build_slot_prompt(
            base_prompt=base_prompt,
            slot=slot,
            slot_price=slot_price,
            guide_only=guide_only,
            scene_anchor=scene_anchor,
            style_ref_count=len(style_refs),
            retry_index=retry_index,
        )
        try:
            provider_response = generate_images(
                prompt=prompt,
                num_outputs=1,
                output_format=str(payload.get("outputFormat") or payload.get("output_format") or "png"),
                model_id=model_id,
                use_case=_normalize_use_case(payload.get("useCase") or payload.get("use_case")),
                negative_prompt=negative_prompt,
                aspect_ratio=str(payload.get("aspectRatio") or payload.get("aspect_ratio") or "").strip() or None,
                width=_coerce_int(payload.get("width")) or None,
                height=_coerce_int(payload.get("height")) or None,
                num_inference_steps=_coerce_int(payload.get("numInferenceSteps") or payload.get("num_inference_steps")) or None,
                guidance_scale=_coerce_float(payload.get("guidanceScale") or payload.get("guidance_scale")),
                prompt_strength=_coerce_float(payload.get("promptStrength") or payload.get("prompt_strength") or payload.get("strength")),
                image_prompt_strength=_coerce_float(payload.get("imagePromptStrength") or payload.get("image_prompt_strength")),
                safety_tolerance=_coerce_int(payload.get("safetyTolerance") or payload.get("safety_tolerance")) or None,
                prompt_upsampling=_coerce_bool(payload.get("promptUpsampling") or payload.get("prompt_upsampling")),
                go_fast=_coerce_bool(payload.get("goFast") or payload.get("go_fast")),
                reference_images=([scene_anchor] if scene_anchor else style_refs) or None,
                scene_image=scene_anchor,
                product_image=None,
            )
        except Exception as exc:
            last_error = f"{type(exc).__name__}: {exc}"
            continue

        status = str(provider_response.get("status") or "").strip().lower()
        if status in {"failed", "timeout", "canceled"}:
            last_error = str(provider_response.get("error") or provider_response.get("message") or status)
            continue

        image_url = _extract_output_image(provider_response)
        if not image_url:
            last_error = "provider_returned_no_image"
            continue

        return {
            "ok": True,
            "slotId": slot.slot_id,
            "label": slot.label,
            "order": slot_index,
            "imageUrl": image_url,
            "controls": slot.controls(),
            "summary": slot.summary,
            "priceRange": slot_price["priceRange"],
            "budgetTier": slot_price["budgetTier"],
            "budgetTierRanges": slot_price["budgetTierRanges"],
            "calibrationKey": slot_price["calibrationKey"],
            "servicePriceRange": slot_price["servicePriceRange"],
            "medianPrice": slot_price["medianPrice"],
            "seedBudgetTier": slot_price["seedBudgetTier"],
            "predictionId": provider_response.get("id"),
            "prompt": prompt,
        }

    return {
        "ok": False,
        "slotId": slot.slot_id,
        "label": slot.label,
        "order": slot_index,
        "error": last_error,
    }


def generate_price_ladder_gallery(payload: Dict[str, Any]) -> Dict[str, Any]:
    request_id = f"price_ladder_gallery_{int(time.time() * 1000)}"
    requested_outputs = max(1, min(9, _coerce_int(payload.get("numOutputs") or payload.get("num_outputs") or 9, 9)))
    variant_start_index = max(0, min(len(VARIANT_SLOTS), _coerce_int(payload.get("variantStartIndex") or payload.get("variant_start_index"), 0)))
    slots = list(VARIANT_SLOTS[variant_start_index : variant_start_index + requested_outputs])

    if not slots:
        return {
            "ok": True,
            "requestId": request_id,
            "provider": "replicate",
            "images": [],
            "variants": [],
            "message": "No remaining gallery slots requested.",
        }

    base_spec = _build_base_prompt_spec(payload)
    base_prompt = str(base_spec.get("prompt") or "").strip()
    negative_prompt = _merge_negative_prompt(
        str(base_spec.get("negativePrompt") or "").strip() or None,
        _REALISM_NEGATIVE_TERMS,
    )
    if not base_prompt:
        return {
            "ok": False,
            "requestId": request_id,
            "error": "price_ladder_prompt_unavailable",
            "message": "Failed to build the base concept-gallery prompt.",
        }

    reference_mode = _normalize_reference_mode(payload.get("referenceMode") or payload.get("reference_mode"))
    reference_images, scene_image, _ = extract_reference_images(payload)
    guide_only = reference_mode == "guide_only"
    scene_anchor = None if guide_only else (scene_image if isinstance(scene_image, str) and scene_image.strip() else None)
    style_refs = [ref for ref in reference_images if ref and ref != scene_anchor][:3]
    slot_prices = _resolve_slot_prices(payload)
    model_id = _resolve_gallery_model_id(payload, base_spec, style_refs=style_refs, scene_anchor=scene_anchor)

    max_workers = max(1, min(len(slots), _coerce_int(os.getenv("PRICE_LADDER_GALLERY_MAX_CONCURRENCY"), 3)))
    results: list[Optional[Dict[str, Any]]] = [None] * len(slots)

    with ThreadPoolExecutor(max_workers=max_workers) as executor:
        futures = {
            executor.submit(
                _generate_slot_variant,
                slot=slot,
                slot_index=variant_start_index + local_index,
                payload=payload,
                base_prompt=base_prompt,
                negative_prompt=negative_prompt,
                slot_price=slot_prices[slot.slot_id],
                model_id=model_id,
                guide_only=guide_only,
                scene_anchor=scene_anchor,
                style_refs=style_refs,
            ): local_index
            for local_index, slot in enumerate(slots)
        }
        for future in as_completed(futures):
            local_index = futures[future]
            try:
                results[local_index] = future.result()
            except Exception as exc:
                slot = slots[local_index]
                results[local_index] = {
                    "ok": False,
                    "slotId": slot.slot_id,
                    "label": slot.label,
                    "order": variant_start_index + local_index,
                    "error": f"{type(exc).__name__}: {exc}",
                }

    variants = [result for result in results if isinstance(result, dict) and result.get("ok") and result.get("imageUrl")]
    if not variants:
        return {
            "ok": False,
            "requestId": request_id,
            "error": "price_ladder_generation_failed",
            "message": "All concept-gallery slots failed to generate.",
            "provider": "replicate",
        }

    return {
        "ok": True,
        "requestId": request_id,
        "provider": "replicate",
        "modelId": model_id,
        "images": [str(item["imageUrl"]) for item in variants],
        "variants": variants,
        "message": "Generated a 9-slot price-ladder concept gallery.",
        "slotOrder": [slot.slot_id for slot in slots],
    }
