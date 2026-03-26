from __future__ import annotations

import json
import os
import time
import base64
from concurrent.futures import ThreadPoolExecutor, as_completed
from threading import Lock
from typing import Any, Dict, List, Optional, Tuple

import requests


_LOG_VERBOSE_KEY = "IMAGE_LOG_DETAILED_PAYLOADS"
_LOG_VERBOSE_CACHE: Optional[bool] = None
_LOG_JSON_LIMIT = 6000


def _verbose_provider_logging_enabled() -> bool:
    global _LOG_VERBOSE_CACHE
    if _LOG_VERBOSE_CACHE is None:
        val = str(os.getenv(_LOG_VERBOSE_KEY) or "").strip().lower()
        _LOG_VERBOSE_CACHE = val in {"1", "true", "yes"}
    return _LOG_VERBOSE_CACHE


def _pretty_json(obj: Any, *, max_chars: int = _LOG_JSON_LIMIT) -> str:
    try:
        text = json.dumps(obj, indent=2, ensure_ascii=False, sort_keys=True)
    except Exception:
        text = str(obj)
    if len(text) > max_chars:
        text = text[:max_chars] + "…"
    return text


def _log_provider(label: str, data: Any) -> None:
    if not _verbose_provider_logging_enabled():
        return
    try:
        text = _pretty_json(data)
        print(f"[image_generator] {label}:\n{text}", flush=True)
    except Exception:
        print(f"[image_generator] {label}: (unable to serialize)", flush=True)


def _replicate_api_token() -> str:
    token = str(os.getenv("REPLICATE_API_TOKEN") or "").strip()
    if not token:
        raise RuntimeError("REPLICATE_API_TOKEN is not set (required for image generation)")
    return token


def _normalize_use_case(raw: Any) -> str:
    v = str(raw or "").strip().lower().replace("_", "-")
    if v in {"tryon", "try-on"}:
        return "tryon"
    if v == "scene-placement":
        return "scene-placement"
    if v == "scene-refinement":
        return "scene-refinement"
    if v == "scene":
        return "scene"
    return ""


def _is_grok_imagine_image_model(model_id: str) -> bool:
    mid = str(model_id or "").strip().lower()
    return mid == "xai/grok-imagine-image" or mid.startswith("xai/grok-imagine-image:")


def _derive_aspect_ratio(width: Optional[int], height: Optional[int]) -> Optional[str]:
    if not isinstance(width, int) or not isinstance(height, int) or width <= 0 or height <= 0:
        return None
    from math import gcd

    g = gcd(width, height)
    ratio = f"{width // g}:{height // g}"
    allowed = {
        "1:1",
        "16:9",
        "9:16",
        "4:3",
        "3:4",
        "3:2",
        "2:3",
        "2:1",
        "1:2",
        "19.5:9",
        "9:19.5",
        "20:9",
        "9:20",
        "auto",
    }
    if ratio in allowed:
        return ratio
    # Fallback to closest coarse orientation buckets supported by the model.
    if width == height:
        return "1:1"
    if width > height:
        return "16:9" if (width / height) >= 1.6 else "4:3"
    return "9:16" if (height / width) >= 1.6 else "3:4"


