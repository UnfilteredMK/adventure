"""
Prompt library used by DSPy signatures.

This module is intentionally "fixed" and reusable across programs.
Vertical-agnostic: adapt to services_summary; no hardcoded industries.
"""

from __future__ import annotations

from typing import Iterable, List

from programs.question_planner.form_skeleton import (
    BANNED_PRE_CONCEPT_KEYS,
    SCOPE_KEYS,
    SKELETON_DESCRIPTION,
)


CONTEXT_JSON_FIELDS = """`planner_context_json` typically includes:
- **Service context**: `services_summary` (primary), plus optional `industry` and `service`
- **What's done** (used to find the next gap): `asked_step_ids`, `answered_qa` (list of {stepId, question, answer})
- **Hints/constraints** (hint-only; do not overfit):
  - `allowed_mini_types_hint`
  - `choice_option_min` / `choice_option_max` / `choice_option_target`
  - `batch_constraints` (e.g. min/max steps per batch, token budget)
  - `required_uploads`
- **Copy/form intelligence** (prompt conditioning):
  - `copy_context` (brand voice, commitment stage, objection preemption, etc.)
""".strip()


def _lines(*parts: str) -> str:
    out: List[str] = []
    for p in parts:
        t = str(p or "").strip()
        if t:
            out.append(t)
    return "\n\n".join(out).strip() + "\n"


def _bullets(title: str, bullets: Iterable[str]) -> str:
    items = [f"- {str(b).strip()}" for b in bullets if str(b or "").strip()]
    if not items:
        return ""
    return _lines(title.strip(), "\n".join(items))


def _section(*, title: str, body: str) -> str:
    return _lines(title.strip(), str(body or "").strip())


def _goal_and_instructions(*, who: str, instructions: str) -> str:
    return _lines("GOAL AND INSTRUCTIONS:", who.strip(), instructions.strip())


def _planner_goal_and_instructions() -> str:
    return _goal_and_instructions(
        who="You are the Form Planner (expert intake agent: designer + estimator).",
        instructions=(
            "## Platform goal\n"
            "This is an AI Pre-Design & Sales Conversion Platform. The form collects context through questions\n"
            "to generate visual pre-designs (AI images) that help prospects visualize their project before getting\n"
            "a quote. The goal is visual alignment integrated with quoting.\n"
            "\n"
            "## Role\n"
            "You do NOT plan the flow. The skeleton is fixed. You FILL GAPS: given `asked_step_ids` and "
            "`answered_qa`, output the next slot that fits the skeleton and is not yet done. "
            "Each slot has a PART CONTRACT: some need full output (copy + options), others need copy only.\n"
            "\n"
            "## Form skeleton (per-slot contract)\n"
            f"{SKELETON_DESCRIPTION}\n"
            "\n"
            "## Per-slot output rules\n"
            f"- **scope** (full): Output key in {', '.join(SCOPE_KEYS)}. Include question AND option_hints. "
            "Adapt options to services_summary (vertical-agnostic).\n"
            "- **style_direction** (copy only): Output key=style_direction, question, min_selections (3–5), max_selections (3–5). "
            "NO option_hints (options come from DB). Only emit style_direction after scope is complete.\n"
            "- **budget_range** (copy only): Output key=budget_range, question (headline), subtext. "
            "NO min/max/options (range comes from pricing API). Slider component is fixed.\n"
            "- **service / upload**: Output empty (deterministic).\n"
            f"- Do NOT use: {', '.join(BANNED_PRE_CONCEPT_KEYS)} (refinements phase).\n"
            "\n"
            "## How to behave\n"
            "- Look at asked_step_ids and answered_qa. What's the next skeleton slot that isn't done?\n"
            "- Vertical-agnostic: adapt copy and options to `services_summary`; don't invent facts.\n"
            "- Use `copy_context` for tone and wording style.\n"
            "\n"
            "## Output boundary\n"
            "You output a plan (keys + question + per-slot fields). For copy-only slots, omit option_hints and range."
        ),
    )


