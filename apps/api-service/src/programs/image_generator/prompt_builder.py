from __future__ import annotations

import json
import re
from typing import Any, Dict, Iterable, List, Optional, Tuple

from programs.common.visual_text_safety import (
    ANTI_COMPARISON_NEGATIVE_TERMS,
    SINGLE_SCENE_GUARDRAIL,
    sanitize_visual_context_text,
)


_UUID_RE = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$", re.IGNORECASE)
_URL_RE = re.compile(r"^https?://", re.IGNORECASE)
_SERVICE_FROM_SUMMARY_RE = re.compile(r"^(.{3,96}?)\s+is\s+(?:an?\s+)?service\b", re.IGNORECASE)
_SERVICE_LABEL_RE = re.compile(r"\bService:\s*([^\.\n]{3,140})", re.IGNORECASE)


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


def _string_is_json_uuid_list(text: str) -> bool:
    t = str(text or "").strip()
    if not (t.startswith("[") and t.endswith("]")):
        return False
    try:
        parsed = json.loads(t)
    except Exception:
        return False
    return _is_uuid_list(parsed)


def _service_name_from_summary(text: str) -> str:
    """
    Attempt to extract a short service name from common summary formats.
    Examples:
      - "Bathroom remodeling is a service where ..." -> "Bathroom remodeling"
      - "Industry: Bathroom Remodeling. Service: Guest bath refresh." -> "Guest bath refresh"
    """
    t = str(text or "").strip()
    if not t:
        return ""
    m = _SERVICE_LABEL_RE.search(t)
    if m:
        return m.group(1).strip()
    m = _SERVICE_FROM_SUMMARY_RE.match(t)
    if m:
        return m.group(1).strip()
    return ""


def _normalize_use_case(raw: Any) -> str:
    t = str(raw or "").strip().lower().replace("_", "-")
    if t in {"tryon", "try-on"}:
        return "tryon"
    if t in {"scene", "scene-placement"}:
        return t
    return t


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


def _collect_http_urls_with_paths(raw: Any, *, path: str = "", out: Optional[List[Tuple[str, str]]] = None, depth: int = 0) -> List[Tuple[str, str]]:
    """
    Recursively collect HTTP(S) URLs from nested payload structures.
    Returns tuples of (source_path, url) for lightweight prioritization.
    """
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
            _collect_http_urls_with_paths(item, path=f"{path}[{i}]" if path else f"[{i}]", out=acc, depth=depth + 1)
        return acc
    if isinstance(raw, dict):
        for k, v in raw.items():
            key = str(k or "").strip()
            child_path = f"{path}.{key}" if path else key
            _collect_http_urls_with_paths(v, path=child_path, out=acc, depth=depth + 1)
        return acc
    return acc


def _extract_contextual_reference_urls(payload: Dict[str, Any]) -> List[str]:
    """
    Mine additional reference image URLs from nested request context:
    - stepDataSoFar (uploads, selected options, image-like answers)
    - answeredQA / answered_qa
    Prioritize URL paths that look image-related.
    """
    step_data = payload.get("stepDataSoFar") or payload.get("step_data_so_far") or {}
    if not isinstance(step_data, dict):
        step_data = {}
    answered_qa = payload.get("answeredQA") or payload.get("answered_qa") or []

    pairs: List[Tuple[str, str]] = []
    _collect_http_urls_with_paths(step_data, path="stepDataSoFar", out=pairs)
    _collect_http_urls_with_paths(answered_qa, path="answeredQA", out=pairs)

    if not pairs:
        return []

    # Give higher priority to URLs whose source path suggests image/upload context.
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
    """
    Normalize reference images across request shapes.

    Returns:
      - `reference_images[]` (deduped, ordered)
      - `scene_image` (best-effort)
      - `product_image` (best-effort)
    """
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

    # Prefer explicit focal images first, then declared refs, then mined contextual refs.
    ordered = _dedupe_keep_order([selected or "", user or "", scene or "", product or "", *refs, *contextual_refs])
    # Allow a richer reference set while still capping to avoid muddy edits.
    return ordered[:8], scene, product


def extract_negative_prompt(payload: Dict[str, Any]) -> str:
    raw = payload.get("negativePrompt") or payload.get("negative_prompt") or ""
    t = _coerce_text(raw).strip()
    t = " ".join(t.split())  # collapse whitespace/newlines
    return t[:480]