def _replicate_default_model_id(*, use_case: Optional[str] = None) -> str:
    """
    Pick a Replicate model based on the instance `useCase` when available.

    Expected env vars (see `.env.local`):
    - TRYON_REPLICATE_MODEL_ID
    - SCENE_REPLICATE_MODEL_ID
    - SCENE_PLACEMENT_REPLICATE_MODEL_ID
    Fallback:
    - REPLICATE_MODEL_ID / REPLICATE_MODEL / REPLICATE_MODEL_VERSION
    """
    uc = _normalize_use_case(use_case)
    if uc == "tryon":
        m = str(os.getenv("TRYON_REPLICATE_MODEL_ID") or "").strip()
        if m:
            return m
    if uc == "scene":
        m = str(os.getenv("SCENE_REPLICATE_MODEL_ID") or "").strip()
        if m:
            return m
    if uc == "scene-placement":
        m = str(os.getenv("SCENE_PLACEMENT_REPLICATE_MODEL_ID") or "").strip()
        if m:
            return m
    if uc == "scene-refinement":
        m = str(os.getenv("SCENE_REFINEMENT_REPLICATE_MODEL_ID") or "").strip()
        if m:
            return m
        m = str(os.getenv("SCENE_PLACEMENT_REPLICATE_MODEL_ID") or "").strip()
        if m:
            return m

    # Accept a few common env names to reduce friction across repos.
    model_id = (
        str(os.getenv("REPLICATE_MODEL_ID") or "").strip()
        or str(os.getenv("REPLICATE_MODEL") or "").strip()
        or str(os.getenv("REPLICATE_MODEL_VERSION") or "").strip()
    )
    if not model_id:
        if uc == "tryon":
            raise RuntimeError(
                "No Replicate model configured for useCase='tryon'. "
                "Set TRYON_REPLICATE_MODEL_ID (recommended) or REPLICATE_MODEL_ID."
            )
        if uc == "scene":
            raise RuntimeError(
                "No Replicate model configured for useCase='scene'. "
                "Set SCENE_REPLICATE_MODEL_ID (recommended) or REPLICATE_MODEL_ID."
            )
        if uc == "scene-placement":
            raise RuntimeError(
                "No Replicate model configured for useCase='scene-placement'. "
                "Set SCENE_PLACEMENT_REPLICATE_MODEL_ID (recommended) or REPLICATE_MODEL_ID."
            )
        if uc == "scene-refinement":
            raise RuntimeError(
                "No Replicate model configured for useCase='scene-refinement'. "
                "Set SCENE_REFINEMENT_REPLICATE_MODEL_ID or SCENE_PLACEMENT_REPLICATE_MODEL_ID or REPLICATE_MODEL_ID."
            )
        raise RuntimeError(
            "REPLICATE_MODEL_ID is not set (required for image generation). "
            "Example: black-forest-labs/flux-1.1-pro"
        )
    return model_id


def _is_flux_schnell_model(model_id: str) -> bool:
    return "flux-schnell" in str(model_id or "").strip().lower()


def _is_flux_kontext_model(model_id: str) -> bool:
    return "flux-kontext" in str(model_id or "").strip().lower()


def _is_flux_1_1_pro_model(model_id: str) -> bool:
    return "flux-1.1-pro" in str(model_id or "").strip().lower()


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

    # Replicate's create API shape has varied over time (some environments accept `model`,
    # others require a `version` id). To be robust, we always try to resolve "owner/name"
    # into a concrete version id, then create using `version`.
    model_str = str(model_id or "").strip()
    model_only, _, maybe_version = model_str.partition(":")

    tried: list[tuple[str, Any]] = []
    payloads: list[Dict[str, Any]] = []

    # 1) If we were given an explicit version id (either raw hex or owner/name:hex), prefer it.
    if _is_hex64(maybe_version):
        payloads.append({"version": maybe_version, "input": input})
    elif _is_hex64(model_only) and ":" not in model_str:
        payloads.append({"version": model_only, "input": input})

    # 2) If we were given owner/name, resolve to latest_version.id and use that.
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
                    tried.append(("resolved_latest_version", version_id))
        except Exception:
            pass

    # 3) Last resort: try whatever the caller passed as `version` (may work in some setups).
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
        tried.append(("version", p.get("version")))
        last_data = data
        if resp.ok:
            if not isinstance(data, dict) or not data.get("id"):
                raise RuntimeError(f"Replicate create returned unexpected payload: {data}")
            return data

    raise RuntimeError(f"Replicate create failed ({last_status}) tried={tried}: {last_data}")


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


def _env_int(name: str, default: int) -> int:
    try:
        v = int(str(os.getenv(name) or "").strip() or default)
        return v
    except Exception:
        return int(default)


def _env_float(name: str, default: float) -> float:
    try:
        v = float(str(os.getenv(name) or "").strip() or default)
        return v
    except Exception:
        return float(default)


# Process-local TTL cache for option images (prompt -> URL).
_OPTION_IMAGES_CACHE: dict[str, Tuple[float, str]] = {}
_OPTION_IMAGES_CACHE_LOCK = Lock()


def _option_images_cache_get(key: str) -> Optional[str]:
    now = time.time()
    with _OPTION_IMAGES_CACHE_LOCK:
        v = _OPTION_IMAGES_CACHE.get(key)
        if not v:
            return None
        expires_at, url = v
        if expires_at < now:
            _OPTION_IMAGES_CACHE.pop(key, None)
            return None
        return url


def _option_images_cache_set(key: str, url: str, *, ttl_sec: int) -> None:
    if not key or not url:
        return
    ttl = max(0, int(ttl_sec or 0))
    if ttl <= 0:
        return
    with _OPTION_IMAGES_CACHE_LOCK:
        _OPTION_IMAGES_CACHE[key] = (time.time() + ttl, url)


