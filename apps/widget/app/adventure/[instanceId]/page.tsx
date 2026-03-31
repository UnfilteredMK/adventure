import { AdventureFormExperience } from "@/components/form/AdventureFormExperience";
import { AdventureWidgetExperience } from "@/components/widget/AdventureWidgetExperience";
import { prefetchWidgetInstance } from "@/lib/server/widget-prefetch";
import { resolveAIFormEnabled } from "@/lib/ai-form/config/resolve-ai-form-enabled";
import { notFound } from "next/navigation";

export const dynamic = "force-dynamic";

interface Props {
  params: { instanceId: string };
  searchParams?: Record<string, string | string[] | undefined>;
}

export default async function AdventurePage({ params, searchParams }: Props) {
  const prefetched = await prefetchWidgetInstance(params.instanceId);
  if (!prefetched?.instance) notFound();

  const formEnabled = resolveAIFormEnabled({
    instance: prefetched.instance,
    instanceConfig: prefetched.instance?.config,
    searchParams,
  });
  if (!formEnabled) {
    return (
      <AdventureWidgetExperience
        instanceId={params.instanceId}
        initialInstanceData={prefetched.instance}
        initialDesignConfig={prefetched.designConfig}
      />
    );
  }

  return (
    <AdventureFormExperience
      instanceId={params.instanceId}
      initialInstanceData={prefetched.instance}
      initialDesignConfig={prefetched.designConfig}
      designSource="widget"
    />
  );
}

