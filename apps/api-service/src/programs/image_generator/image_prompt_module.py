"""Facade that delegates to use-case-specific DSPy modules (scene, scene-placement, tryon)."""

from __future__ import annotations

from typing import Any

from programs.image_generator.scene_placement_prompt_module import ScenePlacementPromptModule
from programs.image_generator.scene_refinement_prompt_module import SceneRefinementPromptModule
from programs.image_generator.scene_prompt_module import ScenePromptModule
from programs.image_generator.tryon_prompt_module import TryonPromptModule


def _normalize_use_case(use_case: str) -> str:
    raw = str(use_case or "scene").strip().lower().replace("_", "-")
    if raw in ("tryon", "try-on"):
        return "tryon"
    if raw == "scene-placement":
        return "scene-placement"
    if raw == "scene-refinement":
        return "scene-refinement"
    if raw == "drilldown":
        return "scene"
    return raw if raw in ("scene", "scene-placement", "scene-refinement", "tryon") else "scene"


class ImagePromptModule:
    """
    Facade: delegates to ScenePromptModule, ScenePlacementPromptModule, or TryonPromptModule
    based on use_case. Preserves backward compatibility for callers that pass the legacy
    unified input shape (including use_case).
    """

    def __init__(self) -> None:
        self._scene = ScenePromptModule()
        self._scene_placement = ScenePlacementPromptModule()
        self._scene_refinement = SceneRefinementPromptModule()
        self._tryon = TryonPromptModule()

    def forward(
        self,
        *,
        service_name: str = "",
        service_summary: str = "",
        use_case: str = "scene",
        is_edit: bool = False,
        user_preferences: str = "",
        style_tags: str = "",
        budget_level: str = "",
        location: str = "",
        context_json: str = "",
        batch_id: str = "",
    ) -> Any:
        uc = _normalize_use_case(use_case)

        if uc == "scene":
            return self._scene(
                service_name=service_name or "Home improvement",
                service_summary=service_summary or "",
                is_edit=is_edit,
                user_preferences=user_preferences,
                reference_adherence=(
                    "Hard constraint: treat uploaded reference image as the anchor. Preserve camera angle, geometry, perspective, "
                    "lighting direction, and unchanged structures; only edit requested scope."
                    if is_edit
                    else ""
                ),
                style_tags=style_tags,
                budget_level=budget_level,
                location=location,
            )
        if uc == "scene-placement":
            return self._scene_placement(
                service_summary=service_summary or "Place product in scene.",
                subject=service_name.strip()[:140] or "project",
                style_tags=style_tags,
                location=location,
                scene_context="User provided a scene as background.",
                product_context="User provided a product to place in the scene.",
                user_preferences=user_preferences,
                reference_adherence=(
                    "Hard constraint: preserve the scene anchor image composition, camera, geometry, and lighting; "
                    "perform local inpaint-style changes only."
                ),
                budget_requirements=(
                    f"Hard constraint: match final materials/finish realism to budget level '{budget_level}'"
                    if str(budget_level or "").strip()
                    else "Use realistic mid-range materials and avoid luxury overreach."
                ),
                budget_level=budget_level,
            )
        if uc == "scene-refinement":
            return self._scene_refinement(
                service_summary=service_summary or "Refine the current scene design.",
                subject=service_name.strip()[:140] or "project",
                style_tags=style_tags,
                location=location,
                scene_context="User provided an existing scene to refine in place.",
                user_preferences=user_preferences,
                reference_adherence=(
                    "Hard constraint: preserve the current scene anchor image composition, camera, geometry, perspective, "
                    "lighting direction, and all unchanged elements. Only make the requested local design changes."
                ),
                budget_requirements=(
                    f"Hard constraint: match final materials/finish realism to budget level '{budget_level}'"
                    if str(budget_level or "").strip()
                    else "Use realistic mid-range materials and avoid luxury overreach."
                ),
                budget_level=budget_level,
            )
        if uc == "tryon":
            return self._tryon(
                product_or_style_context=service_summary or "Photorealistic virtual try-on.",
                style_direction=style_tags or "photorealistic try-on",
                constraints="Natural fit, correct draping and shadows.",
            )
        return self._scene(
            service_name=service_name or "Home improvement",
            service_summary=service_summary or "",
            is_edit=is_edit,
            user_preferences=user_preferences,
            reference_adherence=(
                "Hard constraint: treat uploaded reference image as the anchor. Preserve camera angle, geometry, perspective, "
                "lighting direction, and unchanged structures; only edit requested scope."
                if is_edit
                else ""
            ),
            style_tags=style_tags,
            budget_level=budget_level,
            location=location,
        )


__all__ = ["ImagePromptModule"]