# Best-effort pacing across threads (process-local).
_OPTION_IMAGES_RATE_LOCK = Lock()
_OPTION_IMAGES_NEXT_ALLOWED_TS: float = 0.0


def _option_images_rate_limit_wait(qps: float) -> None:
    qps_f = float(qps or 0)
    if qps_f <= 0:
        return
    interval = 1.0 / max(0.1, qps_f)
    while True:
        with _OPTION_IMAGES_RATE_LOCK:
            now = time.time()
            wait_s = _OPTION_IMAGES_NEXT_ALLOWED_TS - now
            if wait_s <= 0:
                _OPTION_IMAGES_NEXT_ALLOWED_TS = now + interval
                return
        time.sleep(min(0.25, max(0.0, wait_s)))


def _option_images_placeholder_enabled() -> bool:
    return str(os.getenv("AI_FORM_OPTION_IMAGES_PLACEHOLDER_ON_FAIL") or "").strip().lower() in {"1", "true", "yes", "y", "on"}


def _truncate_log_value(value: Any, *, limit: int = 240) -> str:
    text = str(value or "").strip()
    if len(text) > limit:
        return text[:limit] + "..."
    return text


def _prediction_error_message(payload: Any) -> str:
    if not isinstance(payload, dict):
        return ""

    for key in ("error", "detail", "message"):
        value = payload.get(key)
        if isinstance(value, str) and value.strip():
            return value.strip()
        if isinstance(value, dict):
            nested = _prediction_error_message(value)
            if nested:
                return nested
        if isinstance(value, list):
            for item in value:
                nested = _prediction_error_message(item)
                if nested:
                    return nested
    return ""


def _log_option_image_failure(*, idx: int, model: str, prompt: str, reason: str, prediction: Optional[Dict[str, Any]] = None) -> None:
    pred = prediction if isinstance(prediction, dict) else {}
    prediction_id = _truncate_log_value(pred.get("id") or "")
    status = _truncate_log_value(pred.get("status") or "")
    error = _truncate_log_value(_prediction_error_message(pred) or reason or "unknown_error", limit=400)
    prompt_preview = _truncate_log_value(prompt, limit=160)
    print(
        f"[option_images] failed idx={idx} model={model} prediction_id={prediction_id or '-'} "
        f"status={status or '-'} err={error} prompt={prompt_preview}",
        flush=True,
    )


def _placeholder_image_data_url(*, seed: int, width: int = 512, height: int = 384) -> str:
    """
    Local fallback thumbnail (no external calls).

    This intentionally contains no text; the UI overlays the option label.
    """
    # Deterministic palette from seed.
    def _c(x: int) -> str:
        return f"#{(x & 0xFFFFFF):06x}"

    a = (seed * 2654435761) & 0xFFFFFFFF
    b = (a * 1103515245 + 12345) & 0xFFFFFFFF
    c = (b * 1103515245 + 12345) & 0xFFFFFFFF
    c1 = _c(a)
    c2 = _c(b)
    c3 = _c(c)

    svg = f"""<svg xmlns="http://www.w3.org/2000/svg" width="{width}" height="{height}" viewBox="0 0 {width} {height}">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="{c1}"/>
      <stop offset="55%" stop-color="{c2}"/>
      <stop offset="100%" stop-color="{c3}"/>
    </linearGradient>
    <filter id="blur" x="-20%" y="-20%" width="140%" height="140%">
      <feGaussianBlur stdDeviation="18"/>
    </filter>
  </defs>
  <rect width="{width}" height="{height}" fill="url(#g)"/>
  <g opacity="0.28" filter="url(#blur)">
    <circle cx="{int(width*0.28)}" cy="{int(height*0.35)}" r="{int(min(width,height)*0.22)}" fill="{c3}"/>
    <circle cx="{int(width*0.72)}" cy="{int(height*0.55)}" r="{int(min(width,height)*0.26)}" fill="{c1}"/>
  </g>
  <rect x="16" y="16" width="{width-32}" height="{height-32}" rx="28" fill="none" stroke="rgba(255,255,255,0.22)" stroke-width="2"/>
</svg>"""
    b64 = base64.b64encode(svg.encode("utf-8")).decode("ascii")
    return f"data:image/svg+xml;base64,{b64}"


def _option_images_model_id() -> str:
    """Model for option-image generation (flux-schnell); does not use use_case."""
    m = str(os.getenv("REPLICATE_OPTION_IMAGES_MODEL_ID") or "").strip()
    return m or "black-forest-labs/flux-schnell"


