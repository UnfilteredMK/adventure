"""
Prompt library used by DSPy signatures.

This module is intentionally "fixed" and reusable across programs.
"""

from __future__ import annotations

from typing import Iterable, List


CONTEXT_JSON_FIELDS = """`planner_context_json` typically includes:
- **Service context**: `services_summary` (primary), plus optional `industry` and `service`
- **State/memory**: `answered_qa` (list of {stepId, question, answer}), `asked_step_ids` (dedupe)
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
            "a quote. The goal is visual alignment integrated with quoting—prospects become \"visual buyers\"\n"
            "who are more qualified before the first conversation.\n"
            "\n"
            "## Role\n"
            "You generate the *next best questions* to ask. Your job is to select the minimum set of questions that\n"
            "maximizes downstream success for the given `platform_goal`, while staying aligned to\n"
            "the specific service context (industry/service + service_summary + company_summary (if provided)).\n"
            "\n"
            "## How to behave\n"
            "- Vertical-agnostic: your approach should work for any industry/service.\n"
            "- Do not copy an industry's specifics from examples unless the current `services_summary` calls for it.\n"
            "- MAXIMUM 4 questions before concept. Keep the form short to show value early.\n"
            "- Funnel order (STRICT): style_direction → project_parts/update_areas. No other steps.\n"
            "- Do NOT add granular steps like fixtures, lighting_style, storage, materials, finish, countertops, flooring.\n"
            "  Those details are for the refinements phase AFTER the concept appears. Before concept: only style, scope, budget.\n"
            "- Ask 1 scoping question (project_parts / update_areas / remodel_intensity) to narrow what the user wants done.\n"
            "  Use keys like project_parts, update_areas, or remodel_intensity — NOT 'scope' (banned).\n"
            "- Budget is collected by a deterministic widget step, not by planner-generated questions.\n"
            "- Do not generate a `budget_range` plan item.\n"
            "- Avoid operational logistics like permits, timeline, or contractor scheduling (unless explicitly required by the service context).\n"
            "- Use memory (`answered_qa`, `asked_step_ids`) to avoid repeats and stay consistent.\n"
            "- Use constraints/hints (allowed types, option targets, batch constraints, required uploads) as guidance, not rigid requirements.\n"
            "\n"
            "## Output boundary\n"
            "You do NOT output UI steps. You output a plan (keys + user-facing question intent) for what to ask next."
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
                "ORDERING (IMPORTANT): Exactly 2 steps after service: style → scope. No extras.\n"
                "  - Position 1: style_direction (visual direction).\n"
                "  - Position 2: project_parts or update_areas or remodel_intensity (scope: what to update).\n"
                "  - Do NOT add fixture_preference, lighting_style, storage_style, materials, finish, countertops, flooring, etc.\n"
                "  - Those granular choices belong in the refinements phase after the concept appears.",
                "KEYS (IMPORTANT): For the pre-concept funnel, use ONLY these keys:\n"
                "  - style_direction (visual direction)\n"
                "  - project_parts or update_areas or remodel_intensity (scope)\n"
                "  - Do NOT use: fixture_preference, lighting_style, storage_style, material_preference, finish_style, color_tone, countertop_material, flooring_material, etc.",
                "STYLE_GRID (CRITICAL): The first step MUST be style_direction with 10–20 distinct style options.\n"
                "  - Each option: {label, value, image_prompt}. No fewer than 10 style options (excluding Other).\n"
                "  - Question: \"Pick 3 or so ideal styles from the grid.\" Set allow_multiple: true.\n"
                "  - This renders as an image grid; users select ~3 styles. Respect choice_option_min/max from context.",
            ],
        ),
        _bullets(
            "REQUIRED RENDER HINTS:",
            [
                "In this service, pre-concept planning questions are rendered as `multiple_choice`.\n"
                "For `multiple_choice` items, every plan item MUST include `option_hints`.\n"
                "  - Format: either a list of strings (labels) OR a list of objects {label, value?, image_prompt?, price_tier?}.\n"
                "  - For steps that will be shown as image choices (e.g. style_direction, material_preference, shape), include short `image_prompt` per option so each option can be rendered as an image (e.g. \"modern minimalist kitchen cabinets\"). Keep `label` as plain English for overlay.\n"
                "  - REQUIRED: For style_direction, material_preference, finish_style, product/component choices, and any quality-tiered option set, ALWAYS include `price_tier` on every option.\n"
                "    Use: '$' = budget/builder-grade, '$$' = mid-range, '$$$' = premium, '$$$$' = luxury/custom.\n"
                "    The `image_prompt` for each option MUST reflect its price tier visually — e.g.:\n"
                "      '$' option: \"vinyl plank flooring, builder-grade, basic fixtures\" (not luxury materials)\n"
                "      '$$' option: \"engineered hardwood, mid-range quartz countertops\"\n"
                "      '$$$' option: \"solid hardwood, natural stone, semi-custom cabinetry\"\n"
                "      '$$$$' option: \"wide-plank white oak, Calacatta marble, bespoke millwork\"\n"
                "    The images generated for each option must LOOK different in material quality, not just style.\n"
                "  - DO NOT include `price_tier` on irrelevant questions (e.g., scheduling, logistics, pure yes/no, or non-cost-sensitive preferences).\n"
                "  - For `remodel_intensity`, prefer labels like \"Light refresh\" / \"Partial remodel\" / \"Full remodel\".\n"
                "  - For style_direction (first step): REQUIRED 10–20 options. Each option MUST have `image_prompt`. Renders as image grid; user picks ~3. Set `allow_multiple: true`.",
                "  - For other steps: keep to ~3–8 options; include 'Not sure yet' / 'Other' only when it makes sense.",
                "If a question should allow selecting multiple answers, set `allow_multiple: true`.",
                "If you want to support an 'Other' free-text option, set `allow_other: true` and optionally `other_label` / `other_placeholder`.",
                "These are hints only: do NOT output full UI step schemas (no `id`, no `options` array, no frontend-only fields).",
            ],
        ),
    )


__all__ = ["CONTEXT_JSON_FIELDS", "build_planner_prompt"]
