"""
Replicate GPT-4.1-nano (vision) caller for AI-powered pricing estimation.

Uses the same Replicate API pattern as image_generation.py.
Output: image_price_range (for the design shown) and service_price_range (typical for service type).
"""

from __future__ import annotations

import json
import os
import re
import time
from typing import Any, Dict, Optional, Tuple

import requests

from programs.pricing.service_calibration import ServiceCalibration


PRICING_VLM_MODEL = os.getenv("PRICING_VLM_MODEL", "openai/gpt-4.1-nano").strip()
PRICING_VLM_TIMEOUT_SEC = float(os.getenv("PRICING_VLM_TIMEOUT_SEC", "60"))


def _replicate_api_token() -> str:
    token = str(os.getenv("REPLICATE_API_TOKEN") or "").strip()
    if not token:
        raise RuntimeError("REPLICATE_API_TOKEN is not set (required for pricing VLM)")
    return token


def _replicate_create_prediction(*, model_id: str, input: Dict[str, Any]) -> Dict[str, Any]:
    token = _replicate_api_token()
    url = "https://api.replicate.com/v1/predictions"
    headers = {
        "Authorization": f"Token {token}",
        "Content-Type": "application/json",
        "Accept": "application/json",
    }

    def _is_hex64(s: str) -> bool:
        s = str(s or "").strip().lower()
        return len(s) == 64 and all(c in "0123456789abcdef" for c in s)

    model_str = str(model_id or "").strip()
    model_only, _, maybe_version = model_str.partition(":")

    payloads: list[Dict[str, Any]] = []

    if _is_hex64(maybe_version):
        payloads.append({"version": maybe_version, "input": input})
    elif _is_hex64(model_only) and ":" not in model_str:
        payloads.append({"version": model_only, "input": input})

    if "/" in model_only and not _is_hex64(model_only):
        try:
            owner, name = model_only.split("/", 1)
            meta = requests.get(
                f"https://api.replicate.com/v1/models/{owner}/{name}",
                headers={"Authorization": f"Token {token}", "Accept": "application/json"},
                timeout=30,
            )
            if meta.ok:
                data = meta.json() if meta.content else {}
                latest = data.get("latest_version") if isinstance(data, dict) else None
                version_id = latest.get("id") if isinstance(latest, dict) else None
                if isinstance(version_id, str) and _is_hex64(version_id):
                    payloads.append({"version": version_id, "input": input})
        except Exception:
            pass

    payloads.append({"version": model_str, "input": input})

    last_status = None
    last_data: Any = None
    for p in payloads:
        resp = requests.post(url, headers=headers, json=p, timeout=30)
        last_status = resp.status_code
        try:
            data = resp.json()
        except Exception:
            data = {"error": resp.text[:800]}
        last_data = data
        if resp.ok:
            if not isinstance(data, dict) or not data.get("id"):
                raise RuntimeError(f"Replicate create returned unexpected payload: {data}")
            return data

    raise RuntimeError(f"Replicate create failed ({last_status}): {last_data}")


def _replicate_get_prediction(prediction_id: str) -> Dict[str, Any]:
    token = _replicate_api_token()
    url = f"https://api.replicate.com/v1/predictions/{prediction_id}"
    resp = requests.get(
        url,
        headers={"Authorization": f"Token {token}", "Accept": "application/json"},
        timeout=30,
    )
    try:
        data = resp.json()
    except Exception:
        data = {"error": resp.text[:800]}
    if not resp.ok:
        raise RuntimeError(f"Replicate get failed ({resp.status_code}): {data}")
    if not isinstance(data, dict) or not data.get("id"):
        raise RuntimeError(f"Replicate get returned unexpected payload: {data}")
    return data


