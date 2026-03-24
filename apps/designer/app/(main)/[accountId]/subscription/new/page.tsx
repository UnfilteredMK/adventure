"use client";

import { useEffect, useState } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';
import { useAccount } from '@/contexts/AccountContext';
import { useAccountSubscription } from '@/hooks/use-account-subscription';
import { useStripeMode } from '@/hooks/use-stripe-mode';
import { useToast } from '@/hooks/use-toast';
import { ArrowLeft, Check } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { FullPageLoader } from '@/components/ui/full-page-loader';

interface Plan {
  plan_id: string;
  name: string;
  monthly_price_cents: number | null;
  ai_credits_included: number;
  max_widgets: number | null;
  lead_capture_level: string;
  support_level: string;
  onboarding_type: string;
  analytics_level: string;
  prompt_packs_level: string;
  white_label: boolean;
  api_access: boolean;
  revenue_share: boolean;
  exclusivity: boolean;
  is_pricing_custom: boolean;
  created_at: string;
  updated_at: string;
}

export default function NewSubscriptionPage() {
  const [plansLoading, setPlansLoading] = useState(true);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [processingPlan, setProcessingPlan] = useState<string | null>(null);

  const { session } = useAuth();
  const { setCurrentAccount, userAccounts } = useAccount();
  const router = useRouter();
  const params = useParams();
  const { toast } = useToast();
  const accountId = params?.accountId as string;
  const { mode: stripeMode } = useStripeMode();

  const { isOwner, loading: subscriptionLoading, error: subscriptionError } = useAccountSubscription(
    accountId ?? null,
    { enabled: !!session?.user && !!accountId },
  );

  useEffect(() => {
    if (!session?.user || !accountId) {
      router.push('/auth');
      return;
    }
    if (subscriptionLoading) return;

    if (subscriptionError) {
      toast({
        title: 'Error',
        description: 'Failed to load account details.',
        variant: 'destructive',
      });
      router.push('/accounts');
      return;
    }

    if (!isOwner) {
      toast({
        title: 'Access Denied',
        description: 'Only account owners can manage billing and subscriptions.',
        variant: 'destructive',
      });
      router.push('/accounts');
    }
  }, [accountId, isOwner, router, session?.user, subscriptionError, subscriptionLoading, toast]);

  useEffect(() => {
    async function fetchPlans() {
      try {
        const response = await fetch('/api/stripe/plans');
        if (!response.ok) {
          throw new Error(`HTTP error! status: ${response.status}`);
        }
        const data = await response.json();
        setPlans(data || []);
      } catch (err) {
        setError('Failed to load plans');
      } finally {
        setPlansLoading(false);
      }
    }
    fetchPlans();
  }, []);

  const formatPrice = (cents: number | null) => {
    if (cents === null || cents === 0) return 'Free';
    return `$${(cents / 100).toLocaleString()}`;
  };

  const handleBackButton = () => {
    // Find the previous account (not the current one)
    const otherAccounts = userAccounts.filter((ua: any) => ua.account_id !== accountId);
    if (otherAccounts.length > 0) {
      // Go to the first other account's designer instances
      const previousAccount = otherAccounts[0];
      
      // Update the current account context to match the account we're going to
      const acc = previousAccount.accounts;
      const fullAccount = {
        id: acc.id,
        name: acc.name,
        slug: acc.slug,
        description: acc.description ?? '',
        created_at: acc.created_at ?? '',
        updated_at: acc.updated_at ?? '',
        user_status: previousAccount.user_status,
        account_id: previousAccount.account_id,
      };
      setCurrentAccount(fullAccount);
      
      router.push(`/${previousAccount.account_id}/designer-instances`);
    } else {
      // If no other accounts, go to accounts page
      router.push('/accounts');
    }
  };

  const getPlanFeatures = (plan: Plan): string[] => {
    const features = [];
    if (plan.ai_credits_included === 999999) {
      features.push('Unlimited AI Credits');
    } else {
      features.push(`${plan.ai_credits_included?.toLocaleString() || 0} AI Credits/month`);
    }
    if (plan.max_widgets === null) {
      features.push('Unlimited Widgets');
    } else {
      features.push(`${plan.max_widgets} Widgets`);
    }
    switch (plan.lead_capture_level) {
      case 'basic': features.push('Basic Lead Capture'); break;
      case 'crm': features.push('CRM Integration'); break;
      case 'api': features.push('API Access & Webhooks'); break;
    }
    switch (plan.support_level) {
      case 'standard': features.push('Standard Support'); break;
      case 'priority': features.push('Priority Support'); break;
      case 'dedicated': features.push('Dedicated Support'); break;
    }
    switch (plan.analytics_level) {
      case 'basic': features.push('Basic Analytics'); break;
      case 'advanced': features.push('Advanced Analytics'); break;
      case 'enterprise': features.push('Enterprise Analytics'); break;
    }
    if (plan.white_label) features.push('White Labeling');
    if (plan.api_access) features.push('Full API Access');
    if (plan.revenue_share) features.push('Revenue Share Options');
    if (plan.exclusivity) features.push('Exclusivity Options');
    return features;
  };

  const getPartnerFeatures = (plan: Plan): string[] => {
    const features: string[] = [];
    features.push('Managed onboarding');
    if (plan.support_level) features.push('Dedicated support');
    if (plan.api_access) features.push('API access');
    if (plan.analytics_level) features.push('Advanced analytics');
    if (plan.white_label) features.push('White-label available');
    if (plan.revenue_share) features.push('Revenue share available');
    if (plan.exclusivity) features.push('Exclusivity options');
    features.push('Custom integrations');
    return features;
  };

  const handlePlanSelection = async (plan: Plan) => {
    try {
      setProcessingPlan(plan.plan_id);
      // Support Basic, Pro, and Partner
      const lowered = plan.name.toLowerCase();
      const planName = lowered as 'basic' | 'pro' | 'enterprise' | 'partner';
      const response = await fetch('/api/stripe/create-checkout-session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ planName, mode: stripeMode, accountId }),
      });
      if (!response.ok) {
        throw new Error('Failed to create checkout session');
      }
      const { url } = await response.json();
      if (url) {
        window.location.href = url;
      } else {
        throw new Error('No checkout URL received');
      }
    } catch (error) {
      setError('Failed to create checkout session. Please try again.');
    } finally {
      setProcessingPlan(null);
    }
  };

  // Order plans: non-custom first, then custom-priced (e.g., Partner)
  const orderedPlans = [...plans].sort((a, b) => {
    if (a.is_pricing_custom === b.is_pricing_custom) {
      const aPrice = a.monthly_price_cents ?? Number.MAX_SAFE_INTEGER;
      const bPrice = b.monthly_price_cents ?? Number.MAX_SAFE_INTEGER;
      return aPrice - bPrice;
    }
    return a.is_pricing_custom ? 1 : -1;
  });

  if (subscriptionLoading || plansLoading) {
    return <FullPageLoader title="Loading plans…" />;
  }

  if (!session?.user || !accountId) {
    return null;
  }

  return (
    <div className="min-h-screen bg-transparent py-10">
      <div className="max-w-5xl mx-auto px-4">
        {/* Back Button */}
        <div className="mb-6">
          <Button
            variant="ghost"
            onClick={handleBackButton}
            className="-ml-2 flex items-center gap-2 text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="h-4 w-4" />
            Back to Other Account
          </Button>
        </div>
        {/* Header */}
        <div className="text-center mb-10 space-y-3">
          <h1 className="text-3xl sm:text-4xl font-semibold tracking-tight text-foreground">
            Choose Your Plan
          </h1>
          <p className="text-sm sm:text-base text-muted-foreground max-w-lg mx-auto">
            Start with a 14-day free trial. Scale as you grow.
          </p>
        </div>

        {/* Pricing Toggle removed: showing all plans below */}

        {/* Error Display */}
        {error && (
          <div className="mb-6 rounded-2xl border border-destructive/20 bg-destructive/10 p-4">
            <p className="text-sm text-destructive">{error}</p>
            <button
              onClick={() => setError(null)}
              className="mt-2 text-sm text-destructive/80 hover:text-destructive"
            >
              Dismiss
            </button>
          </div>
        )}

        {/* Plans */}
        {error ? (
          <div className="text-center py-8">
            <p className="text-destructive mb-4">
              Error loading plans: {error}
            </p>
            <Button onClick={() => window.location.reload()} variant="outline">
              Try Again
            </Button>
          </div>
        ) : (
          <div className="grid md:grid-cols-3 gap-6">
            {orderedPlans.map((plan) => (
              <Card
                key={plan.plan_id}
                className={`relative transition-shadow hover:shadow-lg ${
                  plan.name.toLowerCase() === 'pro'
                    ? 'border-primary/40 ring-2 ring-ring/20'
                    : ''
                }`}
              >
                {/* Badge */}
                {plan.name.toLowerCase() === 'pro' && (
                  <div className="absolute -top-3 left-1/2 transform -translate-x-1/2">
                    <Badge className="px-3 py-1 text-[11px] shadow-sm">
                      Most popular
                    </Badge>
                  </div>
                )}

                {/* Name and price */
                }
                <CardHeader className="text-center">
                  <CardTitle className="text-lg">{plan.name}</CardTitle>
                  <div className="mt-2 text-3xl font-semibold tracking-tight text-foreground">
                    {plan.onboarding_type === 'partner' || plan.monthly_price_cents === null ? (
                      'Custom'
                    ) : plan.monthly_price_cents === 0 ? (
                      'Free'
                    ) : (
                      <>
                        {formatPrice(plan.monthly_price_cents)}
                        <span className="ml-1 text-sm font-normal text-muted-foreground">/month</span>
                      </>
                    )}
                  </div>
                </CardHeader>

                {/* Features */}
                <CardContent>
                <ul className="space-y-3 mb-8">
                  {(plan.onboarding_type === 'partner' ? getPartnerFeatures(plan) : getPlanFeatures(plan)).map((feature, featureIndex) => (
                    <li key={featureIndex} className="flex items-center text-sm">
                      <Check className="h-4 w-4 text-green-500 mr-3 flex-shrink-0" />
                      <span className="text-muted-foreground">{feature}</span>
                    </li>
                  ))}
                </ul>

                {/* CTA */}
                {plan.monthly_price_cents === null ? (
                  <Button
                    className="w-full"
                    variant="secondary"
                    onClick={() => window.location.href = '/contact'}
                  >
                    Contact Sales
                  </Button>
                ) : (
                  <Button
                    onClick={() => handlePlanSelection(plan)}
                    disabled={processingPlan === plan.plan_id}
                    className="w-full"
                    variant={plan.name.toLowerCase() === 'pro' ? 'default' : 'outline'}
                  >
                    {processingPlan === plan.plan_id ? 'Processing...' : 'Start Trial'}
                  </Button>
                )}
                </CardContent>
              </Card>
            ))}
          </div>
        )}

        {/* Footer */}
        <div className="text-center mt-8">
          <p className="text-sm text-muted-foreground">
            All plans include a 14-day free trial. No credit card required.
          </p>
        </div>
      </div>
    </div>
  );
} 
