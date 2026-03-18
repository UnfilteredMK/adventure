from __future__ import annotations

import math
import re
from typing import Any, Dict, List, Optional

from programs.question_planner.budget_bounds import SERVICE_BUDGET_BOUNDS
from programs.question_planner.plan_parsing import derive_step_id_from_key, normalize_plan_key
from programs.question_planner.renderer.validation import _coerce_options


_SPECIAL_OPTION_PATTERNS: tuple[re.Pattern[str], ...] = (
    re.compile(r"\bnot\s+sure\b", re.IGNORECASE),
    re.compile(r"\bno\s+preference\b", re.IGNORECASE),
    re.compile(r"\bno\s+strong\s+preference\b", re.IGNORECASE),
    re.compile(r"\bother\b", re.IGNORECASE),
)

_MULTI_SELECT_STRONG_PATTERNS: tuple[re.Pattern[str], ...] = (
    re.compile(r"\b(select|choose|pick|check)\s+all\s+that\s+apply\b", re.IGNORECASE),
    re.compile(r"\b(select|choose|pick|check)\s+any\s+(that\s+apply)?\b", re.IGNORECASE),
    re.compile(r"\b(check|select)\s+all\b", re.IGNORECASE),
    re.compile(r"\bwhich\s+of\s+(these|the\s+following)\b", re.IGNORECASE),
)
_MULTI_SELECT_UP_TO_PATTERN = re.compile(r"\b(?:up\s+to|at\s+most|no\s+more\s+than)\s+(?P<n>\d+)\b", re.IGNORECASE)

# Conservative noun/verb hints for inferring multi-select when the planner forgets to set allow_multiple.
_MULTI_SELECT_NOUN_HINTS: tuple[str, ...] = (
    "materials",
    "features",
    "elements",
    "plant types",
    "plants",
    "seating options",
    "amenities",
    "add-ons",
    "addons",
    "extras",
)
_MULTI_SELECT_VERB_HINTS: tuple[str, ...] = (
    "include",
    "add",
    "highlight",
    "focus",
    "avoid",
    "favor",
    "would you like",
    "do you want",
    "are you interested",
)

_SERVICE_BUDGET_BOUNDS = SERVICE_BUDGET_BOUNDS


def _round_slider_step(span: float) -> int:
    raw = max(100.0, round(span / 20.0))
    if raw >= 10000:
        return int(max(1000, round(raw / 1000.0) * 1000))
    if raw >= 5000:
        return int(max(500, round(raw / 500.0) * 500))
    if raw >= 1000:
        return int(max(250, round(raw / 250.0) * 250))
    return int(max(100, round(raw / 100.0) * 100))


def _nice_budget_floor(value: float) -> int:
    if not isinstance(value, (int, float)) or value <= 0:
        return 100
    magnitude = 10 ** int(math.floor(math.log10(float(value))))
    scaled = float(value) / float(magnitude)
    if scaled >= 10:
        return int(10 * magnitude)
    if scaled >= 5:
        return int(5 * magnitude)
    if scaled >= 2:
        return int(2 * magnitude)
    return int(magnitude)


def _nice_budget_ceil(value: float) -> int:
    if not isinstance(value, (int, float)) or value <= 0:
        return 100
    magnitude = 10 ** int(math.floor(math.log10(float(value))))
    scaled = float(value) / float(magnitude)
    if scaled <= 1:
        return int(magnitude)
    if scaled <= 2:
        return int(2 * magnitude)
    if scaled <= 5:
        return int(5 * magnitude)
    return int(10 * magnitude)


def _infer_service_bounds(
    question: str,
    item: Dict[str, Any],
    *,
    budget_bounds_hint: Optional[tuple[int, int]] = None,
) -> tuple[int, int]:
    if budget_bounds_hint is not None and len(budget_bounds_hint) >= 2:
        return (int(budget_bounds_hint[0]), int(budget_bounds_hint[1]))
    text = " ".join(
        [
            str(question or ""),
            str(item.get("service") or ""),
            str(item.get("service_name") or ""),
            str(item.get("service_summary") or ""),
        ]
    ).lower()
    for hints, bounds in _SERVICE_BUDGET_BOUNDS:
        if any(h in text for h in hints):
            return bounds
    return (1000, 150000)