def _extract_step_data(payload: Dict[str, Any]) -> Dict[str, Any]:
    raw = payload.get("stepDataSoFar") or payload.get("step_data_so_far") or {}
    return raw if isinstance(raw, dict) else {}


def _extract_style_tags(step_data: Dict[str, Any]) -> List[str]:
    raw = step_data.get("style")
    tags: List[str] = []
    if isinstance(raw, list):
        for x in raw:
            t = str(x or "").strip()
            if t:
                tags.append(t[:48])
    elif isinstance(raw, str):
        for part in raw.split(","):
            t = part.strip()
            if t:
                tags.append(t[:48])
    # de-dupe while preserving order
    out: List[str] = []
    seen: set[str] = set()
    for t in tags:
        k = t.lower()
        if k in seen:
            continue
        out.append(t)
        seen.add(k)
    return out[:12]


def _best_effort_service(step_data: Dict[str, Any], payload: Dict[str, Any]) -> str:
    def _extract_service_id() -> str:
        for k in ("service_primary", "step-service-primary", "service"):
            raw = step_data.get(k)
            if isinstance(raw, str):
                s = raw.strip()
                if _looks_like_uuid(s):
                    return s
                if _string_is_json_uuid_list(s):
                    try:
                        parsed = json.loads(s)
                    except Exception:
                        continue
                    if isinstance(parsed, list):
                        for x in parsed:
                            xs = str(x or "").strip()
                            if _looks_like_uuid(xs):
                                return xs
            if isinstance(raw, list):
                for x in raw:
                    xs = str(x or "").strip()
                    if _looks_like_uuid(xs):
                        return xs
        return ""

    def _instance_context_service_name() -> str:
        ctx = payload.get("instanceContext") if isinstance(payload.get("instanceContext"), dict) else None
        if not ctx and isinstance(payload.get("instance_context"), dict):
            ctx = payload.get("instance_context")
        if isinstance(ctx, dict):
            svc = ctx.get("service")
            if isinstance(svc, dict):
                name = str(svc.get("name") or svc.get("label") or "").strip()
                if name:
                    return name

            # If we have a service id and an id->summary mapping, derive a name from that summary.
            summaries = ctx.get("serviceSummariesBySubcategoryId") or ctx.get("service_summaries_by_subcategory_id")
            if isinstance(summaries, dict):
                service_id = _extract_service_id()
                if service_id:
                    summary = summaries.get(service_id)
                    if isinstance(summary, str) and summary.strip():
                        derived = _service_name_from_summary(summary)
                        if derived:
                            return derived

            # Back-compat: sometimes a single summary is present; derive a name from it.
            for k in ("serviceSummary", "service_summary", "services_summary", "servicesSummary"):
                v = ctx.get(k)
                if isinstance(v, str) and v.strip():
                    derived = _service_name_from_summary(v)
                    if derived:
                        return derived

            # Back-compat: sometimes `subcategories[]` exists.
            subs = ctx.get("subcategories")
            if isinstance(subs, list) and subs:
                first = subs[0]
                if isinstance(first, dict):
                    name = str(first.get("name") or first.get("label") or "").strip()
                    if name:
                        return name
                name = str(first or "").strip()
                if name and not _looks_like_uuid(name):
                    return name
        return ""

    def _step_service_primary_text() -> str:
        for k in ("step-service-primary", "service_primary", "service"):
            raw = step_data.get(k)
            if isinstance(raw, dict):
                name = str(raw.get("name") or raw.get("label") or "").strip()
                if name:
                    return name
                continue
            if isinstance(raw, list):
                # Many widgets store this as an array of service IDs; ignore if it's purely ids.
                if _is_uuid_list(raw):
                    continue
                parts: List[str] = []
                for x in raw:
                    t = str(x or "").strip()
                    if not t or _looks_like_uuid(t):
                        continue
                    parts.append(t)
                if parts:
                    return ", ".join(parts)
                continue
            if isinstance(raw, str) and _string_is_json_uuid_list(raw):
                continue
            t = _coerce_text(raw).strip()
            if t and not _looks_like_uuid(t):
                return t
        return ""

    # Prefer explicit human labels over ids.
    candidates = [
        _instance_context_service_name(),
        _step_service_primary_text(),
        payload.get("service"),
        payload.get("serviceSummary"),
        payload.get("service_summary"),
        payload.get("servicesSummary"),
        payload.get("services_summary"),
    ]
    for c in candidates:
        if isinstance(c, dict):
            name = str(c.get("name") or c.get("label") or "").strip()
            if name and not _looks_like_uuid(name):
                return name
            continue
        if _is_uuid_list(c):
            continue
        t = _coerce_text(c).strip()
        if not t:
            continue
        if _looks_like_uuid(t):
            continue
        if _string_is_json_uuid_list(t):
            continue
        derived = _service_name_from_summary(t)
        if derived:
            return derived
        # If caller passed a verbose summary, keep it but cap later.
        return t
    return ""


