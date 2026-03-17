"use client";

import { useEffect, useState } from "react";
import { useRouter, useParams } from "next/navigation";
import { createClientComponent } from '@/config/supabase';
import { useToast } from '@/hooks/use-toast';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { ArrowLeft, Check, ConciergeBell, Store } from "lucide-react";
import { CategorySelector } from '@/components/features/CategorySelector';
import { defaultDesignSettingsV2 } from "@/types/design-v2";
import { compactDesignConfigToV2 } from "@/lib/design-config-v2";
import type { FlowConfig } from "@/types/flow";

export default function NewInstancePage() {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [websiteUrl, setWebsiteUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const [loadingStep, setLoadingStep] = useState<string>("");
  const [mounted, setMounted] = useState(false);
  const [selectedServices, setSelectedServices] = useState<Array<{id: string, subcategory: string, description?: string | null}>>([]);
  const [instanceType, setInstanceType] = useState<'ecomm' | 'service' | null>(null);
  const [currentStep, setCurrentStep] = useState<1 | 2 | 3 | 4>(1);
  const [presetMode, setPresetMode] = useState<"form" | "iframe" | "internal">("form");
  const [userCredits, setUserCredits] = useState<number | null>(null);
  const [showCreditPricing, setShowCreditPricing] = useState<boolean>(false);
  const [pricingPreview, setPricingPreview] = useState<{
    creditPrice: number | null;
    emailLeadPrice: number | null;
    loading: boolean;
    phoneLeadPrice: number | null;
  }>({ creditPrice: null, emailLeadPrice: null, loading: false, phoneLeadPrice: null });
  const router = useRouter();
  const params = useParams();
  const { toast } = useToast();
  const supabase = createClientComponent();
  
  const accountId = params.accountId as string;

  // Plan-based limits
  const [maxWidgets, setMaxWidgets] = useState<number | null>(null);
  const [currentCount, setCurrentCount] = useState<number>(0);
  const [checkingLimit, setCheckingLimit] = useState<boolean>(true);

  // Prevent hydration issues
  useEffect(() => {
    setMounted(true);
  }, []);

  // Fetch user credits when component mounts
  useEffect(() => {
    const fetchCredits = async () => {
      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (user) {
          // For now, set a mock credit amount since the credits table might not exist
          setUserCredits(10); // Mock credits for testing
        }
      } catch (error) {
        setUserCredits(0);
      }
    };

    fetchCredits();
  }, []);

  // Fetch plan limit and current instance count for this account
  useEffect(() => {
    let isMounted = true;
    async function fetchLimits() {
      if (!accountId) return;
      setCheckingLimit(true);
      try {
        const subRes = await fetch(`/api/user-subscriptions/credits?accountId=${accountId}`, {
          headers: { 'Content-Type': 'application/json' }
        });
        let planId: string | null = null;
        if (subRes.ok) {
          const { subscription } = await subRes.json();
          planId = subscription?.plan_id || null;
        }
        if (planId) {
          const plansRes = await fetch('/api/plans', { headers: { 'Cache-Control': 'no-store' } });
          if (plansRes.ok) {
            const plans = await plansRes.json();
            const plan = Array.isArray(plans) ? plans.find((p: any) => p.plan_id === planId) : null;
            if (isMounted) setMaxWidgets(plan?.max_widgets ?? null);
          } else if (isMounted) {
            setMaxWidgets(null);
          }
        } else if (isMounted) {
          setMaxWidgets(null);
        }

        // Count existing instances for this account
        const { count } = await supabase
          .from('instances')
          .select('*', { count: 'exact', head: true })
          .eq('account_id', accountId);
        if (isMounted) setCurrentCount(count || 0);
      } catch (e) {
        if (isMounted) {
          setMaxWidgets(null);
          setCurrentCount(0);
        }
      } finally {
        if (isMounted) setCheckingLimit(false);
      }
    }
    fetchLimits();
    return () => { isMounted = false };
  }, [accountId, supabase]);

  const CREDIT_USD_BASE = 0.07;
  const CREDIT_USD_LOW = 0.05;
  const CREDIT_USD_HIGH = 0.09;

  const usdFromCredits = (credits: number) => {
    const safeCredits = Number.isFinite(credits) ? credits : 0;
    return {
      base: safeCredits * CREDIT_USD_BASE,
      high: safeCredits * CREDIT_USD_HIGH,
      low: safeCredits * CREDIT_USD_LOW,
    };
  };

  const formatUsd = (value: number) => `$${value.toFixed(2)}`;

  // Pricing preview for Step 3 (max across selected services)
  useEffect(() => {
    let cancelled = false;

    async function computePricingPreview() {
      if (selectedServices.length === 0) {
        setPricingPreview({ creditPrice: null, emailLeadPrice: null, loading: false, phoneLeadPrice: null });
        return;
      }

      setPricingPreview((prev) => ({ ...prev, loading: true }));

      const ids = selectedServices.map((s) => s.id);
      if (ids.length === 0) {
        setPricingPreview({ creditPrice: null, emailLeadPrice: null, loading: false, phoneLeadPrice: null });
        return;
      }

      try {
        let rows: any[] | null = null;
        let queryError: any = null;

        const { data, error } = await supabase
          .from("categories_subcategories")
          .select("id, email_lead_price, phone_lead_price, credit_price")
          .in("id", ids);

        if (error && String(error.message || "").includes("credit_price")) {
          const fallback = await supabase
            .from("categories_subcategories")
            .select("id, email_lead_price, phone_lead_price")
            .in("id", ids);
          rows = fallback.data as any[] | null;
          queryError = fallback.error;
        } else {
          rows = data as any[] | null;
          queryError = error;
        }

        if (queryError) throw queryError;

        let maxEmail = 1;
        let maxPhone = 1;
        let maxCredit = 1;

        for (const row of rows || []) {
          const email = Number(row?.email_lead_price ?? 0);
          const phone = Number(row?.phone_lead_price ?? 0);
          const credit = Number(row?.credit_price ?? 0);
          if (Number.isFinite(email) && email > maxEmail) maxEmail = email;
          if (Number.isFinite(phone) && phone > maxPhone) maxPhone = phone;
          if (Number.isFinite(credit) && credit > maxCredit) maxCredit = credit;
        }

        if (!cancelled) {
          setPricingPreview({
            creditPrice: maxCredit,
            emailLeadPrice: maxEmail,
            loading: false,
            phoneLeadPrice: maxPhone,
          });
        }
      } catch {
        if (!cancelled) {
          setPricingPreview((prev) => ({
            creditPrice: prev.creditPrice ?? 1,
            emailLeadPrice: prev.emailLeadPrice ?? 1,
            loading: false,
            phoneLeadPrice: prev.phoneLeadPrice ?? 1,
          }));
        }
      }
    }

    computePricingPreview();
    return () => {
      cancelled = true;
    };
  }, [selectedServices, supabase]);

  const nextFromStep1 = () => {
    if (!name.trim()) {
      toast({ title: "Error", description: "Instance name is required", variant: "destructive" });
      return;
    }
    setCurrentStep(2);
  };

  const nextFromStep2 = () => {
    if (!instanceType) {
      toast({ title: "Error", description: "Please select Service or E‑commerce", variant: "destructive" });
      return;
    }
    setCurrentStep(3);
  };

  const nextFromStep3 = () => {
    if (selectedServices.length === 0) {
      toast({ title: "Error", description: "Please select at least one service", variant: "destructive" });
      return;
    }
    setCurrentStep(4);
  };

  const defaultFlowConfig = (): FlowConfig => ({
    enabled: true,
    steps: [
      {
        id: "step-1",
        order: 0,
        type: "question",
        title: "Step 1",
        description: "Start with the primary question.",
        question: {
          id: "primary",
          type: "textarea",
          label: "What are you looking for?",
          placeholder: "Describe what you want…",
          required: false,
        },
      },
    ],
    questionGenerationMode: "manual",
    designGenerationStrategy: "progressive",
    dataCollection: { fields: [], requiredFields: [] },
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (currentStep !== 4) return;
    if (selectedServices.length === 0) {
      toast({ title: "Error", description: "Please select at least one service", variant: "destructive" });
      return;
    }
    // Enforce plan limit before attempting creation
    if (!checkingLimit && maxWidgets !== null && currentCount >= (maxWidgets || 0)) {
      toast({ title: "Limit reached", description: "You've reached your plan's instance limit. Please upgrade your plan to create more instances.", variant: "destructive" });
      return;
    }
    await createInstance();
  };

  const createInstance = async () => {
    setLoading(true);

    try {
      setLoadingStep("Checking authentication...");
      const { data: { user } } = await supabase.auth.getUser();

      if (!user) {
        throw new Error("No authenticated user found");
      }

      setLoadingStep("Generating unique URL...");
      // Generate a simple unique slug from the name and timestamp
      const baseSlug = name.trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 30); // Shorter to leave room for timestamp

      const timestamp = Date.now();
      const slug = `${baseSlug}-${timestamp}`;

      // Compute initial lead prices and credit prices based on selected services (max across selections)
      setLoadingStep("Calculating pricing...");
      const allSelectedSubcategoryIdsForPricing = selectedServices.map(service => service.id);

      let initialEmailLeadPrice = 1;
      let initialPhoneLeadPrice = 1;
      let initialCreditPrice = 1; // Default to 1 credit minimum

      if (allSelectedSubcategoryIdsForPricing.length > 0) {
        // First try to get all pricing data including credit_price
        let priceRows: any[] | null = null;
        let priceError: any = null;
        
        const { data, error } = await supabase
          .from('categories_subcategories')
          .select('id, email_lead_price, phone_lead_price, credit_price')
          .in('id', allSelectedSubcategoryIdsForPricing);

        // If credit_price column doesn't exist yet, fall back to just email and phone prices
        if (error && error.message.includes('credit_price')) {
          console.log('credit_price column not found, falling back to email/phone prices only');
          const fallbackResult = await supabase
            .from('categories_subcategories')
            .select('id, email_lead_price, phone_lead_price')
            .in('id', allSelectedSubcategoryIdsForPricing);
          
          priceRows = fallbackResult.data;
          priceError = fallbackResult.error;
        } else {
          priceRows = data;
          priceError = error;
        }

        if (!priceError && Array.isArray(priceRows)) {
          console.log('Price rows from database:', priceRows);
          for (const row of priceRows) {
            if (row.email_lead_price && row.email_lead_price > initialEmailLeadPrice) {
              initialEmailLeadPrice = row.email_lead_price as unknown as number;
            }
            if (row.phone_lead_price && row.phone_lead_price > initialPhoneLeadPrice) {
              initialPhoneLeadPrice = row.phone_lead_price as unknown as number;
            }
            // Only check credit_price if it exists in the row
            if ('credit_price' in row && row.credit_price && row.credit_price > initialCreditPrice) {
              initialCreditPrice = row.credit_price as unknown as number;
            }
          }
          console.log('Calculated initial prices:', { initialEmailLeadPrice, initialPhoneLeadPrice, initialCreditPrice });
        }
      }

      // Determine primary use case automatically
      setLoadingStep("Choosing use case...");
      let chosenUseCase: 'tryon' | 'scene' | null = null;
      let chosenModelProfile: string | null = null;
      try {
        // Derive category id list from selected services
        let catIds: string[] = [];
        if (selectedServices.length > 0) {
          const { data: subs, error: subsError } = await supabase
            .from('categories_subcategories')
            .select('id, category_id')
            .in('id', selectedServices.map(s => s.id));
          if (!subsError && subs && subs.length > 0) {
            catIds = Array.from(new Set(subs.map(s => s.category_id as string)));
          }
        }
        if (catIds.length > 0) {
          const { data: ucRows, error: ucError } = await supabase
            .from('category_use_cases')
            .select('use_case, ai_model_profile, category_id')
            .in('category_id', catIds);
          if (!ucError && Array.isArray(ucRows) && ucRows.length > 0) {
            const unique = new Map<string, { use_case: 'tryon'|'scene', ai_model_profile: string | null }>();
            ucRows.forEach((row: any) => {
              const key = row.use_case as 'tryon'|'scene';
              if (!unique.has(key) || (!unique.get(key)!.ai_model_profile && row.ai_model_profile)) {
                unique.set(key, { use_case: key, ai_model_profile: row.ai_model_profile || null });
              }
            });
            if (unique.size === 1) {
              const only = Array.from(unique.values())[0];
              chosenUseCase = only.use_case;
              chosenModelProfile = only.ai_model_profile || null;
            } else if (unique.size > 1) {
              // If multiple, pick the first deterministically
              const first = Array.from(unique.values())[0];
              chosenUseCase = first.use_case;
              chosenModelProfile = first.ai_model_profile || null;
            }
          }
        }
      } catch (err) {
        // ignore and fallback below
      }
      // Fallback by instanceType
      if (!chosenUseCase) {
        if (instanceType === 'ecomm') chosenUseCase = 'tryon';
        else if (instanceType === 'service') chosenUseCase = 'scene';
      }

      setLoadingStep("Creating AI designer...");
      const presetConfigOverrides: Partial<typeof defaultDesignSettingsV2> = {
        // Suggestions are being reworked — keep them off for all new instances.
        suggestions_enabled: false,
        ...(presetMode === "form"
          ? {
              // Form-first defaults
              form_status_enabled: true,
              form_show_progress_bar: true,
              form_show_step_descriptions: true,
              // Form experiences typically don't rely on the gallery.
              gallery_show_placeholder_images: false,
            }
          : presetMode === "iframe"
          ? {
              // Homepage embed defaults
              form_status_enabled: false,
              iframe_width: "900",
              iframe_height: "650",
              demo_enabled: true,
              lead_capture_enabled: true,
            }
          : {
              // Internal tool defaults (sales / Zoom calls)
              form_status_enabled: false,
              iframe_width: "1100",
              iframe_height: "720",
              demo_enabled: false,
              lead_capture_enabled: false,
              gallery_show_placeholder_images: false,
            }),
      };

      const initialConfig = compactDesignConfigToV2(
        { ...defaultDesignSettingsV2, ...presetConfigOverrides, brand_name: name.trim() },
        { fillDefaults: true },
      ) as any;

	      // Create instance
	      const { data: instance, error: instanceError } = await supabase
	        .from("instances")
	        .insert({
	          name: name.trim(),
          description: description.trim() || null,
          website_url: websiteUrl.trim() || null,
          user_id: user.id,
          account_id: accountId,
          slug: slug,
          is_public: true,
          submission_limit_enabled: false,
          max_submissions_per_session: 5,
	          // New fields
	          instance_type: instanceType,
	          use_case: (chosenUseCase as any) || null,
	          email_lead_price: initialEmailLeadPrice,
	          phone_lead_price: initialPhoneLeadPrice,
	          credit_price: initialCreditPrice,
	          // Preset-driven initial config
	          config: initialConfig,
	        })
	        .select()
	        .single();

      if (instanceError) {
        throw instanceError;
      }

      setLoadingStep("Setting up services...");

      // Insert all selected subcategories across multiple industries
      try {
        const allSelectedSubcategoryIds = selectedServices.map(service => service.id);

        if (allSelectedSubcategoryIds.length > 0) {
          const instanceSubcategories = allSelectedSubcategoryIds.map((subcategoryId: string) => ({
            category_subcategory_id: subcategoryId,
            instance_id: instance.id,
          }));

          const { error: insertError } = await supabase
            .from("instance_subcategories")
            .insert(instanceSubcategories);

          if (insertError) {}

          if (!insertError) {
            void fetch("/api/subcategory-image-catalog/seed-instance", {
              body: JSON.stringify({ instanceId: instance.id }),
              headers: { "content-type": "application/json" },
              keepalive: true,
              method: "POST",
            }).catch(() => undefined);
          }

          // After linking services, recompute lead prices and credit prices in case any newly inserted custom records affect pricing
          let priceRows2: any[] | null = null;
          let priceError2: any = null;
          
          const { data: data2, error: error2 } = await supabase
            .from('categories_subcategories')
            .select('id, email_lead_price, phone_lead_price, credit_price')
            .in('id', allSelectedSubcategoryIds);

          // If credit_price column doesn't exist yet, fall back to just email and phone prices
          if (error2 && error2.message.includes('credit_price')) {
            console.log('credit_price column not found in final update, falling back to email/phone prices only');
            const fallbackResult2 = await supabase
              .from('categories_subcategories')
              .select('id, email_lead_price, phone_lead_price')
              .in('id', allSelectedSubcategoryIds);
            
            priceRows2 = fallbackResult2.data;
            priceError2 = fallbackResult2.error;
          } else {
            priceRows2 = data2;
            priceError2 = error2;
          }

          if (!priceError2 && Array.isArray(priceRows2) && priceRows2.length > 0) {
            let maxEmail = 0;
            let maxPhone = 0;
            let maxCredit = 1; // Default to 1 credit minimum
            for (const row of priceRows2) {
              if (row.email_lead_price && row.email_lead_price > maxEmail) {
                maxEmail = row.email_lead_price as unknown as number;
              }
              if (row.phone_lead_price && row.phone_lead_price > maxPhone) {
                maxPhone = row.phone_lead_price as unknown as number;
              }
              // Only check credit_price if it exists in the row
              if ('credit_price' in row && row.credit_price && row.credit_price > maxCredit) {
                maxCredit = row.credit_price as unknown as number;
              }
            }
            // Update instance prices to the most expensive selected service
            console.log('Final update prices:', { maxEmail, maxPhone, maxCredit });
            const { error: updateError } = await supabase
              .from('instances')
              .update({ 
                email_lead_price: maxEmail, 
                phone_lead_price: maxPhone,
                credit_price: maxCredit
              })
              .eq('id', instance.id);
            
            if (updateError) {
              console.error('Error updating instance prices:', updateError);
            } else {
              console.log('Instance prices updated successfully');
            }
          }
        }
      } catch (serviceError) {}

      setLoadingStep("Finalizing...");

      toast({
        title: "Success",
        description: "Instance created successfully!",
      });

      // Reset loading state
      setLoading(false);
      setLoadingStep("");

      // Redirect to the designer immediately - use both methods to ensure it works
      router.push(`/${accountId}/designer-instances/instance/${instance.id}`);

      // Fallback redirect in case router.push doesn't work
      setTimeout(() => {
        window.location.href = `/${accountId}/designer-instances/instance/${instance.id}`;
      }, 100);
    } catch (error) {
      let errorMessage = "Unknown error occurred";
      if (error && typeof error === 'object') {
        if ('message' in error) {
          errorMessage = error.message as string;
        } else if ('error' in error) {
          errorMessage = (error as any).error;
        } else if ('details' in error) {
          errorMessage = (error as any).details;
        }
      }

      toast({
        title: "Error",
        description: `Failed to create instance: ${errorMessage}`,
        variant: "destructive",
      });

      // Ensure loading state is reset even if there's an error
      setLoading(false);
      setLoadingStep("");
    }
  };

  const handleAccumulatedServicesChange = (services: Array<{id: string, subcategory: string, description?: string | null}>) => {
    setSelectedServices(services);
  };

  const canProceed = !!name.trim() && selectedServices.length > 0;

  // Prevent hydration issues
  if (!mounted) {
    return (
      <div className="max-w-2xl mx-auto px-4 py-12">
        <div className="animate-pulse">
          <div className="h-8 bg-muted rounded w-1/3 mb-4"></div>
          <div className="h-4 bg-muted rounded w-2/3 mb-8"></div>
          <div className="space-y-4">
            <div className="h-10 bg-muted rounded"></div>
            <div className="h-20 bg-muted rounded"></div>
            <div className="h-32 bg-muted rounded"></div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-transparent">
      <div
        className={[
          "container mx-auto flex w-full flex-col px-4",
          currentStep === 3 ? "max-w-5xl py-6" : "max-w-3xl py-10",
        ].join(" ")}
      >
        <div className="mb-6">
          <Button
            variant="ghost"
            onClick={() => router.back()}
            className="-ml-2 text-muted-foreground hover:text-foreground"
            size="sm"
          >
            <ArrowLeft className="w-4 h-4 mr-1.5" />
            Back
          </Button>
        </div>

        <div className="mb-8">
          <h1 className="text-3xl font-semibold tracking-tight">Create AI Designer</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {currentStep === 1 && 'Step 1 of 4 · Basics'}
            {currentStep === 2 && 'Step 2 of 4 · Choose type'}
            {currentStep === 3 && 'Step 3 of 4 · Select services'}
            {currentStep === 4 && 'Step 4 of 4 · Choose mode'}
          </p>

          <div className="mt-5 grid grid-cols-4 gap-2">
            {[1, 2, 3, 4].map((step) => (
              <div
                key={step}
                className={[
                  "flex items-center justify-center gap-2 rounded-full border px-3 py-2 text-xs font-medium shadow-sm backdrop-blur",
                  step === currentStep
                    ? "border-primary/30 bg-primary/10 text-foreground"
                    : step < currentStep
                    ? "border-border/60 bg-card/60 text-muted-foreground"
                    : "border-border/60 bg-card/40 text-muted-foreground",
                ].join(" ")}
              >
                <span
                  className={[
                    "inline-flex h-5 w-5 items-center justify-center rounded-full text-[11px]",
                    step === currentStep
                      ? "bg-primary text-primary-foreground"
                      : step < currentStep
                      ? "bg-muted text-foreground"
                      : "bg-muted/60 text-muted-foreground",
                  ].join(" ")}
                >
                  {step}
                </span>
                <span className="hidden sm:inline">
                  {step === 1 ? "Basics" : step === 2 ? "Type" : step === 3 ? "Services" : "Mode"}
                </span>
              </div>
            ))}
          </div>
        </div>

        <form onSubmit={handleSubmit} className="space-y-6">
          {currentStep === 1 && (
            <div className="rounded-2xl border border-border/60 bg-card/60 p-6 shadow-sm backdrop-blur">
              <div className="space-y-5">
                <div className="space-y-2">
                  <Label className="text-sm">Name</Label>
                  <Input
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="e.g., Product Photos AI, Real Estate Visualizer"
                  />
                </div>

                <div className="space-y-2">
                  <Label className="text-sm">
                    Description <span className="text-muted-foreground">(optional)</span>
                  </Label>
                  <Textarea
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    placeholder="Briefly describe what your AI designer will do"
                    className="resize-none"
                    rows={3}
                  />
                </div>

                <div className="space-y-2">
                  <Label className="text-sm">
                    Website URL <span className="text-muted-foreground">(optional)</span>
                  </Label>
                  <Input
                    value={websiteUrl}
                    onChange={(e) => setWebsiteUrl(e.target.value)}
                    placeholder="e.g., https://yourcompany.com"
                    inputMode="url"
                  />
                </div>

                <div className="pt-2 flex justify-end">
                  <Button type="button" onClick={nextFromStep1}>
                    Next
                  </Button>
                </div>
              </div>
            </div>
          )}

	          {currentStep === 2 && (
	            <div className="rounded-2xl border border-border/60 bg-card/60 p-6 shadow-sm backdrop-blur">
	              <div className="space-y-5">
	                <div className="space-y-1.5">
	                  <Label className="text-sm">Type</Label>
	                  <p className="text-xs text-muted-foreground">
	                    Choose what you sell.
	                  </p>
	                </div>
	
		                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
		                  <button
		                    type="button"
		                    onClick={() => setInstanceType('service')}
		                    className={[
		                      "relative flex flex-col rounded-xl border p-4 text-left transition-all",
		                      "hover:border-primary/40 hover:bg-accent/30",
		                      instanceType === 'service'
		                        ? "border-primary/40 bg-primary/5 shadow-sm ring-1 ring-ring/10"
		                        : "border-border/60 bg-background/30 hover:shadow-sm",
		                    ].join(" ")}
		                  >
		                    {instanceType === "service" ? (
		                      <div className="absolute right-3 top-3 inline-flex h-7 w-7 items-center justify-center rounded-full bg-primary/10 ring-1 ring-primary/20">
		                        <Check className="h-4 w-4 text-primary" />
		                      </div>
		                    ) : null}
		                    <div className="flex items-center gap-3">
		                      <span className="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-primary/15 text-primary shadow-sm ring-1 ring-primary/10">
		                        <ConciergeBell className="h-5 w-5" />
		                      </span>
	                      <div className="min-w-0">
	                        <div className="text-sm font-semibold leading-none">Services</div>
	                        <div className="mt-1 text-xs text-muted-foreground">
	                          For service businesses.
	                        </div>
	                      </div>
	                    </div>
	
	                    <div className="mt-3 flex flex-wrap gap-1.5">
	                      <span className="rounded-full border border-border/60 bg-background/40 px-2 py-1 text-[11px] text-muted-foreground">
	                        Lead capture
	                      </span>
	                      <span className="rounded-full border border-border/60 bg-background/40 px-2 py-1 text-[11px] text-muted-foreground">
	                        Service picker
	                      </span>
	                      <span className="rounded-full border border-border/60 bg-background/40 px-2 py-1 text-[11px] text-muted-foreground">
	                        Quote-ready
	                      </span>
	                    </div>
	                  </button>
	
		                  <button
		                    type="button"
		                    onClick={() => setInstanceType('ecomm')}
		                    className={[
		                      "relative flex flex-col rounded-xl border p-4 text-left transition-all",
		                      "hover:border-primary/40 hover:bg-accent/30",
		                      instanceType === 'ecomm'
		                        ? "border-primary/40 bg-primary/5 shadow-sm ring-1 ring-ring/10"
		                        : "border-border/60 bg-background/30 hover:shadow-sm",
		                    ].join(" ")}
		                  >
		                    {instanceType === "ecomm" ? (
		                      <div className="absolute right-3 top-3 inline-flex h-7 w-7 items-center justify-center rounded-full bg-primary/10 ring-1 ring-primary/20">
		                        <Check className="h-4 w-4 text-primary" />
		                      </div>
		                    ) : null}
		                    <div className="flex items-center gap-3">
		                      <span className="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-primary/15 text-primary shadow-sm ring-1 ring-primary/10">
		                        <Store className="h-5 w-5" />
		                      </span>
	                      <div className="min-w-0">
	                        <div className="text-sm font-semibold leading-none">E‑commerce</div>
	                        <div className="mt-1 text-xs text-muted-foreground">
	                          For online product stores.
	                        </div>
	                      </div>
	                    </div>
	
	                    <div className="mt-3 flex flex-wrap gap-1.5">
	                      <span className="rounded-full border border-border/60 bg-background/40 px-2 py-1 text-[11px] text-muted-foreground">
	                        Catalog
	                      </span>
	                      <span className="rounded-full border border-border/60 bg-background/40 px-2 py-1 text-[11px] text-muted-foreground">
	                        Product visuals
	                      </span>
	                      <span className="rounded-full border border-border/60 bg-background/40 px-2 py-1 text-[11px] text-muted-foreground">
	                        Store flow
	                      </span>
	                    </div>
	                  </button>
	                </div>

                <div className="flex items-center justify-between gap-2 pt-2">
                  <Button type="button" variant="outline" onClick={() => setCurrentStep(1)}>
                    Back
                  </Button>
                  <Button type="button" onClick={nextFromStep2}>
                    Next
                  </Button>
                </div>
              </div>
            </div>
          )}

          {currentStep === 3 && (
            <div className="grid min-h-0 max-h-[calc(100dvh-220px)] grid-rows-[minmax(0,1fr)_auto] gap-4">
              <div className="grid min-h-0 grid-cols-1 gap-4 md:grid-cols-[minmax(0,1fr)_340px] md:gap-6">
                <div className="min-h-0 overflow-hidden">
                  <CategorySelector
                    onAccumulatedServicesChange={handleAccumulatedServicesChange}
                    accountId={accountId}
                    instanceType={instanceType || undefined}
                    showCategoryManagement={true}
                    variant="services"
                  />
                </div>

                <div className="min-h-0">
                  <Card className="md:sticky md:top-6">
                    <CardHeader className="pb-3">
	                      <div className="flex items-start justify-between gap-3">
	                        <div>
	                          <CardTitle className="text-base">Estimated charges</CardTitle>
	                          <CardDescription>Credits + USD estimate.</CardDescription>
	                        </div>
	                      </div>
	                    </CardHeader>

	                    <CardContent className="space-y-4">
	                      {selectedServices.length === 0 ? (
	                        <div className="rounded-xl border border-dashed border-border/60 bg-background/30 p-4 text-sm text-muted-foreground">
	                          Select at least 1 service to see pricing.
	                        </div>
	                      ) : (
	                        <>
	                          {(() => {
	                            const rows = [
	                              {
	                                credits: pricingPreview.creditPrice ?? 1,
	                                helper: "Per generated image",
	                                key: "image",
	                                label: "Image gen",
	                              },
	                              {
	                                credits: pricingPreview.emailLeadPrice ?? 1,
	                                helper: "Per captured email",
	                                key: "email",
	                                label: "Email lead",
	                              },
	                              {
	                                credits: pricingPreview.phoneLeadPrice ?? 1,
	                                helper: "Per captured phone",
	                                key: "phone",
	                                label: "Phone lead",
	                              },
	                            ];

	                            return (
	                              <div className="rounded-xl border border-border/60 bg-background/40 divide-y divide-border/60 overflow-hidden">
	                                {rows.map((row) => {
	                                  const credits = row.credits;
	                                  const creditsLabel =
	                                    pricingPreview.loading
	                                      ? "…"
	                                      : Number.isInteger(credits)
	                                      ? String(credits)
	                                      : Number(credits).toFixed(2);

	                                  const { base, high, low } = usdFromCredits(row.credits);
	                                  const usdTitle = pricingPreview.loading
	                                    ? row.helper
	                                    : `${row.helper} · USD range ${formatUsd(low)}–${formatUsd(high)} (est. ${formatUsd(base)} @ $0.07/credit)`;

	                                  return (
	                                    <div key={row.key} className="px-3 py-2.5" title={usdTitle}>
	                                      <div className="flex items-center justify-between gap-4">
	                                        <div className="min-w-0">
	                                          <div className="text-sm text-foreground">{row.label}</div>
	                                          <div className="mt-0.5 text-[11px] text-muted-foreground">{row.helper}</div>
	                                        </div>
	                                        <div className="text-right">
	                                          <div className="text-sm font-semibold tabular-nums">
	                                            {creditsLabel}{" "}
	                                            <span className="text-[11px] font-normal text-muted-foreground">credits</span>
	                                          </div>
	                                          <div className="text-[11px] text-muted-foreground tabular-nums">
	                                            ≈ {pricingPreview.loading ? "…" : formatUsd(base)}
	                                          </div>
	                                        </div>
	                                      </div>
	                                    </div>
	                                  );
	                                })}
	                              </div>
	                            );
	                          })()}
	                        </>
	                      )}
	                    </CardContent>
	                  </Card>
	                </div>
              </div>

              <div className="border-t border-border/60 pt-4">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <Button type="button" variant="outline" onClick={() => setCurrentStep(2)} className="px-6">
                    Back
                  </Button>
                  <Button
                    type="button"
                    onClick={nextFromStep3}
                    disabled={!canProceed || loading}
                    className="px-8 min-w-[200px]"
                  >
                    Next
                  </Button>
                </div>
              </div>
            </div>
          )}

          {currentStep === 4 && (
            <div className="rounded-2xl border border-border/60 bg-card/60 p-6 shadow-sm backdrop-blur">
              <div className="space-y-5">
                <div className="space-y-1.5">
                  <Label className="text-sm">Mode</Label>
                  <p className="text-xs text-muted-foreground">
                    Pick a starting preset. You can customize everything later.
                  </p>
                </div>

	                <div className="grid grid-cols-1 gap-3">
	                  <button
	                    type="button"
	                    onClick={() => setPresetMode("form")}
	                    className={[
	                      "relative rounded-xl border p-4 text-left transition-all",
	                      "hover:border-primary/40 hover:bg-accent/30",
	                      presetMode === "form"
	                        ? "border-primary/40 bg-primary/5 shadow-sm ring-1 ring-ring/10"
	                        : "border-border/60 bg-background/30 hover:shadow-sm",
	                    ].join(" ")}
	                  >
	                    {presetMode === "form" ? (
	                      <div className="absolute right-3 top-3 inline-flex h-7 w-7 items-center justify-center rounded-full bg-primary/10 ring-1 ring-primary/20">
	                        <Check className="h-4 w-4 text-primary" />
	                      </div>
	                    ) : null}
	                    <div className="text-sm font-semibold">Form mode (website traffic)</div>
	                    <div className="mt-1 text-xs text-muted-foreground">
	                      A guided flow built for visitors. Great for collecting context before generating images.
	                    </div>
	                  </button>

	                  <button
	                    type="button"
	                    onClick={() => setPresetMode("iframe")}
	                    className={[
	                      "relative rounded-xl border p-4 text-left transition-all",
	                      "hover:border-primary/40 hover:bg-accent/30",
	                      presetMode === "iframe"
	                        ? "border-primary/40 bg-primary/5 shadow-sm ring-1 ring-ring/10"
	                        : "border-border/60 bg-background/30 hover:shadow-sm",
	                    ].join(" ")}
	                  >
	                    {presetMode === "iframe" ? (
	                      <div className="absolute right-3 top-3 inline-flex h-7 w-7 items-center justify-center rounded-full bg-primary/10 ring-1 ring-primary/20">
	                        <Check className="h-4 w-4 text-primary" />
	                      </div>
	                    ) : null}
	                    <div className="text-sm font-semibold">Iframe mode (homepage embed)</div>
	                    <div className="mt-1 text-xs text-muted-foreground">
	                      Optimized for embedding directly on a landing page. Visitors generate without a separate flow.
	                    </div>
	                  </button>

	                  <button
	                    type="button"
	                    onClick={() => setPresetMode("internal")}
	                    className={[
	                      "relative rounded-xl border p-4 text-left transition-all",
	                      "hover:border-primary/40 hover:bg-accent/30",
	                      presetMode === "internal"
	                        ? "border-primary/40 bg-primary/5 shadow-sm ring-1 ring-ring/10"
	                        : "border-border/60 bg-background/30 hover:shadow-sm",
	                    ].join(" ")}
	                  >
	                    {presetMode === "internal" ? (
	                      <div className="absolute right-3 top-3 inline-flex h-7 w-7 items-center justify-center rounded-full bg-primary/10 ring-1 ring-primary/20">
	                        <Check className="h-4 w-4 text-primary" />
	                      </div>
	                    ) : null}
	                    <div className="text-sm font-semibold">Internal tool mode (sales)</div>
	                    <div className="mt-1 text-xs text-muted-foreground">
	                      Tuned for Zoom calls and sales meetings. Less “marketing” UI, more direct generation.
	                    </div>
	                  </button>
	                </div>

                <div className="flex items-center justify-between gap-2 pt-2">
                  <Button type="button" variant="outline" onClick={() => setCurrentStep(3)}>
                    Back
                  </Button>
                  <Button
                    type="button"
                    onClick={createInstance}
                    disabled={!canProceed || loading}
                  >
                    {loading ? "Creating…" : "Create Instance"}
                  </Button>
                </div>

                {loading && loadingStep ? (
                  <div className="text-xs text-muted-foreground">{loadingStep}</div>
                ) : null}
              </div>
            </div>
          )}
        </form>
      </div>
    </div>
  );
} 
