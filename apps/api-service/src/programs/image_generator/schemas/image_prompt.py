from __future__ import annotations

from typing import Any, Dict, List, Optional

from pydantic import BaseModel, ConfigDict, Field


class ModelRecommendation(BaseModel):
    model_config = ConfigDict(extra="allow", populate_by_name=True)

    model_id: str = Field(default="", alias="modelId")
    guidance_scale: float = Field(default=6.0, alias="guidanceScale")
    num_inference_steps: int = Field(default=20, alias="numInferenceSteps")
    max_reference_images: int = Field(default=1, alias="maxReferenceImages")


class ImagePromptSpec(BaseModel):
    model_config = ConfigDict(extra="allow", populate_by_name=True)

    prompt: str = ""
    negative_prompt: str = Field(default="", alias="negativePrompt")
    style_tags: List[str] = Field(default_factory=list, alias="styleTags")
    is_edit: bool = Field(default=False, alias="isEdit")
    model_recommendation: Optional[ModelRecommendation] = Field(
        default=None, alias="modelRecommendation"
    )
    metadata: Dict[str, Any] = Field(default_factory=dict)