def _normalize_budget_slider_range(
    item: Dict[str, Any],
    question: str,
    *,
    budget_bounds_hint: Optional[tuple[int, int]] = None,
) -> tuple[int, int, int]:
    def _as_num(raw: Any) -> Optional[float]:
        try:
            if raw is None or str(raw).strip() == "":
                return None
            return float(raw)
        except Exception:
            return None

    min_n = _as_num(item.get("min"))
    max_n = _as_num(item.get("max"))
    bounds_min, bounds_max = _infer_service_bounds(question, item, budget_bounds_hint=budget_bounds_hint)

    if min_n is not None and max_n is not None and max_n > min_n:
        baseline = (min_n + max_n) / 2.0
    elif max_n is not None and max_n > 0:
        baseline = max_n
    elif min_n is not None and min_n > 0:
        baseline = min_n * 1.2
    else:
        baseline = float((bounds_min + bounds_max) / 2.0)

    min_target = _nice_budget_floor(max(100.0, baseline / 3.0))
    max_target = _nice_budget_ceil(max(float(min_target + 100), baseline * 3.333))

    if min_n is not None and min_n > 0:
        min_target = min(min_target, _nice_budget_floor(min_n * 0.9))
    if max_n is not None and max_n > 0:
        max_target = max(max_target, _nice_budget_ceil(max_n * 1.1))

    if max_target <= min_target:
        max_target = _nice_budget_ceil(float(min_target) * 2.0)
    if max_target <= min_target:
        max_target = min_target + 500

    step_target = _as_num(item.get("step"))
    if step_target is None or step_target <= 0:
        step_target = float(_round_slider_step(float(max_target - min_target)))
    return int(round(min_target)), int(round(max_target)), int(round(step_target))


def _is_special_option_label(label: str) -> bool:
    t = str(label or "").strip()
    if not t:
        return False
    return any(p.search(t) for p in _SPECIAL_OPTION_PATTERNS)


def _option_label(opt: Any) -> str:
    if isinstance(opt, str):
        return opt
    if isinstance(opt, dict):
        label = opt.get("label")
        if label is None:
            label = opt.get("value")
        return str(label or "")
    return ""


def _normalize_option_hints(option_hints: Any) -> list:
    if not isinstance(option_hints, list):
        return []
    out: list = []
    for opt in option_hints:
        if isinstance(opt, (str, dict)):
            if str(_option_label(opt) or "").strip():
                out.append(opt)
    return out


def _is_catalog_backed_style_step(key: str) -> bool:
    return normalize_plan_key(key) == "style_direction"


def _enforce_option_count(
    option_hints: list,
    *,
    choice_option_min: Optional[int],
    choice_option_max: Optional[int],
    choice_option_target: Optional[int],
) -> list:
    """
    Keep option counts within the UI's min/max/target guidance.

    We prefer to preserve any "special" options like "Not sure yet" / "Other" when trimming.
    When we must pad, we add conservative generic options rather than hallucinating.
    """
    opts = list(option_hints or [])

    def _as_int(x: Any) -> Optional[int]:
        try:
            return int(x)
        except Exception:
            return None

    opt_min = _as_int(choice_option_min)
    opt_max = _as_int(choice_option_max)
    opt_target = _as_int(choice_option_target)

    # Style grids (10-20 options) need higher cap; other steps stay at 12.
    _opt_cap = 20
    if opt_min is not None:
        opt_min = max(1, min(_opt_cap, opt_min))
    if opt_max is not None:
        opt_max = max(1, min(_opt_cap, opt_max))
    if opt_min is not None and opt_max is not None and opt_max < opt_min:
        opt_max = opt_min
    if opt_target is not None and opt_min is not None and opt_target < opt_min:
        opt_target = opt_min
    if opt_target is not None and opt_max is not None and opt_target > opt_max:
        opt_target = opt_max

    # Trim to max first.
    if opt_max is not None and len(opts) > opt_max:
        special = [o for o in opts if _is_special_option_label(_option_label(o))]
        core = [o for o in opts if o not in special]
        keep: list = []
        # Keep as much core as we can, reserving space for specials.
        reserve = min(len(special), opt_max)
        core_limit = max(0, opt_max - reserve)
        keep.extend(core[:core_limit])
        keep.extend(special[: max(0, opt_max - len(keep))])
        opts = keep[:opt_max]

    # Best-effort trim toward target (do not pad to reach target).
    if opt_target is not None and len(opts) > opt_target:
        special = [o for o in opts if _is_special_option_label(_option_label(o))]
        core = [o for o in opts if o not in special]
        keep: list = []
        reserve = min(len(special), opt_target)
        core_limit = max(0, opt_target - reserve)
        keep.extend(core[:core_limit])
        keep.extend(special[: max(0, opt_target - len(keep))])
        opts = keep[:opt_target]

    # Pad to min with generic options (only if needed).
    if opt_min is not None and len(opts) < opt_min:
        existing_norm = {re.sub(r"\s+", " ", _option_label(o).strip().lower()) for o in opts}
        for label in ("Not sure yet", "Other", "No strong preference"):
            if len(opts) >= opt_min:
                break
            norm = re.sub(r"\s+", " ", label.strip().lower())
            if norm in existing_norm:
                continue
            opts.append(label)
            existing_norm.add(norm)

    return opts


