from __future__ import annotations

from dataclasses import dataclass
import json
from pathlib import Path
import re
from typing import Dict, Iterable, List, Sequence

from programs.common.visual_text_safety import sanitize_visual_context_text


@dataclass(frozen=True)
class RefinementTaxonomyEntry:
    canonical_key: str
    label: str
    aliases: Sequence[str]
    template_key: str


def _manifest_path() -> Path:
    return Path(__file__).resolve().parents[5] / "apps" / "designer" / "src" / "lib" / "refinement-supported-components.json"


def _load_manifest() -> Sequence[RefinementTaxonomyEntry]:
    raw = json.loads(_manifest_path().read_text(encoding="utf-8"))
    items: list[RefinementTaxonomyEntry] = []
    for item in raw if isinstance(raw, list) else []:
        if not isinstance(item, dict):
            continue
        key = str(item.get("key") or "").strip()
        label = str(item.get("label") or key).strip()
        template_key = str(item.get("templateKey") or f"{key}_v1").strip()
        aliases = [str(alias).strip() for alias in item.get("aliases") or [] if str(alias).strip()]
        if not key or not label:
            continue
        items.append(
            RefinementTaxonomyEntry(
                canonical_key=key,
                label=label,
                aliases=tuple(aliases),
                template_key=template_key,
            )
        )
    return tuple(items)


SCENE_REFINEMENT_TAXONOMY: Sequence[RefinementTaxonomyEntry] = _load_manifest()

_SPACE_RE = re.compile(r"\s+")


def _normalize_phrase(text: str) -> str:
    s = sanitize_visual_context_text(text or "", max_len=160).lower()
    s = s.replace("&", " and ")
    s = re.sub(r"[^a-z0-9]+", " ", s)
    return _SPACE_RE.sub(" ", s).strip()


_ENTRY_BY_KEY: Dict[str, RefinementTaxonomyEntry] = {entry.canonical_key: entry for entry in SCENE_REFINEMENT_TAXONOMY}
_ALIASES_TO_KEY: Dict[str, str] = {}
for _entry in SCENE_REFINEMENT_TAXONOMY:
    _ALIASES_TO_KEY[_normalize_phrase(_entry.canonical_key)] = _entry.canonical_key
    _ALIASES_TO_KEY[_normalize_phrase(_entry.label)] = _entry.canonical_key
    for _alias in _entry.aliases:
        _ALIASES_TO_KEY[_normalize_phrase(_alias)] = _entry.canonical_key


def get_taxonomy_entry(key: str) -> RefinementTaxonomyEntry | None:
    return _ENTRY_BY_KEY.get(str(key or "").strip())


def get_supported_refinement_components_for_planner() -> List[dict]:
    return [
        {
            "key": entry.canonical_key,
            "label": entry.label,
            "aliases": list(entry.aliases),
        }
        for entry in SCENE_REFINEMENT_TAXONOMY
    ]


def normalize_refinement_category_key(raw_name: str) -> str | None:
    text = _normalize_phrase(raw_name)
    if not text:
        return None
    if text in _ALIASES_TO_KEY:
        return _ALIASES_TO_KEY[text]
    for alias, canonical_key in _ALIASES_TO_KEY.items():
        if alias and (alias in text or text in alias):
            return canonical_key
    return None


def default_refinement_category_keys(*, category_name: str, subcategory_name: str, limit: int) -> List[str]:
    del category_name, subcategory_name, limit
    return []


def normalize_refinement_plan_items(
    raw_items: Iterable[object],
    *,
    category_name: str,
    subcategory_name: str,
    target_categories: int,
    min_categories: int,
    max_categories: int,
    exclude_keys: Iterable[str] = (),
) -> List[dict]:
    del category_name, subcategory_name, min_categories
    target = max(1, int(target_categories or 1))
    maximum = max(target, int(max_categories or target))
    excluded = {str(key or "").strip() for key in exclude_keys if str(key or "").strip()}

    out: List[dict] = []
    seen: set[str] = set(excluded)

    for idx, raw_item in enumerate(list(raw_items), start=1):
        if len(out) >= maximum:
            break
        if not isinstance(raw_item, dict):
            continue
        raw_name = sanitize_visual_context_text(raw_item.get("raw_name") or raw_item.get("name") or "", max_len=120)
        canonical_key = normalize_refinement_category_key(raw_name)
        entry = get_taxonomy_entry(canonical_key or "")
        if not raw_name or not canonical_key or not entry or canonical_key in seen:
            continue
        seen.add(canonical_key)
        try:
            priority = int(raw_item.get("priority") or idx)
        except Exception:
            priority = idx
        reason = sanitize_visual_context_text(raw_item.get("reason") or "", max_len=240)
        out.append(
            {
                "canonical_key": entry.canonical_key,
                "label": entry.label,
                "priority": priority,
                "raw_name": raw_name,
                "reason": reason or f"{entry.label} is a reusable visual refinement component for this service.",
                "template_key": entry.template_key,
            }
        )

    return sorted(out, key=lambda item: (int(item.get("priority") or 999), str(item.get("label") or "")))[:target]


__all__ = [
    "SCENE_REFINEMENT_TAXONOMY",
    "RefinementTaxonomyEntry",
    "default_refinement_category_keys",
    "get_supported_refinement_components_for_planner",
    "get_taxonomy_entry",
    "normalize_refinement_category_key",
    "normalize_refinement_plan_items",
]