def _option_image_inference_steps(model_id: str) -> int:
    configured = _env_int("AI_FORM_OPTION_IMAGES_INFERENCE_STEPS", 4)
    if _is_flux_schnell_model(model_id):
        return max(1, min(4, configured))
    return max(1, configured)


def generate_option_images_for_step(
    prompts: List[str],
    *,
    model_id: Optional[str] = None,
    seed_base: Optional[str] = None,
) -> Tuple[List[Optional[str]], Dict[str, int]]:
    """
    Generate one image per prompt for multiple-choice option images.
    Uses flux-schnell; runs one Replicate call per prompt in parallel (up to 24)
    so 10-20 option style grids return quickly. Returns list of image URLs in same order as prompts
    (None for failures so caller can leave option without imageUrl).
    """
    if not prompts:
        return ([], {"optionsTotal": 0, "optionsAttempted": 0, "cacheHits": 0, "succeeded": 0, "failed": 0})
    model = str(model_id or "").strip() or _option_images_model_id()
    timeout_sec = float(os.getenv("REPLICATE_TIMEOUT_SEC") or "60")
    seed_base_s = str(seed_base or "").strip()
    results: List[Optional[str]] = [None] * len(prompts)
    stats: Dict[str, int] = {
        "optionsTotal": int(len(prompts)),
        "optionsAttempted": 0,
        "cacheHits": 0,
        "succeeded": 0,
        "failed": 0,
    }

    max_conc = max(1, min(24, _env_int("AI_FORM_OPTION_IMAGES_MAX_CONCURRENCY", 24)))
    qps = _env_float("AI_FORM_OPTION_IMAGES_QPS", 0.0)
    cache_ttl = max(0, _env_int("AI_FORM_OPTION_IMAGES_CACHE_TTL_SEC", 900))
    def _seed_for_prompt(prompt: str) -> Optional[int]:
        """
        Deterministic seed for option thumbnails.

        We only apply this when a seed_base is provided (typically includes session_id + model/version),
        so thumbnails remain stable within a session and shift predictably when the model changes.
        """
        if not seed_base_s:
            return None
        try:
            import hashlib

            h = hashlib.sha256(f"{seed_base_s}|{prompt}".encode("utf-8")).digest()
            # Replicate seeds are typically 32-bit ints; keep it in-range.
            return int.from_bytes(h[:4], "big", signed=False)
        except Exception:
            return None

    def _run_one(idx: int, prompt: str) -> tuple[int, Optional[str], bool]:
        prompt = str(prompt or "").strip()
        if not prompt:
            return idx, None, False
        seed = _seed_for_prompt(prompt)
        # Cache must include model/version and seed so results are stable within a session
        # but not incorrectly shared across sessions.
        cache_key = f"{model}::1:1::4::webp::seed={seed if seed is not None else 'none'}::{prompt}"
        cached = _option_images_cache_get(cache_key)
        if cached:
            return idx, cached, True

        _option_images_rate_limit_wait(qps)
        inp: Dict[str, Any] = {
            "prompt": prompt,
            "num_outputs": 1,
            "aspect_ratio": "1:1",
            "num_inference_steps": _option_image_inference_steps(model),
            "output_format": "webp",
            "disable_safety_checker": False,
        }
        if seed is not None:
            inp["seed"] = seed
        try:
            created = _replicate_create_prediction(model_id=model, input=inp)
            pred_id = str(created.get("id") or "")
            status = str(created.get("status") or "").lower()
            output = created.get("output")
            urls = _normalize_replicate_output_to_urls(output)
            final = created
            if not urls and status not in {"succeeded", "failed", "canceled"}:
                final = _replicate_wait_for_completion(pred_id, timeout_sec=timeout_sec)
                status = str(final.get("status") or "").lower()
                urls = _normalize_replicate_output_to_urls(final.get("output"))
            url0 = urls[0] if urls else None
            if url0:
                _option_images_cache_set(cache_key, url0, ttl_sec=cache_ttl)
            else:
                reason = "prediction returned no image URL"
                if status in {"failed", "canceled", "timeout"}:
                    reason = f"prediction {status}"
                _log_option_image_failure(
                    idx=idx,
                    model=model,
                    prediction=final,
                    prompt=prompt,
                    reason=reason,
                )
            return idx, url0, False
        except Exception as e:
            if _option_images_placeholder_enabled():
                try:
                    import hashlib

                    seed_fallback = seed if seed is not None else int.from_bytes(
                        hashlib.sha256(f"{seed_base_s}|{idx}|{prompt}".encode("utf-8")).digest()[:4],
                        "big",
                        signed=False,
                    )
                    return idx, _placeholder_image_data_url(seed=seed_fallback), False
                except Exception:
                    # Fall through to normal error handling
                    pass
            try:
                msg = str(e)[:400]
            except Exception:
                msg = "unknown_error"
            _log_option_image_failure(
                idx=idx,
                model=model,
                prompt=prompt,
                reason=msg,
            )
            return idx, None, False

    with ThreadPoolExecutor(max_workers=min(len(prompts), max_conc)) as executor:
        futures = {executor.submit(_run_one, i, p): i for i, p in enumerate(prompts)}
        for fut in as_completed(futures):
            idx, url, was_cache = fut.result()
            results[idx] = url
            stats["optionsAttempted"] += 1
            if url:
                if was_cache:
                    stats["cacheHits"] += 1
                stats["succeeded"] += 1
            else:
                stats["failed"] += 1

    return results, stats


