from __future__ import annotations

import json
import math
import os
import re
import time
from typing import Any, Dict, List, Mapping, Sequence, Tuple

import dspy

from programs.common.dspy_runtime import configure_dspy, extract_dspy_usage, make_dspy_lm_for_module
from programs.common.visual_text_safety import sanitize_visual_context_text
from programs.refinement_library_planner.validation import slugify_component_key


SEMANTIC_RELEVANCE_THRESHOLD = 0.75
_MAX_CANDIDATES = 10


def _compact_json(obj: object) -> str:
    return json.dumps(obj, ensure_ascii=True, separators=(",", ":"), sort_keys=True)


def _coerce_int(value: Any, default: int) -> int:
    try:
        if value is None:
            return default
        return int(value)
    except Exception:
        return default


def _coerce_float(value: Any, default: float) -> float:
    try:
        if value is None:
            return default
        return float(value)
    except Exception:
        return default


def _resolve_context(payload: Mapping[str, Any]) -> Dict[str, str]:
    return {
        "category_id": str(payload.get("category_id") or payload.get("categoryId") or "").strip(),
        "category_name": sanitize_visual_context_text(
            payload.get("category_name")
            or payload.get("categoryName")
            or payload.get("industry")
            or payload.get("vertical")
            or "",
            max_len=160,
        ),
        "subcategory_id": str(payload.get("subcategory_id") or payload.get("subcategoryId") or "").strip(),
        "subcategory_name": sanitize_visual_context_text(
            payload.get("subcategory_name") or payload.get("subcategoryName") or payload.get("service") or "",
            max_len=160,
        ),
        "company_summary": sanitize_visual_context_text(
            payload.get("company_summary") or payload.get("companySummary") or "",
            max_len=800,
        ),
        "service_summary": sanitize_visual_context_text(
            payload.get("service_summary") or payload.get("serviceSummary") or "",
            max_len=800,
        ),
    }


def resolve_candidate_components(payload: Mapping[str, Any]) -> List[Dict[str, Any]]:
    raw = payload.get("components") or payload.get("candidateComponents") or payload.get("candidate_components") or []
    seen: set[str] = set()
    candidates: List[Dict[str, Any]] = []
    for index, item in enumerate(raw if isinstance(raw, list) else []):
        if len(candidates) >= _MAX_CANDIDATES or not isinstance(item, dict):
            continue
        label = sanitize_visual_context_text(item.get("label") or item.get("name") or "", max_len=120)
        key = slugify_component_key(str(item.get("key") or label or ""))
        if not key or key in seen:
            continue
        seen.add(key)
        reason = sanitize_visual_context_text(item.get("reason") or "", max_len=320)
        try:
            priority = max(1, int(item.get("priority") or index + 1))
        except Exception:
            priority = index + 1
        candidates.append(
            {
                "key": key,
                "label": label or key.replace("_", " ").title(),
                "priority": priority,
                "reason": reason or None,
            }
        )
    return candidates


def _safe_relevance_score(value: Any) -> float:
    try:
        score = float(value)
    except Exception:
        return 0.0
    if not math.isfinite(score) or score < 0.0 or score > 1.0:
        return 0.0
    return score


