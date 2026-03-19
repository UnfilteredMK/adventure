import type { UIStep } from "@/types/ai-form";

export function buildDeterministicStyleStep(serviceOption: any): UIStep | null {
  const styleOptions = Array.isArray(serviceOption?.styleOptions) ? serviceOption.styleOptions : [];
  if (styleOptions.length === 0) return null;

  const question =
    typeof serviceOption?.styleQuestion === "string" && serviceOption.styleQuestion.trim()
      ? serviceOption.styleQuestion.trim()
      : "Pick 3-5 ideal styles from the grid.";

  return {
    id: "step-style-direction",
    type: "image_choice_grid",
    question,
    options: styleOptions
      .map((opt: any) => ({
        label: String(opt?.label || ""),
        value: String(opt?.value || opt?.label || ""),
        imageUrl: typeof opt?.imageUrl === "string" ? opt.imageUrl : "",
        ...(typeof opt?.description === "string" && opt.description ? { description: opt.description } : {}),
        ...(typeof opt?.priceTier === "string" && opt.priceTier ? { priceTier: opt.priceTier } : {}),
      }))
      .filter((opt: any) => opt.label && opt.value && opt.imageUrl)
      .slice(0, 20),
    multi_select: true,
    min_selections: 3,
    max_selections: 5,
    metricGain: 0.12,
  } as UIStep;
}