def _infer_multi_select(*, key: str, question: str) -> tuple[bool, Optional[int]]:
    """
    Best-effort inference for when a step should allow multiple selections.

    Intentionally conservative:
    - Only triggers on strong phrasing ("select all that apply", "which of these...")
      or on noun+verb cues that strongly imply a list of inclusions (materials/features/etc.).
    """
    q = str(question or "").strip().lower()
    if not q:
        return False, None

    if any(p.search(q) for p in _MULTI_SELECT_STRONG_PATTERNS):
        m = _MULTI_SELECT_UP_TO_PATTERN.search(q)
        if m:
            try:
                n = int(m.group("n"))
                if n > 0:
                    return True, max(1, min(10, n))
            except Exception:
                pass
        return True, None

    if any(n in q for n in _MULTI_SELECT_NOUN_HINTS) and any(v in q for v in _MULTI_SELECT_VERB_HINTS):
        m = _MULTI_SELECT_UP_TO_PATTERN.search(q)
        if m:
            try:
                n = int(m.group("n"))
                if n > 0:
                    return True, max(1, min(10, n))
            except Exception:
                pass
        return True, None

    # Key-based backstop for common plural preference buckets.
    k = str(key or "").strip().lower()
    if re.search(r"(materials|features|amenities|extras|add_ons|addons|must_avoid|avoid)$", k):
        return True, None

    return False, None