def normalize_semantic_validation_results(
    candidates: Sequence[Mapping[str, Any]],
    raw_results: Any,
) -> List[Dict[str, Any]]:
    """Return exactly one fail-closed score and reason for every candidate."""
    candidate_keys = {slugify_component_key(str(item.get("key") or "")) for item in candidates}
    by_key: Dict[str, List[Mapping[str, Any]]] = {}
    for item in raw_results if isinstance(raw_results, list) else []:
        if not isinstance(item, Mapping):
            continue
        key = slugify_component_key(str(item.get("key") or item.get("componentKey") or ""))
        if not key or key not in candidate_keys:
            continue
        by_key.setdefault(key, []).append(item)

    normalized: List[Dict[str, Any]] = []
    for candidate in candidates:
        key = slugify_component_key(str(candidate.get("key") or ""))
        entries = by_key.get(key) or []
        # Missing or duplicate results are ambiguous contracts. Emit a zero score so
        # ambiguity can never make a component eligible for persistence.
        selected = entries[0] if len(entries) == 1 else {}
        if selected:
            raw_score = (
                selected.get("relevanceScore")
                if selected.get("relevanceScore") is not None
                else selected.get("relevance_score")
                if selected.get("relevance_score") is not None
                else selected.get("score")
            )
            score = _safe_relevance_score(raw_score)
        else:
            score = 0.0
        reason = sanitize_visual_context_text(selected.get("reason") or "", max_len=320)
        if not reason:
            score = 0.0
            reason = (
                "Semantic validator did not return an unambiguous score and reason for this candidate."
                if len(entries) != 1
                else "Semantic validator returned an invalid or empty reason for this candidate."
            )
        normalized.append(
            {
                "key": key,
                "label": str(candidate.get("label") or key).strip() or key,
                "relevanceScore": score,
                "reason": reason,
            }
        )
    return normalized


def _extract_first_results_object(text: str) -> Dict[str, Any] | None:
    source = str(text or "")
    start = source.find("{")
    while start >= 0:
        depth = 0
        in_string = False
        escaped = False
        for index in range(start, len(source)):
            char = source[index]
            if in_string:
                if escaped:
                    escaped = False
                elif char == "\\":
                    escaped = True
                elif char == '"':
                    in_string = False
                continue
            if char == '"':
                in_string = True
            elif char == "{":
                depth += 1
            elif char == "}":
                depth -= 1
                if depth == 0:
                    try:
                        parsed = json.loads(source[start : index + 1])
                    except Exception:
                        break
                    if isinstance(parsed, dict) and isinstance(parsed.get("results"), list):
                        return parsed
                    break
        start = source.find("{", start + 1)
    return None


def _sanitize_validation_json(raw: object) -> str:
    text = str(raw or "").strip()
    text = re.sub(r"^```(?:json)?\s*", "", text, flags=re.IGNORECASE)
    text = re.sub(r"\s*```$", "", text, flags=re.IGNORECASE).strip()
    if not text:
        return ""
    parsed: Dict[str, Any] | None = None
    try:
        loaded = json.loads(text)
        if isinstance(loaded, dict) and isinstance(loaded.get("results"), list):
            parsed = loaded
    except Exception:
        parsed = _extract_first_results_object(text)
    if parsed is None:
        return text
    return _compact_json(parsed)


class RefinementComponentSemanticValidatorSignature(dspy.Signature):
    """
    Judge whether every proposed visual refinement component is relevant to the exact service.

    Score every candidate independently from 0.0 to 1.0. A score of 0.75 or higher means the
    component is a meaningful visual choice for the described service. Penalize merely visual
    but wrong-trade candidates. For example, pavers, walkways, and outdoor lighting are not
    relevant to an interior bathroom remodel. Use the service summary as the primary boundary.

    Return JSON only with exactly one result for every candidate key:
    {"results":[{"key":"candidate_key","relevanceScore":0.0,"reason":"brief grounded reason"}]}
    Do not rename keys, omit candidates, add candidates, or include markdown.
    """

    validation_context_json: str = dspy.InputField(
        desc="JSON with exact service context and the normalized candidate components to score."
    )
    candidate_count: int = dspy.InputField(desc="Exact number of candidates that require a result.")
    component_relevance_json: str = dspy.OutputField(
        desc="JSON object with a results array containing key, relevanceScore in [0,1], and reason per candidate."
    )


class RefinementComponentSemanticValidatorProgram(dspy.Module):
    def __init__(self) -> None:
        super().__init__()
        self.prog = dspy.Predict(RefinementComponentSemanticValidatorSignature)

    def forward(self, *, validation_context_json: str, candidate_count: int):  # type: ignore[override]
        pred = self.prog(
            validation_context_json=validation_context_json,
            candidate_count=int(candidate_count),
        )
        cleaned = _sanitize_validation_json(getattr(pred, "component_relevance_json", None))
        if cleaned:
            setattr(pred, "component_relevance_json", cleaned)
        return pred