def build_planner_prompt() -> str:
    return _lines(
        "Create a question plan (NOT UI steps).",
        _planner_goal_and_instructions(),
        _section(title="CONTEXT FIELDS:", body=CONTEXT_JSON_FIELDS),
        _section(
            title="COPY & FORM INTELLIGENCE (use `copy_context`):",
            body=_lines(
                "If `planner_context_json.copy_context` is present, use it to shape *how* questions are written (not what to ask).",
                _bullets(
                    "Guidance:",
                    [
                        "Use `brand_voice` + `user_state` to choose tone (friendly expert by default).",
                        "Use `commitment_stage` to keep early questions low-threat + easy; increase specificity later.",
                        "For each plan item, implicitly choose a `question_intent` (from `question_intent_palette`) and write the question accordingly.",
                        "Keep early questions low answer-effort (respect `answer_effort_preference`) and low risk (respect `risk_posture`).",
                        "Respect `sensitivity_level`: if high, avoid playfulness/cleverness; prefer calm, reassuring phrasing.",
                        "Use `justification_tolerance` to decide whether to include a brief \"so we can …\" justification clause in the question (keep it short).",
                        "Use `escape_hatch_policy` to decide whether to explicitly include a skip/\"Not sure\" style escape hatch in wording (when appropriate).",
                        "If `objection_preemption` is true, add light reassurance only when it helps (e.g. \"No spam\" / \"Takes <1 minute\").",
                        "Keep questions concise (target `max_question_words_soft`), unless a narrowing question truly needs more context.",
                        "If `must_be_a_question` is true, each `question` must end as a real question.",
                        "Never add UI chrome (progress bars, step numbers) unless `progress_style` asks for it; if you do, keep it subtle.",
                        "Use `progress_narrative` sparingly to frame momentum/clarity/reward in natural language (no marketing hype).",
                    ],
                ).strip(),
            ).strip(),
        ),
        _bullets(
            "INPUTS:",
            [
                "`planner_context_json`: compact JSON with service + memory + constraints (see above).",
                "`max_steps`: maximum number of plan items to emit.",
                "`allowed_mini_types`: allowed UI step types (policy). In this service, use `multiple_choice` for planning questions.",
            ],
        ),
        _bullets(
            "HARD RULES:",
            [
                "Output MUST be JSON only (no prose, no markdown, no code fences) in `question_plan_json`.",
                "Output MUST be a SINGLE JSON OBJECT string (not multiple objects) and MUST NOT echo the prompt or inputs.",
                "Keep the JSON compact: no extra whitespace/newlines beyond what JSON requires.",
                "Return at most `max_steps` plan items.",
                "Do NOT repeat already asked steps (use `answered_qa[].stepId` and/or `asked_step_ids` when provided).",
                "Do NOT invent step ids. Only output `key`. The renderer will assign `id = step-<key>`.",
                "Never output or imply `prompt_input` / `step-promptInput` as a planned question.",
                "Each plan item MUST include a user-facing `question` string (what the user will see).",
                "`question` must be direct + concrete (no 'Ask user...' / meta-instructions).",
                "Use `services_summary` to keep questions/wording relevant; avoid invented facts.",
                "Avoid overly-generic buckets unless unavoidable (e.g. 'Basic/Mid/High/Luxury').",
                "For multi-select lists, keep options tightly relevant (don’t mix unrelated categories).",
                "FILL GAPS: Output only the next slot(s). If next slot is service/upload, output empty.",
                f"Scope keys for full output: {', '.join(SCOPE_KEYS)}. Copy-only keys: style_direction, budget_range. Banned: {', '.join(BANNED_PRE_CONCEPT_KEYS)}.",
            ],
        ),
        _bullets(
            "REQUIRED RENDER HINTS:",
            [
                "For SCOPE (full) steps: type_hint=multiple_choice or segmented_choice, MUST include option_hints.\n"
                "  - project_type (ALWAYS first scope question): Use services_summary to pick VERTICAL-SPECIFIC options. "
                "Example – Bathroom: Shower+tub+vanity overhaul, Full remodel, Flooring and tiling only, Paint+fixtures refresh, New bathroom, Not sure. "
                "Example – Kitchen: Cabinets+counters, Full remodel, Backsplash+appliances, New build, Not sure. "
                "Do NOT use generic New/install, Update/redesign. Be specific to what that vertical actually does.\n"
                "  - project_parts/update_areas: concise labels for what user can update (e.g. area names, room types).\n"
                "  - remodel_intensity: e.g. \"Light refresh\" / \"Partial\" / \"Full redesign\".\n"
                "  - Keep ~3–8 options; include 'Other' when appropriate.",
                "For style_direction (copy only): question + min_selections + max_selections. NO option_hints.",
                "For budget_range (copy only): question (headline) + subtext. NO min/max/option_hints.",
                "If scope question allows multiple answers, set `allow_multiple: true`.",
                "For 'Other' free-text, set `allow_other: true` and optionally `other_label` / `other_placeholder`.",
            ],
        ),
    )


__all__ = ["CONTEXT_JSON_FIELDS", "build_planner_prompt"]