def _extract_location(step_data: Dict[str, Any]) -> str:
    city = step_data.get("location_city") or step_data.get("locationCity") or ""
    state = step_data.get("location_state") or step_data.get("locationState") or ""
    c = str(city or "").strip()
    s = str(state or "").strip()
    if c and s:
        return f"{c}, {s}"
    return c or s


_INTERNAL_KEY_PREFIXES = ("collect_context", "step-service", "service_primary")


def _kv_details(step_data: Dict[str, Any], *, skip_keys: set[str]) -> List[str]:
    """
    Best-effort: include a few extra answers as compact detail lines.
    Filters out UUIDs, URLs, and internal keys that are not useful for image prompts.
    """
    out: List[str] = []
    for k, v in step_data.items():
        if k in skip_keys:
            continue
        key = str(k or "").strip()
        if not key:
            continue
        if any(key.startswith(p) for p in _INTERNAL_KEY_PREFIXES):
            continue
        val = sanitize_visual_context_text(_coerce_text(v))
        if not val:
            continue
        if _looks_like_uuid(val):
            continue
        if _looks_like_url(val):
            continue
        if _string_is_json_uuid_list(val):
            continue
        if len(val) > 140:
            val = val[:140].rstrip() + "…"
        out.append(f"{key}: {val}")
        if len(out) >= 10:
            break
    return out


def _format_budget(raw: str) -> str:
    b = raw.strip()
    try:
        n = int(float(b))
        if n > 0:
            if n >= 1000:
                b = f"~${round(n / 1000):d}k"
            else:
                b = f"~${n:d}"
    except Exception:
        pass
    return b[:80]


def _budget_material_descriptor(budget_raw: str) -> str:
    """Return a concrete material/finish descriptor based on numeric budget amount.

    This ensures generated images show materials that actually match the user's
    price point rather than always defaulting to luxury aesthetics.
    """
    try:
        n = int(float(budget_raw.strip()))
    except Exception:
        return ""
    if n <= 0:
        return ""
    if n < 10_000:
        return (
            "Use budget-friendly, builder-grade materials: vinyl or laminate flooring, "
            "stock cabinetry, basic fixtures, standard paint. No marble, no custom millwork."
        )
    if n < 30_000:
        return (
            "Use mid-range materials: engineered hardwood or luxury vinyl plank, "
            "quartz countertops, semi-custom cabinetry, mid-range fixtures."
        )
    if n < 70_000:
        return (
            "Use premium materials: solid hardwood, natural stone countertops, "
            "custom cabinetry, high-end fixtures, designer lighting."
        )
    return (
        "Use luxury materials: marble or Calacatta stone, bespoke custom millwork, "
        "wide-plank hardwood, high-end appliances, designer fixtures throughout."
    )


_DEFAULT_NEGATIVE = (
    "blurry text, watermark, logo, letters, words, writing, signage, "
    f"cartoon, anime, painting, illustration, low quality, deformed, {ANTI_COMPARISON_NEGATIVE_TERMS}"
)

_SKIP_KEYS = frozenset({
    "step-service-primary",
    "service_primary",
    "service",
    "location_city",
    "locationCity",
    "location_state",
    "locationState",
    "style",
    "notes",
    "budget_range",
    "budgetRange",
    "step-budget-range",
    "step-budget",
    "timeline",
})


def _merge_negative_prompt(primary: str, fallback: str) -> str:
    parts: List[str] = []
    seen: set[str] = set()
    for raw in (primary, fallback):
        for item in str(raw or "").split(","):
            token = item.strip()
            key = token.lower()
            if not token or key in seen:
                continue
            seen.add(key)
            parts.append(token)
    return ", ".join(parts)


