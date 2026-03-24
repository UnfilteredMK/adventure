"use client";

import { useEffect, useState } from 'react';
import { useRouter, useParams, useSearchParams } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';
import { useAccountSubscription } from '@/hooks/use-account-subscription';
import { useStripeMode } from '@/hooks/use-stripe-mode';
import { useToast } from '@/hooks/use-toast';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { FullPageLoader } from '@/components/ui/full-page-loader';
import { CreditCard, Building2, AlertTriangle, ArrowLeft, Check } from 'lucide-react';

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

export default function PaymentFailedPage() {
  const [plans, setPlans] = useState<Plan[]>([]);
  const [plansLoading, setPlansLoading] = useState(true);
  const [processingPlan, setProcessingPlan] = useState<string | null>(null);
  const [showPlanSelection, setShowPlanSelection] = useState(false);
  
  const { session } = useAuth();
  const router = useRouter();
  const params = useParams();
  const searchParams = useSearchParams();
  const { toast } = useToast();
  
  const accountId = params?.accountId as string;
  const { mode: stripeMode } = useStripeMode();
  const error = searchParams.get('error') || 'Payment processing failed';

  const { status, isOwner, loading: subscriptionLoading, error: subscriptionError } = useAccountSubscription(
    accountId ?? null,
    { enabled: !!session?.user && !!accountId, force: true },
  );

  useEffect(() => {
    if (!session?.user || !accountId) {
      router.push('/auth');
      return;
    }
  }, [session?.user, accountId, router]);

  useEffect(() => {
    if (!session?.user || !accountId) return;
    if (subscriptionLoading) return;

    if (subscriptionError) {
      toast({
        title: 'Error',
        description: 'Failed to load subscription details.',
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
    let cancelled = false;
    (async () => {
      try {
        const plansResponse = await fetch('/api/stripe/plans');
        if (!plansResponse.ok) return;
        const plansData = await plansResponse.json();
        if (!cancelled) {
          setPlans(plansData || []);
        }
      } catch {
      } finally {
        if (!cancelled) setPlansLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  if (subscriptionLoading || plansLoading || !status?.account) {
    return <FullPageLoader title="Loading billing…" />;
  }

  const formatPrice = (cents: number | null) => {
    if (cents === null || cents === 0) return 'Free'
    return `$${(cents / 100).toLocaleString()}`
  }

  const getPlanFeatures = (plan: Plan): string[] => {
    const features = []
    
    // AI Credits
    if (plan.ai_credits_included === 999999) {
      features.push('Unlimited AI Credits')
    } else {
      features.push(`${plan.ai_credits_included?.toLocaleString() || 0} AI Credits/month`)
    }

    // Widgets
    if (plan.max_widgets === null) {
      features.push('Unlimited Widgets')
    } else {
      features.push(`${plan.max_widgets} Widgets`)
    }

    // Lead Capture
    switch (plan.lead_capture_level) {
      case 'basic':
        features.push('Basic Lead Capture')
        break
      case 'crm':
        features.push('CRM Integration')
        break
      case 'api':
        features.push('API Access & Webhooks')
        break
    }

    // Support
    switch (plan.support_level) {
      case 'standard':
        features.push('Standard Support')
        break
      case 'priority':
        features.push('Priority Support')
        break
      case 'dedicated':
        features.push('Dedicated Support')
        break
    }

    // Analytics
    switch (plan.analytics_level) {
      case 'basic':
        features.push('Basic Analytics')
        break
      case 'advanced':
        features.push('Advanced Analytics')
        break
      case 'enterprise':
        features.push('Enterprise Analytics')
        break
    }

    // Additional features
    if (plan.white_label) features.push('White Labeling')
    if (plan.api_access) features.push('Full API Access')
    if (plan.revenue_share) features.push('Revenue Share Options')
    if (plan.exclusivity) features.push('Exclusivity Options')

    return features
  }

  const handlePlanSelection = async (plan: Plan) => {
    try {
      setProcessingPlan(plan.plan_id)
      
      // Create checkout session
      const planName = plan.name.toLowerCase() as "basic" | "pro" | "enterprise"
      
      const response = await fetch('/api/stripe/create-checkout-session', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          planName,
          mode: stripeMode,
          accountId,
        }),
      })

      if (!response.ok) {
        throw new Error('Failed to create checkout session')
      }

      const { url } = await response.json()
      
      if (url) {
        // Redirect to Stripe checkout
        window.location.href = url
      } else {
        throw new Error('No checkout URL received')
      }
    } catch (error) {
      toast({
        title: 'Error',
        description: 'Failed to create checkout session. Please try again.',
        variant: 'destructive'
      });
    } finally {
      setProcessingPlan(null)
    }
  }

  if (!session?.user || !accountId) {
    return null;
  }

  if (showPlanSelection) {
    return (
      <div className="min-h-screen bg-transparent">
        <div className="container mx-auto px-4 py-10">
          <div className="max-w-6xl mx-auto">
            <div className="text-center mb-8">
              <h1 className="text-3xl sm:text-4xl font-semibold tracking-tight text-foreground mb-3">
                Choose a New Plan
              </h1>
              <p className="text-sm sm:text-base text-muted-foreground">
                Select a plan to continue using Adventure with {status.account?.name}
              </p>
            </div>

            <div className="grid md:grid-cols-3 gap-6">
                {plans.map((plan) => (
                  <Card
                    key={plan.plan_id}
                    className={`relative transition-shadow hover:shadow-lg ${
                      plan.name === 'Pro' ? 'border-primary/40 ring-2 ring-ring/20' : ''
                    }`}
                  >
                    {/* Plan type badge */}
                    {plan.name === 'Pro' && (
                      <div className="absolute -top-3 left-1/2 transform -translate-x-1/2">
                        <Badge className="px-3 py-1 text-[11px] shadow-sm">Most popular</Badge>
                      </div>
                    )}

                    {/* Plan name */}
                    <CardHeader className="text-center">
                      <CardTitle className="text-lg">{plan.name}</CardTitle>
                      <div className="mt-2 text-3xl font-semibold tracking-tight text-foreground">
                        {plan.is_pricing_custom ? (
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
                        {getPlanFeatures(plan).map((feature, featureIndex) => (
                          <li key={featureIndex} className="flex items-center text-sm">
                            <Check className="h-4 w-4 text-green-500 mr-3 flex-shrink-0" />
                            <span className="text-muted-foreground">{feature}</span>
                          </li>
                        ))}
                      </ul>

                    {/* CTA Button */}
                    {plan.is_pricing_custom ? (
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
                        variant={plan.name === 'Pro' ? 'default' : 'outline'}
                      >
                        {processingPlan === plan.plan_id ? 'Processing...' : 'Choose Plan'}
                      </Button>
                    )}
                    </CardContent>
                  </Card>
                ))}
              </div>

            <div className="text-center mt-8">
              <Button
                variant="outline"
                onClick={() => setShowPlanSelection(false)}
                className="mr-4"
              >
                Back to Payment Error
              </Button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-transparent">
      <div className="container mx-auto px-4 py-10">
        <div className="max-w-2xl mx-auto">
          {/* Header */}
          <div className="text-center mb-8">
            <div className="flex items-center justify-center mb-4">
              <AlertTriangle className="h-12 w-12 text-red-500 mr-4" />
              <CreditCard className="h-12 w-12 text-primary" />
            </div>
            <h1 className="text-3xl font-bold mb-4">Payment Failed</h1>
            <p className="text-lg text-muted-foreground mb-2">
              We couldn't process your payment for <strong>{status.account?.name}</strong>
            </p>
            <p className="text-muted-foreground">
              Please try again or choose a different plan
            </p>
          </div>

          {/* Error Details */}
          <Card className="mb-8">
            <CardHeader>
              <CardTitle className="flex items-center">
                <AlertTriangle className="h-5 w-5 text-red-500 mr-2" />
                Payment Error
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-red-600 dark:text-red-400 mb-4">
                {error}
              </p>
              <p className="text-sm text-muted-foreground">
                This could be due to insufficient funds, expired card, or other payment issues. 
                Please check your payment method and try again.
              </p>
            </CardContent>
          </Card>

          {/* Action Buttons */}
          <div className="flex flex-col sm:flex-row gap-4 justify-center mb-8">
            <Button 
              onClick={() => router.push(`/${accountId}/billing`)}
              className="flex items-center"
            >
              <CreditCard className="h-4 w-4 mr-2" />
              Try Payment Again
            </Button>
            
            <Button 
              onClick={() => setShowPlanSelection(true)}
              variant="outline"
              className="flex items-center"
            >
              <Building2 className="h-4 w-4 mr-2" />
              Choose Different Plan
            </Button>
          </div>

          <div className="flex justify-center">
            <Button 
              variant="outline"
              onClick={() => router.push('/accounts')}
              className="flex items-center"
            >
              <ArrowLeft className="h-4 w-4 mr-2" />
              Back to Accounts
            </Button>
          </div>

          {/* Support Info */}
          <div className="mt-8 text-center">
            <p className="text-sm text-muted-foreground mb-2">
              Still having trouble? Contact our support team:
            </p>
            <div className="space-y-1">
              <p className="text-sm">
                <a href="mailto:support@adventure.app" className="text-primary hover:underline">
                  support@adventure.app
                </a>
              </p>
              <p className="text-xs text-muted-foreground">
                Include your account name: {status.account?.name}
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
} 
