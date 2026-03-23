from programs.form_pipeline.context_builder import build_context
from programs.refinements.orchestrator import _build_refinement_planner_context, _render_refinement_catalog_steps


def test_build_context_extracts_refinement_catalog_with_valid_options() -> None:
    payload = {
        "refinementCatalog": [
            {
                "key": "vanity",
                "label": "Vanity",
                "priority": 2,
                "options": [
                    {"label": "Walnut floating", "value": "walnut_floating", "imageUrl": "https://example.com/a.jpg"},
                    {"label": "Painted classic", "value": "painted_classic", "imageUrl": "https://example.com/b.jpg"},
                ],
            },
            {
                "key": "firepit",
                "label": "Firepit",
                "priority": 1,
                "options": [
                    {"label": "Only one", "value": "only_one", "imageUrl": "https://example.com/c.jpg"},
                ],
            },
        ]
    }

    ctx = build_context(payload)

    assert ctx["refinement_catalog"] == [
        {
            "key": "vanity",
            "label": "Vanity",
            "priority": 2,
            "options": [
                {"label": "Walnut floating", "value": "walnut_floating", "imageUrl": "https://example.com/a.jpg"},
                {"label": "Painted classic", "value": "painted_classic", "imageUrl": "https://example.com/b.jpg"},
            ],
        }
    ]


def test_build_refinement_planner_context_projects_option_labels_only() -> None:
    ctx = {
        "services_summary": "Bathroom remodel concept",
        "answered_qa": [],
        "industry": "Bathroom Remodeling",
        "service": "Primary Bathroom",
        "refinement_catalog": [
            {
                "key": "vanity",
                "label": "Vanity",
                "priority": 1,
                "options": [
                    {"label": "Walnut floating", "value": "walnut_floating", "imageUrl": "https://example.com/a.jpg"},
                    {"label": "Painted classic", "value": "painted_classic", "imageUrl": "https://example.com/b.jpg"},
                ],
            }
        ],
    }

    planner_context = _build_refinement_planner_context(ctx, set())

    assert planner_context["refinement_catalog"] == [
        {
            "key": "vanity",
            "label": "Vanity",
            "priority": 1,
            "option_labels": ["Walnut floating", "Painted classic"],
        }
    ]


def test_render_refinement_catalog_steps_uses_db_options_and_fallback_copy() -> None:
    catalog = [
        {
            "key": "vanity",
            "label": "Vanity",
            "priority": 1,
            "options": [
                {"label": "Walnut floating", "value": "walnut_floating", "imageUrl": "https://example.com/a.jpg"},
                {"label": "Painted classic", "value": "painted_classic", "imageUrl": "https://example.com/b.jpg"},
            ],
        }
    ]

    emitted = _render_refinement_catalog_steps([], catalog=catalog, asked_ids=set(), max_steps=4)

    assert emitted == [
        {
            "id": "step-vanity",
            "type": "image_choice_grid",
            "question": "Which vanity option should we try next?",
            "options": catalog[0]["options"],
        }
    ]