def _extract_answered_qa(payload: Dict[str, Any]) -> List[Dict[str, str]]:
    """Pull question/answer pairs from the answeredQA array if present."""
    raw = payload.get("answeredQA") or payload.get("answered_qa") or []
    if not isinstance(raw, list):
        return []
    out: List[Dict[str, str]] = []
    for item in raw:
        if not isinstance(item, dict):
            continue
        q = sanitize_visual_context_text(item.get("question") or "", max_len=140)
        a = item.get("answer")
        a_text = ""
        if isinstance(a, list):
            parts = [
                sanitize_visual_context_text(str(x).strip(), max_len=140)
                for x in a
                if str(x).strip() and not _looks_like_uuid(str(x)) and not _looks_like_url(str(x))
            ]
            a_text = ", ".join(parts)
        elif isinstance(a, str):
            t = sanitize_visual_context_text(a, max_len=200)
            if not _looks_like_uuid(t) and not _looks_like_url(t):
                a_text = t
        if q and a_text:
            out.append({"question": q, "answer": a_text})
    return out


def _extract_service_summary(payload: Dict[str, Any]) -> str:
    """Pull the service_summary from instanceContext (or root-level fallback)."""
    ctx = payload.get("instanceContext") or payload.get("instance_context") or {}
    if isinstance(ctx, dict):
        for k in ("serviceSummary", "service_summary", "services_summary", "servicesSummary"):
            v = ctx.get(k)
            if isinstance(v, str) and v.strip():
                return v.strip()[:600]
    for k in ("serviceSummary", "service_summary"):
        v = payload.get(k)
        if isinstance(v, str) and v.strip():
            return v.strip()[:600]
    return ""


