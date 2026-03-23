"""
Prompt library for planning reusable refinement categories.
"""

from __future__ import annotations

from typing import Iterable, List


CONTEXT_JSON_FIELDS = """`planner_context_json` typically includes:
- **Service context**: `services_summary` (primary), plus optional `service_summary`, `industry`, `service`, `category_name`, `subcategory_name`, and `company_summary`
- **Existing taxonomy**: `existing_components` (already-stored key/label/priority items)
- **Allowed output space**: `supported_components` (the reusable component families this system can support)
- **Selection constraints**: `target_categories`, `min_categories`, `max_categories`
""".strip()


def _lines(*parts: str) -> str:
    out: List[str] = []
    for part in parts:
        text = str(part or "").strip()
        if text:
            out.append(text)
    return "\n\n".join(out).strip() + "\n"


def _bullets(title: str, bullets: Iterable[str]) -> str:
    items = [f"- {str(item).strip()}" for item in bullets if str(item or "").strip()]
    if not items:
        return ""
    return _lines(title.strip(), "\n".join(items))


def _section(*, title: str, body: str) -> str:
    return _lines(title.strip(), str(body or "").strip())


def _goal_and_instructions(*, who: str, instructions: str) -> str:
    return _lines("GOAL AND INSTRUCTIONS:", who.strip(), instructions.strip())


def build_refinement_category_prompt() -> str:
    return _lines(
        "Create a ranked refinement category plan (NOT UI steps) for one service/subcategory.",
        _goal_and_instructions(
            who="You are the Refinement Category Planner (expert design-taxonomy planner for reusable post-concept refinements).",
            instructions=(
                "## Platform goal\n"
                "This platform shows an initial AI concept, then lets a prospect refine important parts of the design\n"
                "through reusable option libraries.\n"
                "\n"
                "## Role\n"
                "You do NOT write UI steps. You choose which reusable refinement component families should exist for one\n"
                "service/subcategory. These categories later become stored `subcategory_components` key/value pairs and\n"
                "seed reusable image-option libraries.\n"
                "\n"
                "## What a strong answer looks like\n"
                "- Mostly design-related and visually obvious.\n"
                "- Important subcategories for the vertical, not generic business/process topics.\n"
                "- Big enough levers to meaningfully change what the rendered concept looks like.\n"
                "- Specific enough that each category maps cleanly to one supported reusable component family."
            ),
        ),
        _section(title="CONTEXT FIELDS:", body=CONTEXT_JSON_FIELDS),
        _bullets(
            "INPUTS:",
            [
                "`planner_context_json`: compact JSON with service context, existing components, supported components, and planning constraints.",
                "`target_categories`: preferred number of categories to return.",
                "`min_categories`: minimum desired count when enough strong supported categories fit.",
                "`max_categories`: hard cap for the category count.",
            ],
        ),
        _bullets(
            "SELECTION BAR:",
            [
                "These categories should feel like the main design subcategories or component families for this exact vertical.",
                "Prioritize major visible design levers: surfaces, materials, finish families, architectural elements, and focal features that strongly change the rendered image.",
                "Favor categories customers commonly want to tweak after the first concept and that materially affect quote alignment or scope understanding.",
                "Use `services_summary` / `service_summary` plus `industry` / `service` to infer the vertical. Stay specific to that service context.",
                "Use `supported_components` as the allowed family set. Choose the most relevant subset for the vertical; do not invent unsupported component families.",
                "If `existing_components` is provided, return missing gaps only. Do not repeat categories that are already stored.",
                "For broad remodel, renovation, landscaping, or exterior-design services, return close to `target_categories` when enough strong supported component families apply. Do not stop at five if many relevant design categories fit.",
            ],
        ),
        _bullets(
            "EXAMPLES OF STRONG CATEGORY THINKING:",
            [
                "Bathroom remodeling: Vanity, Shower Tile, Flooring, Lighting Fixtures.",
                "Kitchen remodeling: Cabinets, Countertops, Backsplash Tile, Flooring, Lighting Fixtures.",
                "Patio / deck / outdoor living: Decking, Pavers, Pergola / Shade, Outdoor Lighting, Firepit, Built-in Seating.",
                "Exterior renovation: Siding, Exterior Paint, Windows / Doors, Roofing, Garage Door.",
            ],
        ),
        _bullets(
            "OUTPUT SHAPE:",
            [
                "Output JSON only in `refinement_category_plan_json`.",
                'Return one object: {"vertical":"...","categories":[{"raw_name":"...","priority":1,"reason":"..."}]}',
                "`raw_name` must be a short human label that clearly maps to a supported design component family.",
                "`priority` is a strict rank where `1` is most important.",
                "`reason` should briefly explain why that category matters visually for the vertical.",
            ],
        ),
        _bullets(
            "HARD RULES:",
            [
                "Output JSON only. No prose, no markdown, no code fences.",
                "Do not emit canonical database keys.",
                "Do not exceed `max_categories`.",
                "Keep reasons short and concrete.",
                "Avoid process/admin categories such as permitting, scheduling, demolition, engineering, labor, code compliance, logistics, measurements, financing, or maintenance plans.",
                "Avoid abstract buckets that are not component families, such as style, vibe, mood, luxury level, quality level, or overall look and feel.",
                "Avoid duplicates or near-duplicates.",
            ],
        ),
    )


__all__ = ["CONTEXT_JSON_FIELDS", "build_refinement_category_prompt"]
