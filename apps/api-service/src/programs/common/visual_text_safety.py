from __future__ import annotations

import re
from typing import Any


_BEFORE_AFTER_RE = re.compile(r"\bbefore\s*(?:/|-|&|and)\s*after\b", re.IGNORECASE)
_EXTRA_SPACE_RE = re.compile(r"\s+")

ANTI_TEXT_OVERLAY_NEGATIVE_TERMS = (
    "text, letters, words, writing, numbers, numerals, digits, alphanumeric characters, "
    "signage, watermark, logo, labels, captions, title text, headline text, "
    "price tags, measurements, annotations, callout labels"
)

ANTI_COMPARISON_NEGATIVE_TERMS = (
    "split screen, side-by-side, diptych, triptych, collage, multi-panel, comparison layout, "
    "before-and-after graphic, before-and-after layout, infographic, poster, flyer, brochure, "
    "contact sheet, storyboard, mood board, image grid, 3x3 grid, montage, "
    "title text, headline text, caption text, callout labels, arrows"
)

SINGLE_SCENE_GUARDRAIL = (
    "Render a single finished scene only, not a split-screen comparison, side-by-side layout, "
    "diptych, collage, mood board, storyboard, contact sheet, image grid, 3x3 grid, "
    "or annotated mockup."
)


def sanitize_visual_context_text(raw: Any, *, max_len: int | None = None) -> str:
    text = str(raw or "").strip()
    if not text:
        return ""

    text = _BEFORE_AFTER_RE.sub("", text)
    text = re.sub(r"\(\s*\)", "", text)
    text = re.sub(r"\s+([,.;:!?])", r"\1", text)
    text = _EXTRA_SPACE_RE.sub(" ", text)
    text = text.strip(" \t\r\n,;:-")

    if max_len is not None:
        text = text[:max_len].strip()
    return text


__all__ = [
    "ANTI_TEXT_OVERLAY_NEGATIVE_TERMS",
    "ANTI_COMPARISON_NEGATIVE_TERMS",
    "SINGLE_SCENE_GUARDRAIL",
    "sanitize_visual_context_text",
]