def build_image_prompt_text(payload: Dict[str, Any]) -> Dict[str, Any]:
    """
    Deterministically build a high-quality prompt from `stepDataSoFar` + reference images.

    Produces edit-style imperatives when reference images are present (Kontext editing),
    and descriptive generation prompts when no input image exists (text-to-image).

    Returns an object shaped like ImagePromptSpec (by alias names).
    """
    step_data = _extract_step_data(payload)
    use_case = _normalize_use_case(payload.get("useCase") or payload.get("use_case"))
    reference_images, scene_image, product_image = extract_reference_images(payload)
    negative_prompt = _merge_negative_prompt(extract_negative_prompt(payload), _DEFAULT_NEGATIVE)

    service = sanitize_visual_context_text(_best_effort_service(step_data, payload), max_len=140)
    service_summary = sanitize_visual_context_text(_extract_service_summary(payload), max_len=300)
    location = _extract_location(step_data)
    style_tags = _extract_style_tags(step_data)
    notes = sanitize_visual_context_text(step_data.get("notes") or "", max_len=200)
    budget_raw = str(
        step_data.get("budget_range")
        or step_data.get("budgetRange")
        or step_data.get("step-budget-range")
        or step_data.get("step-budget")
        or ""
    ).strip()
    budget = _format_budget(budget_raw) if budget_raw else ""
    timeline = sanitize_visual_context_text(step_data.get("timeline") or "", max_len=80)

    is_edit = len(reference_images) > 0
    subject = service[:140] if service else "home improvement"

    extra = _kv_details(step_data, skip_keys=set(_SKIP_KEYS))
    qa_pairs = _extract_answered_qa(payload)

    lines: List[str] = ["No text, no words, no letters, no labels, no captions, no logos, no watermarks, no signs."]

    if use_case == "scene-placement":
        lines.append(f"Seamlessly place the product into this scene for a {subject} project.")
        lines.append(
            "Hard anchor constraint: preserve the original scene image composition and camera exactly "
            "(framing, geometry, perspective, horizon, lighting direction, and depth relationships)."
        )
        lines.append("Only apply local inpaint-style edits needed for the requested placement; avoid global scene changes.")
        if scene_image:
            lines.append("Use the provided scene as the background environment.")
        if product_image:
            lines.append("Integrate the product naturally: match scale, shadows, and reflections.")
        if style_tags:
            lines.append(f"Design style: {', '.join(style_tags)}.")
        if location:
            lines.append(f"Setting: {location[:80]}.")

    elif use_case == "tryon":
        lines.append(f"Create a photorealistic try-on preview showing the product on the person.")
        lines.append("Preserve the person's body shape, pose, and skin tone exactly.")
        lines.append("Make the product fit naturally with correct draping, folds, and shadows.")
        if style_tags:
            lines.append(f"Style direction: {', '.join(style_tags)}.")

    elif is_edit:
        # EDIT mode: the reference photo is the BEFORE state — generate the fully-completed AFTER.
        lines.append(SINGLE_SCENE_GUARDRAIL)
        lines.append(
            f"The uploaded photo is the BEFORE state. Generate the photorealistic AFTER state: "
            f"this exact space once a professional {subject} project has been fully completed."
        )
        lines.append(
            "Hard anchor constraint: preserve camera framing/perspective, scene geometry, lighting direction, and "
            "all unchanged structural elements from the reference image."
        )
        if service_summary:
            lines.append(
                f"Service context: {service_summary} "
                f"This means every element touched by this type of work must look brand-new and professionally done — "
                f"nothing from the original should remain that this service would have replaced or upgraded."
            )
        lines.append(
            "PRESERVE (do not change): the room's overall architecture — "
            "structural walls, ceiling, floor plan, window openings, door openings, and camera angle/perspective."
        )
        lines.append(
            "REPLACE & RENOVATE (make fully new and updated): "
            "all surfaces, fixtures, fittings, finishes, hardware, and any dated or worn elements "
            "that would be replaced as part of this type of project. "
            "Nothing that this renovation covers should look old, worn, or original."
        )
        lines.append("Apply these design preferences to the renovated space:")
        if style_tags:
            lines.append(f"- Style: {', '.join(style_tags)}")
        if budget:
            material_desc = _budget_material_descriptor(budget_raw)
            if material_desc:
                lines.append(f"- Budget: {budget}. {material_desc}")
            else:
                lines.append(f"- Budget level: {budget} (match material quality to this range)")
        if location:
            lines.append(f"- Location: {location[:80]}")
        for qa in qa_pairs[:8]:
            q = qa["question"]
            a = qa["answer"]
            if q.lower().startswith("wait") or "pricing" in q.lower():
                continue
            lines.append(f"- {q}: {a}")
        for detail in extra[:6]:
            lines.append(f"- {detail}")
        if notes:
            lines.append(f"- Additional notes: {notes[:200]}")
        lines.append(
            "The result must look like a professional contractor photo of the completed renovation — "
            "crisp, realistic, everything looking fresh and new."
        )

    else:
        # INITIAL generation: descriptive text-to-image
        lines.append(SINGLE_SCENE_GUARDRAIL)
        if location:
            lines.append(f"A photorealistic image of a beautifully completed {subject} project in {location[:80]}.")
        else:
            lines.append(f"A photorealistic image of a beautifully completed {subject} project.")
        if service_summary:
            lines.append(f"About this service: {service_summary[:300]}")
        if style_tags:
            lines.append(f"Design style: {', '.join(style_tags)}.")
        if budget:
            material_desc = _budget_material_descriptor(budget_raw)
            if material_desc:
                lines.append(f"Budget: {budget}. {material_desc}")
            else:
                lines.append(f"Budget level: {budget} (finishes and materials should match this price range).")
        for qa in qa_pairs[:8]:
            q = qa["question"]
            a = qa["answer"]
            if q.lower().startswith("wait") or "pricing" in q.lower():
                continue
            lines.append(f"{q}: {a}.")
        for detail in extra[:6]:
            lines.append(f"{detail}.")
        if notes:
            lines.append(f"Notes: {notes[:200]}.")
        if timeline:
            lines.append(f"Timeline: {timeline[:80]}.")

    lines.append("Photorealistic, high quality, realistic materials and natural lighting.")
    lines.append("No text, no words, no letters, no labels, no captions, no logos, no watermarks, no annotations, no signs.")

    prompt = "\n".join([x for x in lines if str(x).strip()]).strip()

    from programs.image_generator.model_selector import select_model
    recommendation = select_model(
        use_case=use_case,
        num_input_images=len(reference_images),
        has_scene_image=bool(scene_image),
        has_product_image=bool(product_image),
    )

    return {
        "prompt": prompt,
        "negativePrompt": negative_prompt,
        "styleTags": style_tags,
        "isEdit": is_edit,
        "modelRecommendation": recommendation.to_dict(),
        "metadata": {
            "useCase": use_case,
            "location": location,
            "referenceImagesCount": len(reference_images),
            "hasSceneImage": bool(scene_image),
            "hasProductImage": bool(product_image),
            "isEdit": is_edit,
        },
    }


__all__ = [
    "build_image_prompt_text",
    "extract_negative_prompt",
    "extract_reference_images",
]