def _replicate_wait_for_completion(prediction_id: str, *, timeout_sec: float) -> Dict[str, Any]:
    deadline = time.time() + max(5.0, float(timeout_sec or 0))
    last: Dict[str, Any] = {}
    while time.time() < deadline:
        last = _replicate_get_prediction(prediction_id)
        status = str(last.get("status") or "").lower()
        if status in {"succeeded", "failed", "canceled"}:
            return last
        time.sleep(1.0)
    return {**last, "status": "timeout", "error": "Prediction timed out"}


def _build_pricing_context_json(payload: Dict[str, Any]) -> str:
    """Build compact JSON context for the VLM, similar to question_planner planner_context_json."""
    from programs.form_pipeline.context_builder import build_context

    ctx = build_context(payload)
    services_summary = str(ctx.get("services_summary") or ctx.get("service_summary") or "").strip()
    industry = str(ctx.get("industry") or "").strip()
    service = str(ctx.get("service") or "").strip()
    answered_qa = ctx.get("answered_qa") or []
    step_data = payload.get("stepDataSoFar") or payload.get("step_data_so_far") or {}
    if not isinstance(step_data, dict):
        state = payload.get("state")
        if isinstance(state, dict) and isinstance(state.get("answers"), dict):
            step_data = state.get("answers") or {}
        else:
            step_data = {}

    compact: Dict[str, Any] = {
        "service_summary": services_summary[:800] if services_summary else "",
        "industry": industry,
        "service": service,
        "answered_qa": answered_qa[:20] if isinstance(answered_qa, list) else [],
        "step_data": step_data if isinstance(step_data, dict) else {},
    }
    return json.dumps(compact, ensure_ascii=True, separators=(",", ":"))


def _extract_json_from_text(text: str) -> Optional[Dict[str, Any]]:
    """Extract first JSON object from model output (handles markdown code blocks)."""
    s = str(text or "").strip()
    if not s:
        return None

    # Strip markdown code blocks
    for pattern in (r"```(?:json)?\s*([\s\S]*?)```", r"```\s*([\s\S]*?)```"):
        m = re.search(pattern, s)
        if m:
            s = m.group(1).strip()

    start = s.find("{")
    if start < 0:
        return None

    depth = 0
    in_str = False
    esc = False
    for i in range(start, len(s)):
        ch = s[i]
        if in_str:
            if esc:
                esc = False
                continue
            if ch == "\\":
                esc = True
                continue
            if ch == '"':
                in_str = False
            continue
        if ch == '"':
            in_str = True
            continue
        if ch == "{":
            depth += 1
        elif ch == "}":
            depth -= 1
            if depth == 0:
                blob = s[start : i + 1]
                try:
                    parsed = json.loads(blob)
                    return parsed if isinstance(parsed, dict) else None
                except Exception:
                    return None
    return None


def _parse_vlm_output(output: Any) -> Optional[Tuple[Tuple[int, int], Optional[Tuple[int, int]]]]:
    """
    Parse VLM output into (image_range, service_range).
    Returns ((low, high), (low, high)) or None if invalid.
    """
    if output is None:
        return None

    # Replicate may return string[] (streamed) or a single string
    text = ""
    if isinstance(output, list):
        text = "".join(str(x) for x in output)
    elif isinstance(output, str):
        text = output
    else:
        return None

    obj = _extract_json_from_text(text)
    if not isinstance(obj, dict):
        return None

    def _parse_range(r: Any) -> Optional[Tuple[int, int]]:
        if not isinstance(r, dict):
            return None
        lo = r.get("low") if "low" in r else r.get("min")
        hi = r.get("high") if "high" in r else r.get("max")
        try:
            low = int(lo) if lo is not None else None
            high = int(hi) if hi is not None else None
        except (TypeError, ValueError):
            return None
        if low is None or high is None or low < 0 or high < 0:
            return None
        return (min(low, high), max(low, high))

    image_range = _parse_range(obj.get("image_price_range"))
    service_range = _parse_range(obj.get("service_price_range"))

    if image_range:
        return (image_range, service_range)
    return None