def render_plan_items_to_mini_steps(
    plan_items: List[Dict[str, Any]],
    *,
    choice_option_min: Optional[int] = None,
    choice_option_max: Optional[int] = None,
    choice_option_target: Optional[int] = None,
    budget_bounds_hint: Optional[tuple[int, int]] = None,
) -> List[Dict[str, Any]]:
    """
    Convert planner plan items into raw UI step dicts.

    Output is intentionally "model-free": the orchestrator still validates/coerces
    into schema objects via `_validate_mini`.
    """
    steps: List[Dict[str, Any]] = []
    for item in plan_items or []:
        if not isinstance(item, dict):
            continue
        key = normalize_plan_key(item.get("key"))
        if not key:
            continue
        step_id = derive_step_id_from_key(key)

        question = str(item.get("question") or item.get("intent") or "").strip()
        if not question:
            continue

        type_hint = str(item.get("type_hint") or item.get("typeHint") or "").strip().lower()
        if key == "budget_range" and not type_hint:
            type_hint = "slider"

        def _as_num(raw: Any) -> Optional[float]:
            try:
                if raw is None or str(raw).strip() == "":
                    return None
                return float(raw)
            except Exception:
                return None

        if type_hint == "slider":
            if key == "budget_range":
                min_n, max_n, step_n = _normalize_budget_slider_range(
                    item, question, budget_bounds_hint=budget_bounds_hint
                )
            else:
                min_n = _as_num(item.get("min"))
                max_n = _as_num(item.get("max"))
                step_n = _as_num(item.get("step"))
                if min_n is None:
                    min_n = 0.0
                if max_n is None or max_n <= min_n:
                    max_n = min_n + 100.0
                if step_n is None or step_n <= 0:
                    step_n = max(1.0, round((max_n - min_n) / 20.0))
            step: Dict[str, Any] = {
                "id": step_id,
                "type": "slider",
                "question": question,
                "min": int(min_n),
                "max": int(max_n),
                "step": max(1, int(step_n)),
            }
            currency = str(item.get("currency") or "").strip().upper()
            # budget_range is always a dollar amount — default to USD if the AI didn't specify.
            if key == "budget_range" and not currency:
                currency = "USD"
            if currency:
                step["currency"] = currency
                step["unit"] = str(item.get("unit") or "$").strip() or "$"
                step["unitType"] = str(item.get("unitType") or "currency").strip() or "currency"
                step["format"] = "currency"
            elif key == "budget_range":
                # Fallback: keep ISO currency code for consistent formatting.
                step["currency"] = "USD"
                step["format"] = "currency"
        else:
            raw_option_hints = _normalize_option_hints(item.get("option_hints"))
            raw_option_hints = _enforce_option_count(
                raw_option_hints,
                choice_option_min=choice_option_min,
                choice_option_max=choice_option_max,
                choice_option_target=choice_option_target,
            )
            options = _coerce_options(raw_option_hints)
            if not options and not _is_catalog_backed_style_step(key):
                # Hard backstop: choice steps require options for schema validation.
                options = _coerce_options(["Not sure yet"])

            step_type = type_hint if type_hint in ("segmented_choice", "chips_multi", "image_choice_grid") else "multiple_choice"
            step = {
                "id": step_id,
                "type": step_type,
                "question": question,
                "options": options,
            }

        if step.get("type") in ("multiple_choice", "segmented_choice", "chips_multi", "image_choice_grid"):
            allow_multiple = item.get("allow_multiple")
            if allow_multiple is None:
                allow_multiple = item.get("allowMultiple")
            if allow_multiple is None:
                allow_multiple = item.get("multi_select")
            if allow_multiple is None:
                allow_multiple = item.get("multiSelect")
            if allow_multiple is not None:
                # Frontend contract uses `multi_select` (snake_case). Keep older keys as input-only.
                step["multi_select"] = bool(allow_multiple)
            else:
                inferred_multi, inferred_max = _infer_multi_select(key=key, question=question)
                if inferred_multi:
                    step["multi_select"] = True
                    if inferred_max is not None:
                        step["max_selections"] = int(inferred_max)

            min_selections = item.get("min_selections")
            if min_selections is None:
                min_selections = item.get("minSelections")
            if min_selections is not None:
                try:
                    step["min_selections"] = max(1, int(min_selections))
                except Exception:
                    pass

            max_selections = item.get("max_selections")
            if max_selections is None:
                max_selections = item.get("maxSelections")
            if max_selections is not None:
                try:
                    step["max_selections"] = max(1, int(max_selections))
                except Exception:
                    pass

            if _is_catalog_backed_style_step(key):
                step["multi_select"] = True
                step.setdefault("min_selections", 3)
                step.setdefault("max_selections", 5)

            allow_other = item.get("allow_other")
            if allow_other is None:
                allow_other = item.get("allowOther")
            if allow_other is not None:
                step["allow_other"] = bool(allow_other)

            other_label = item.get("other_label")
            if other_label is None:
                other_label = item.get("otherLabel")
            if str(other_label or "").strip():
                step["other_label"] = str(other_label).strip()

            other_placeholder = item.get("other_placeholder")
            if other_placeholder is None:
                other_placeholder = item.get("otherPlaceholder")
            if str(other_placeholder or "").strip():
                step["other_placeholder"] = str(other_placeholder).strip()

            other_requires_text = item.get("other_requires_text")
            if other_requires_text is None:
                other_requires_text = item.get("otherRequiresText")
            if other_requires_text is not None:
                step["other_requires_text"] = bool(other_requires_text)

        if item.get("required") is True:
            step["required"] = True

        # Pass through optional function calls unchanged.
        if isinstance(item.get("functionCall"), dict):
            step["functionCall"] = item["functionCall"]

        steps.append(step)

    return steps


__all__ = ["render_plan_items_to_mini_steps"]
