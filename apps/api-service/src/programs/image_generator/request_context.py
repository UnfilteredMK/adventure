from __future__ import annotations

import json
import re
from typing import Any, Dict, Iterable, List, Optional, Tuple


_UUID_RE = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$", re.IGNORECASE)
_URL_RE = re.compile(r"^https?://", re.IGNORECASE)


def _coerce_text(raw: Any) -> str:
    if raw is None:
        return ""
    if isinstance(raw, (dict, list)):
        try:
            return json.dumps(raw, ensure_ascii=True, separators=(",", ":"))
        except Exception:
            return str(raw)
    return str(raw)


def _looks_like_uuid(text: str) -> bool:
    t = str(text or "").strip()
    return bool(t and _UUID_RE.match(t))


def _looks_like_url(text: str) -> bool:
    t = str(text or "").strip()
    return bool(t and _URL_RE.match(t))


def _is_uuid_list(raw: Any) -> bool:
    if not isinstance(raw, list) or not raw:
        return False
    items = [str(x or "").strip() for x in raw]
    items = [x for x in items if x]
    return bool(items) and all(_looks_like_uuid(x) for x in items)


def _collect_http_urls_with_paths(
    raw: Any,
    *,
    path: str = "",
    out: Optional[List[Tuple[str, str]]] = None,
    depth: int = 0,
) -> List[Tuple[str, str]]:
    acc = out if out is not None else []
    if depth > 5:
        return acc
    if isinstance(raw, str):
        s = raw.strip()
        if _looks_like_url(s):
            acc.append((path or "", s))
        return acc
    if isinstance(raw, list):
        for i, item in enumerate(raw):
            _collect_http_urls_with_paths(
                item,
                path=f"{path}[{i}]" if path else f"[{i}]",
                out=acc,
                depth=depth + 1,
            )
        return acc
    if isinstance(raw, dict):
        for k, v in raw.items():
            key = str(k or "").strip()
            child_path = f"{path}.{key}" if path else key
            _collect_http_urls_with_paths(v, path=child_path, out=acc, depth=depth + 1)
        return acc
    return acc


def _dedupe_keep_order(urls: Iterable[str]) -> List[str]:
    out: List[str] = []
    seen: set[str] = set()
    for u in urls:
        s = str(u or "").strip()
        if not s or s in seen:
            continue
        out.append(s)
        seen.add(s)
    return out


def _extract_contextual_reference_urls(payload: Dict[str, Any]) -> List[str]:
    step_data = payload.get("stepDataSoFar") or payload.get("step_data_so_far") or {}
    if not isinstance(step_data, dict):
        step_data = {}
    answered_qa = payload.get("answeredQA") or payload.get("answered_qa") or []

    pairs: List[Tuple[str, str]] = []
    _collect_http_urls_with_paths(step_data, path="stepDataSoFar", out=pairs)
    _collect_http_urls_with_paths(answered_qa, path="answeredQA", out=pairs)
    if not pairs:
        return []

    hints = (
        "image",
        "upload",
        "photo",
        "reference",
        "inspiration",
        "scene",
        "product",
        "selected",
        "gallery",
        "thumb",
    )
    high: List[str] = []
    low: List[str] = []
    for src_path, url in pairs:
        p = str(src_path or "").lower()
        if any(h in p for h in hints):
            high.append(url)
        else:
            low.append(url)
    return _dedupe_keep_order([*high, *low])


def extract_reference_images(payload: Dict[str, Any]) -> Tuple[List[str], Optional[str], Optional[str]]:
    selected_image = payload.get("selectedImage") or payload.get("selected_image")
    user_image = payload.get("userImage") or payload.get("user_image")
    scene_image = payload.get("sceneImage") or payload.get("scene_image")
    product_image = payload.get("productImage") or payload.get("product_image")

    selected = str(selected_image).strip() if isinstance(selected_image, str) and selected_image.strip() else None
    user = str(user_image).strip() if isinstance(user_image, str) and user_image.strip() else None
    scene = str(scene_image).strip() if isinstance(scene_image, str) and scene_image.strip() else None
    product = str(product_image).strip() if isinstance(product_image, str) and product_image.strip() else None

    ref_raw = payload.get("referenceImages") or payload.get("reference_images") or []
    refs: List[str] = []
    if isinstance(ref_raw, list):
        refs = [str(x).strip() for x in ref_raw if isinstance(x, str) and str(x).strip()]

    contextual_refs = _extract_contextual_reference_urls(payload)
    ordered = _dedupe_keep_order([selected or "", user or "", scene or "", product or "", *refs, *contextual_refs])
    return ordered[:8], scene, product


def extract_negative_prompt(payload: Dict[str, Any]) -> str:
    raw = payload.get("negativePrompt") or payload.get("negative_prompt") or ""
    text = _coerce_text(raw).strip()
    text = " ".join(text.split())
    return text[:480]


def reference_mode(payload: Dict[str, Any]) -> str:
    return str(payload.get("referenceMode") or payload.get("reference_mode") or "").strip().lower()


def is_guide_only_style_refs(payload: Dict[str, Any]) -> bool:
    return reference_mode(payload) == "guide_only"


def has_explicit_anchor_image(payload: Dict[str, Any]) -> bool:
    for key in (
        "selectedImage",
        "selected_image",
        "userImage",
        "user_image",
        "sceneImage",
        "scene_image",
        "productImage",
        "product_image",
    ):
        v = payload.get(key)
        if isinstance(v, str) and v.strip():
            return True
    return False


def is_anchor_edit_for_prompt(payload: Dict[str, Any]) -> bool:
    """True when prompts should treat the request as an image-to-image edit anchored on a photo."""
    if is_guide_only_style_refs(payload) and not has_explicit_anchor_image(payload):
        return False
    reference_images, _, _ = extract_reference_images(payload)
    return len(reference_images) > 0


def provider_image_inputs(payload: Dict[str, Any]) -> Tuple[List[str], Optional[str], Optional[str]]:
    """Reference images passed to the image provider (omit for guide-only style URLs)."""
    reference_images, scene_image, product_image = extract_reference_images(payload)
    if is_guide_only_style_refs(payload) and not has_explicit_anchor_image(payload):
        return [], None, None
    return reference_images, scene_image, product_image


__all__ = [
    "extract_negative_prompt",
    "extract_reference_images",
    "has_explicit_anchor_image",
    "is_anchor_edit_for_prompt",
    "is_guide_only_style_refs",
    "provider_image_inputs",
    "reference_mode",
]