def estimate_pricing_with_vlm(
    payload: Dict[str, Any],
    *,
    preview_image_url: str,
    calibration: ServiceCalibration,
    model_id: Optional[str] = None,
    timeout_sec: Optional[float] = None,
) -> Dict[str, Any]:
    """
    Call Replicate GPT-4.1-nano with image + context to get AI pricing estimate.

    Returns dict with rangeLow, rangeHigh, servicePriceRange, or raises on failure.
    """
    model = str(model_id or PRICING_VLM_MODEL).strip() or PRICING_VLM_MODEL
    timeout = float(timeout_sec or PRICING_VLM_TIMEOUT_SEC)

    context_json = _build_pricing_context_json(payload)
    calibration_payload = {
        "service_price_range": calibration.normalized_service_range().to_dict(),
        "visible_band_clamp": calibration.normalized_visible_band_clamp().to_dict(),
        "starter_baseline": calibration.normalized_starter_baseline().to_dict(),
        "budget_tier_ranges": calibration.budget_tier_ranges_dict(),
    }

    system_prompt = (
        "You are a pricing estimator for home services and similar projects. "
        "Given an image of a completed design/preview, service context, and a matched service calibration, output JSON with exactly two keys:\n"
        "1. image_price_range: { \"low\": number, \"high\": number } — the real-world cost (USD) to achieve what's shown in the image. "
        "CRITICAL: This estimate must stay inside the provided service_price_range. "
        "The visible width of image_price_range should land near 8-12% of the service span and also stay within visible_band_clamp. "
        "Use the image to place the estimate within the provided budget tiers, but do not underprice obviously expensive-looking designs.\n"
        "2. service_price_range: { \"low\": number, \"high\": number } — copy the provided calibration service_price_range exactly.\n"
        "Output ONLY valid JSON, no markdown."
    )

    user_prompt = (
        f"Service context:\n{context_json}\n\n"
        f"Matched calibration:\n{json.dumps(calibration_payload, ensure_ascii=True, separators=(',', ':'))}\n\n"
        "The image shows a completed project for this service. Estimate the real-world cost to achieve what's shown. "
        "Return JSON with image_price_range and service_price_range. Copy calibration.service_price_range exactly."
    )

    # Replicate GPT-4.1-nano: prompt, system_prompt, image_input (array of URLs)
    image_url = str(preview_image_url or "").strip()
    if not image_url or not (image_url.startswith("http://") or image_url.startswith("https://")):
        raise ValueError("preview_image_url must be a valid http(s) URL")

    inp: Dict[str, Any] = {
        "prompt": user_prompt,
        "system_prompt": system_prompt,
        "image_input": [image_url],
        "temperature": 0.3,
        "max_completion_tokens": 512,
    }

    created = _replicate_create_prediction(model_id=model, input=inp)
    pred_id = created.get("id")
    if not pred_id:
        raise RuntimeError("Replicate create did not return prediction id")

    final = _replicate_wait_for_completion(pred_id, timeout_sec=timeout)
    status = str(final.get("status") or "").lower()

    if status == "failed":
        err = final.get("error") or final.get("logs") or "Unknown error"
        raise RuntimeError(f"Replicate prediction failed: {err}")

    if status == "timeout":
        raise RuntimeError("Replicate prediction timed out")

    output = final.get("output")
    parsed = _parse_vlm_output(output)
    if not parsed:
        raise RuntimeError("VLM returned invalid or unparseable JSON")

    (img_lo, img_hi), svc_range = parsed
    svc = svc_range or (
        calibration.normalized_service_range().low,
        calibration.normalized_service_range().high,
    )
    svc_lo, svc_hi = svc

    return {
        "rangeLow": img_lo,
        "rangeHigh": img_hi,
        "servicePriceRange": {"low": svc_lo, "high": svc_hi},
        "basis": "ai_v1",
        "confidence": "medium",
    }


__all__ = ["estimate_pricing_with_vlm", "_build_pricing_context_json", "_parse_vlm_output"]