def _run_validator_once(
    *,
    context: Mapping[str, str],
    candidates: Sequence[Mapping[str, Any]],
    retry_hint: str | None,
) -> Tuple[Dict[str, Any] | None, Any]:
    validation_context: Dict[str, Any] = {
        "category_id": context.get("category_id") or None,
        "category_name": context.get("category_name") or None,
        "subcategory_id": context.get("subcategory_id") or None,
        "subcategory_name": context.get("subcategory_name") or None,
        "company_summary": context.get("company_summary") or None,
        "service_summary": context.get("service_summary") or None,
        "candidates": list(candidates),
        "acceptance_threshold": SEMANTIC_RELEVANCE_THRESHOLD,
    }
    if retry_hint:
        validation_context["validation_retry_hint"] = retry_hint

    lm_config = make_dspy_lm_for_module(
        module_env_prefix="DSPY_REFINEMENT_COMPONENT_VALIDATOR",
        allow_small_models=False,
    )
    if not lm_config:
        return None, None

    lm = dspy.LM(
        model=lm_config["model"],
        temperature=_coerce_float(os.getenv("DSPY_REFINEMENT_COMPONENT_VALIDATOR_TEMPERATURE"), 0.0),
        max_tokens=_coerce_int(os.getenv("DSPY_REFINEMENT_COMPONENT_VALIDATOR_MAX_TOKENS"), 2048),
        timeout=_coerce_float(os.getenv("DSPY_REFINEMENT_COMPONENT_VALIDATOR_TIMEOUT"), 45.0),
    )
    configure_dspy(lm)

    program = RefinementComponentSemanticValidatorProgram()
    with dspy.context(lm=lm):
        prediction = program(
            validation_context_json=_compact_json(validation_context),
            candidate_count=len(candidates),
        )
    usage = extract_dspy_usage(prediction)
    raw = str(getattr(prediction, "component_relevance_json", "") or "").strip()
    if not raw:
        return None, usage
    try:
        parsed = json.loads(raw)
    except Exception:
        return None, usage
    return (parsed if isinstance(parsed, dict) else None), usage


def validate_refinement_components(payload: Dict[str, Any]) -> Dict[str, Any]:
    request_id = f"refinement_component_validation_{int(time.time() * 1000)}"
    context = _resolve_context(payload)
    candidates = resolve_candidate_components(payload)

    if not context["category_name"] and not context["subcategory_name"] and not context["service_summary"]:
        return {
            "ok": False,
            "error": "missing_service_context",
            "message": "Provide category/subcategory context or a service summary.",
            "requestId": request_id,
        }
    if not candidates:
        return {
            "ok": False,
            "error": "missing_components",
            "message": "Provide at least one candidate component.",
            "requestId": request_id,
        }

    last_usage: Any = None
    retry_hint: str | None = None
    for _attempt in range(2):
        parsed, usage = _run_validator_once(
            context=context,
            candidates=candidates,
            retry_hint=retry_hint,
        )
        last_usage = usage or last_usage
        if isinstance(parsed, dict) and isinstance(parsed.get("results"), list):
            return {
                "ok": True,
                "requestId": request_id,
                "source": "dspy_refinement_component_semantic_validator",
                "threshold": SEMANTIC_RELEVANCE_THRESHOLD,
                "results": normalize_semantic_validation_results(candidates, parsed.get("results")),
                "lmUsage": last_usage,
            }
        retry_hint = (
            "Return JSON only with a results array and exactly one key, relevanceScore, and reason entry "
            "for every supplied candidate."
        )

    return {
        "ok": False,
        "error": "semantic_validator_failed",
        "message": "Semantic validator could not produce component relevance scores.",
        "requestId": request_id,
        "lmUsage": last_usage,
    }


__all__ = [
    "SEMANTIC_RELEVANCE_THRESHOLD",
    "normalize_semantic_validation_results",
    "resolve_candidate_components",
    "validate_refinement_components",
]
