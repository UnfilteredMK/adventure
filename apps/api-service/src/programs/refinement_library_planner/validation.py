from __future__ import annotations

import re
from typing import Any, Dict, List, Mapping, MutableMapping, Optional, Sequence, Tuple

from programs.common.visual_text_safety import sanitize_visual_context_text

_MAX_COMPONENTS = 10
_MAX_OPTIONS_PER_COMPONENT = 6
_KEY_MAX_LEN = 48

_SPACE_RE = re.compile(r"\s+")

# Non-visual / process-ish refinement “categories” to drop.
_BLOCKED_PHRASES = (
    "admin",
    "billing",
    "compliance",
    "consultation",
    "contract",
    "crm",
    "customer service",
    "estimate",
    "insurance",
    "invoice",
    "lead",
    "legal",
    "logistics",
    "payment",
    "permit",
    "pricing",
    "process",
    "procurement",
    "project management",
    "quote",
    "sales",
    "schedule",
    "scheduling",
    "timeline",
    "warranty",
    "workflow",
)


def slugify_component_key(raw: str) -> str:
    s = sanitize_visual_context_text(raw or "", max_len=120).lower()
    s = s.replace("&", " and ")
    s = re.sub(r"[^a-z0-9]+", "_", s)
    s = re.sub(r"_+", "_", s).strip("_")
    if not s:
        return ""
    return s[:_KEY_MAX_LEN]


def slugify_option_value(raw: str, *, fallback: str) -> str:
    base = slugify_component_key(raw or fallback)
    return base or slugify_component_key(fallback) or "option"


def _normalized_blob(*parts: str) -> str:
    text = " ".join(p for p in parts if p).lower()
    text = text.replace("&", " and ")
    text = re.sub(r"[^a-z0-9]+", " ", text)
    return _SPACE_RE.sub(" ", text).strip()


def _is_blocked_component(*, key: str, label: str, reason: str) -> bool:
    blob = _normalized_blob(key, label, reason)
    if not blob:
        return True
    for phrase in _BLOCKED_PHRASES:
        if phrase in blob:
            return True
    return False


def validate_and_normalize_planner_payload(
    raw: Mapping[str, Any],
    *,
    target_component_count: int,
    target_options_per_component: int,
) -> Tuple[bool, str, Dict[str, Any]]:
    """
    Returns (ok, error_code, normalized_payload).
    normalized_payload keys: components, optionSeeds (list of {componentKey, options}).
    """
    target_components = max(1, min(_MAX_COMPONENTS, int(target_component_count or _MAX_COMPONENTS)))
    target_opts = max(1, min(_MAX_OPTIONS_PER_COMPONENT, int(target_options_per_component or _MAX_OPTIONS_PER_COMPONENT)))

    comps_in = raw.get("components")
    seeds_in = raw.get("optionSeeds")
    if not isinstance(comps_in, list) or not isinstance(seeds_in, list):
        return False, "invalid_shape", {}

    normalized_components: List[Dict[str, Any]] = []
    seen_keys: set[str] = set()

    for idx, item in enumerate(comps_in):
        if len(normalized_components) >= target_components:
            break
        if not isinstance(item, dict):
            continue
        label = sanitize_visual_context_text(item.get("label") or item.get("name") or "", max_len=120)
        raw_key = str(item.get("key") or "").strip()
        key = slugify_component_key(raw_key or label)
        if not key or key in seen_keys:
            continue
        reason = sanitize_visual_context_text(item.get("reason") or "", max_len=320)
        if _is_blocked_component(key=key, label=label, reason=reason):
            continue
        if not label:
            label = key.replace("_", " ").title()
        try:
            priority = int(item.get("priority") or idx + 1)
        except Exception:
            priority = idx + 1
        priority = max(1, priority)
        seen_keys.add(key)
        entry: Dict[str, Any] = {
            "key": key,
            "label": label,
            "priority": priority,
            "reason": reason or f"{label} is a visual refinement choice for this service.",
        }
        normalized_components.append(entry)

    if len(normalized_components) < 1:
        return False, "no_components", {}

    # option seeds grouped by component key
    seeds_by_key: MutableMapping[str, List[Dict[str, Any]]] = {}
    for group in seeds_in:
        if not isinstance(group, dict):
            continue
        ck_raw = str(group.get("componentKey") or group.get("component_key") or "").strip()
        ck = slugify_component_key(ck_raw)
        if not ck or ck not in seen_keys:
            continue
        opts = group.get("options")
        if not isinstance(opts, list):
            continue
        bucket = seeds_by_key.setdefault(ck, [])
        seen_vals: set[str] = set()
        for opt in opts:
            if len(bucket) >= target_opts:
                break
            if not isinstance(opt, dict):
                continue
            olab = sanitize_visual_context_text(opt.get("label") or "", max_len=120)
            ip = sanitize_visual_context_text(opt.get("imagePrompt") or opt.get("image_prompt") or "", max_len=600)
            if not olab or len(ip) < 12:
                continue
            val_raw = str(opt.get("value") or "").strip()
            value = slugify_option_value(val_raw, fallback=olab)
            if not value or value in seen_vals:
                continue
            seen_vals.add(value)
            bucket.append({"label": olab, "value": value, "imagePrompt": ip})

    normalized_seeds: List[Dict[str, Any]] = []
    for comp in normalized_components:
        opts = seeds_by_key.get(comp["key"]) or []
        if len(opts) < 1:
            return False, f"missing_option_seeds:{comp['key']}", {}
        normalized_seeds.append({"componentKey": comp["key"], "options": opts})

    normalized_components.sort(key=lambda c: (int(c.get("priority") or 999), str(c.get("label") or "")))

    return True, "", {"components": normalized_components, "optionSeeds": normalized_seeds}