def _normalize_replicate_output_to_urls(output: Any) -> List[str]:
    # Replicate commonly returns either:
    # - a string URL
    # - an array of string URLs
    # - (rarely) objects; keep only string-ish values
    if output is None:
        return []
    if isinstance(output, str):
        s = output.strip()
        return [s] if s else []
    if isinstance(output, list):
        out: List[str] = []
        for item in output:
            if isinstance(item, str) and item.strip():
                out.append(item.strip())
            elif isinstance(item, dict):
                # Best-effort: some models may return { url: "..." }
                u = item.get("url") if isinstance(item.get("url"), str) else None
                if u and u.strip():
                    out.append(u.strip())
        return out
    return []


def generate_images(
    *,
    prompt: str,
    num_outputs: int = 1,
    output_format: str = "url",
    model_id: Optional[str] = None,
    use_case: Optional[str] = None,
    negative_prompt: Optional[str] = None,
    aspect_ratio: Optional[str] = None,
    width: Optional[int] = None,
    height: Optional[int] = None,
    num_inference_steps: Optional[int] = None,
    guidance_scale: Optional[float] = None,
    prompt_strength: Optional[float] = None,
    image_prompt_strength: Optional[float] = None,
    safety_tolerance: Optional[int] = None,
    prompt_upsampling: Optional[bool] = None,
    go_fast: Optional[bool] = None,
    reference_images: Optional[List[str]] = None,
    scene_image: Optional[str] = None,
    product_image: Optional[str] = None,
) -> Dict[str, Any]:
    n = max(1, min(9, int(num_outputs or 1)))
    prompt = str(prompt or "").strip()

    model = str(model_id or "").strip() or _replicate_default_model_id(use_case=use_case)
    timeout_sec = float(os.getenv("REPLICATE_TIMEOUT_SEC") or "60")
    ratio = str(aspect_ratio or "").strip() or _derive_aspect_ratio(width, height) or None
    primary_reference = next((x for x in (reference_images or []) if isinstance(x, str) and x.strip()), None)
    primary_edit_image = (
        scene_image.strip()
        if isinstance(scene_image, str) and scene_image.strip()
        else (primary_reference.strip() if isinstance(primary_reference, str) and primary_reference.strip() else None)
    )

    # Minimal cross-model input. Replicate models differ; some reject unknown keys.
    # Build a strict payload for known strict schemas, otherwise use broad compatibility keys.
    if _is_grok_imagine_image_model(model):
        # xai/grok-imagine-image schema:
        # - prompt (required)
        # - image (optional; when present, model edits/inpaints)
        # - aspect_ratio (optional; ignored in edit mode)
        inp: Dict[str, Any] = {"prompt": prompt}
        edit_image: Optional[str] = None
        if isinstance(scene_image, str) and scene_image.strip():
            edit_image = scene_image.strip()
        elif reference_images and isinstance(reference_images, list):
            edit_image = next((x for x in reference_images if isinstance(x, str) and x.strip()), None)
        if edit_image:
            inp["image"] = edit_image
        else:
            ratio = _derive_aspect_ratio(width, height)
            if ratio:
                inp["aspect_ratio"] = ratio
    elif _is_flux_schnell_model(model):
        inp = {
            "prompt": prompt,
            "num_outputs": max(1, min(4, n)),
            "aspect_ratio": ratio or "1:1",
            "num_inference_steps": max(1, min(4, int(num_inference_steps or 4))),
            "output_format": str(output_format or "webp").strip() or "webp",
            "disable_safety_checker": False,
        }
        if isinstance(go_fast, bool):
            inp["go_fast"] = go_fast
    elif _is_flux_kontext_model(model):
        inp = {"prompt": prompt}
        if primary_edit_image:
            inp["input_image"] = primary_edit_image
        if ratio and not primary_edit_image:
            inp["aspect_ratio"] = ratio
        if isinstance(safety_tolerance, int) and safety_tolerance > 0:
            inp["safety_tolerance"] = safety_tolerance
        if isinstance(prompt_upsampling, bool):
            inp["prompt_upsampling"] = prompt_upsampling
        fmt = str(output_format or "").strip()
        if fmt:
            inp["output_format"] = fmt
    elif _is_flux_1_1_pro_model(model):
        inp = {"prompt": prompt}
        inp["num_outputs"] = max(1, min(4, n))
        if ratio:
            inp["aspect_ratio"] = ratio
        if ratio == "custom":
            if isinstance(width, int) and width > 0:
                inp["width"] = width
            if isinstance(height, int) and height > 0:
                inp["height"] = height
        if isinstance(safety_tolerance, int) and safety_tolerance > 0:
            inp["safety_tolerance"] = safety_tolerance
        if isinstance(prompt_upsampling, bool):
            inp["prompt_upsampling"] = prompt_upsampling
        fmt = str(output_format or "").strip()
        if fmt:
            inp["output_format"] = fmt
    else:
        inp = {"prompt": prompt}
        inp["num_outputs"] = n
        if negative_prompt and str(negative_prompt).strip():
            inp["negative_prompt"] = str(negative_prompt).strip()
        if ratio:
            inp["aspect_ratio"] = ratio
        if isinstance(width, int) and width > 0:
            inp["width"] = width
        if isinstance(height, int) and height > 0:
            inp["height"] = height
        if isinstance(num_inference_steps, int) and num_inference_steps > 0:
            inp["num_inference_steps"] = num_inference_steps
        if isinstance(guidance_scale, (int, float)) and float(guidance_scale) > 0:
            inp["guidance_scale"] = float(guidance_scale)
        if isinstance(prompt_strength, (int, float)) and float(prompt_strength) > 0:
            inp["prompt_strength"] = float(prompt_strength)
        if isinstance(image_prompt_strength, (int, float)) and float(image_prompt_strength) > 0:
            inp["image_prompt_strength"] = float(image_prompt_strength)
        if isinstance(safety_tolerance, int) and safety_tolerance > 0:
            inp["safety_tolerance"] = safety_tolerance
        if isinstance(prompt_upsampling, bool):
            inp["prompt_upsampling"] = prompt_upsampling
        if isinstance(go_fast, bool):
            inp["go_fast"] = go_fast
        if reference_images and isinstance(reference_images, list) and reference_images:
            # Some models expect `image` or `input_image`.
            first = next((x for x in reference_images if isinstance(x, str) and x.strip()), None)
            if first:
                inp["image"] = first
                inp["input_image"] = first

        # Scene-placement / multi-image best-effort for non-grok models.
        if isinstance(scene_image, str) and scene_image.strip():
            scene_u = scene_image.strip()
            inp.setdefault("image", scene_u)
            inp.setdefault("input_image", scene_u)
            inp["scene_image"] = scene_u
            inp["background_image"] = scene_u
        if isinstance(product_image, str) and product_image.strip():
            prod_u = product_image.strip()
            inp["product_image"] = prod_u
            inp["subject_image"] = prod_u
            inp["overlay_image"] = prod_u

    _log_provider("replicate_request_payload", inp)
    created = _replicate_create_prediction(model_id=model, input=inp)
    prediction_id = str(created.get("id") or "")
    status = str(created.get("status") or "")
    output = created.get("output")
    urls = _normalize_replicate_output_to_urls(output)
    final = created

    # If output isn't ready yet, poll.
    if not urls and str(status).lower() not in {"succeeded", "failed", "canceled"}:
        final = _replicate_wait_for_completion(prediction_id, timeout_sec=timeout_sec)
        status = str(final.get("status") or status)
        # keep polling result in `final`

    # Pass through the raw Replicate prediction response (exact shape from Replicate API),
    # so callers can read `id`, `status`, `output`, `input`, etc.
    response_payload = final if isinstance(final, dict) else {"status": "failed", "error": "Invalid Replicate response"}
    _log_provider("replicate_response_payload", response_payload)
    return response_payload
