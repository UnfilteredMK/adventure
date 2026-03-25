import type { UIStep } from "@/types/ai-form";

function resolveStyleGridSubject(serviceOption: any): string {
  const haystack = [
    typeof serviceOption?.serviceName === "string" ? serviceOption.serviceName : "",
    typeof serviceOption?.styleQuestion === "string" ? serviceOption.styleQuestion : "",
    typeof serviceOption?.serviceSummary === "string" ? serviceOption.serviceSummary : "",
  ]
    .join(" ")
    .toLowerCase();

  if (haystack.includes("bathroom") || haystack.includes("bath ")) return "bathroom";
  if (haystack.includes("kitchen")) return "kitchen";
  if (haystack.includes("garden") || haystack.includes("landscape")) return "garden";
  if (haystack.includes("patio") || haystack.includes("deck")) return "patio";
  if (haystack.includes("bedroom")) return "bedroom";
  if (haystack.includes("living room")) return "living room";
  if (haystack.includes("office")) return "office";
  return "space";
}

export function buildDeterministicStyleStep(serviceOption: any): UIStep | null {
  const styleOptions = Array.isArray(serviceOption?.styleOptions) ? serviceOption.styleOptions : [];
  if (styleOptions.length === 0) return null;
  const subject = resolveStyleGridSubject(serviceOption);

  return {
    id: "step-style-direction",
    type: "image_choice_grid",
    question: `Here are some ideas for your ${subject}`,
    humanism: "Tap one you like",
    options: styleOptions
      .map((opt: any) => ({
        label: String(opt?.label || ""),
        value: String(opt?.value || opt?.label || ""),
        imageUrl: typeof opt?.imageUrl === "string" ? opt.imageUrl : "",
      }))
      .filter((opt: any) => opt.label && opt.value && opt.imageUrl)
      .slice(0, 9),
    multi_select: false,
    columns: 3,
    metricGain: 0.12,
  } as UIStep;
}
