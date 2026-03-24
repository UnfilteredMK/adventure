"use client";

import { useEffect, useState, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useAuth } from '@/contexts/AuthContext';
import { useAccount } from '@/contexts/AccountContext';
import { useStripeMode } from '@/hooks/use-stripe-mode';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Loader2, AlertTriangle, CreditCard, CheckCircle, Check } from "lucide-react";

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

function PaymentRequiredPageContent() {
  const { session } = useAuth();
  const { currentAccount } = useAccount();
  const { mode: stripeMode } = useStripeMode();
  const [loading, setLoading] = useState(false);
  const [subscription, setSubscription] = useState<any>(null);
  const [resolving, setResolving] = useState(false);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [plansLoading, setPlansLoading] = useState(true);
  const [processingPlan, setProcessingPlan] = useState<string | null>(null);
  const [showPlanSelection, setShowPlanSelection] = useState(false);
  const router = useRouter();
  const searchParams = useSearchParams();
  
  const status = searchParams.get('status') || 'past_due';

  useEffect(() => {
    async function fetchData() {
      if (!session?.user) {
        router.push('/auth');
        return;
      }

      try {
        // Fetch subscription
        const response = await fetch(`/api/user-subscriptions/credits?accountId=${currentAccount?.id || ''}`, {
          headers: {
            'Content-Type': 'application/json'
          }
        });

        if (response.ok) {
          const { subscription: sub } = await response.json();
          setSubscription(sub);
        } else {}

        // Fetch plans
        const plansResponse = await fetch('/api/stripe/plans');
        if (plansResponse.ok) {
          const plansData = await plansResponse.json();
          setPlans(plansData || []);
        } else {}
      } catch (error) {} finally {
        setPlansLoading(false);
      }
    }

    fetchData();
  }, [session, router, currentAccount]);

  const handleResolvePayment = async () => {
    setResolving(true);
    try {
      // Use customer portal for all payment resolution
      const response = await fetch('/api/stripe/create-customer-portal', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          mode: stripeMode,
          accountId: currentAccount?.id,
        })
      });

      if (response.ok) {
        const { url } = await response.json();
        window.location.href = url;
      } else {}
    } catch (error) {} finally {
      setResolving(false);
    }
  };

  const handleCancelSubscription = async () => {
    setLoading(true);
    try {
      // Use customer portal for subscription cancellation
      const response = await fetch('/api/stripe/create-customer-portal', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          mode: stripeMode,
          accountId: currentAccount?.id,
        })
      });

      if (response.ok) {
        const { url } = await response.json();
        window.location.href = url;
      } else {}
    } catch (error) {} finally {
      setLoading(false);
    }
  };

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
          accountId: currentAccount?.id,
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
    } catch (error) {} finally {
      setProcessingPlan(null)
    }
  }

  const getStatusMessage = () => {
    switch (status) {
      case 'past_due':
        return {
          title: 'Payment Past Due',
          description: 'Your payment was unsuccessful. Please update your payment method to continue using our services.',
          icon: AlertTriangle,
          color: 'text-orange-600'
        };
      case 'unpaid':
        return {
          title: 'Payment Required',
          description: 'Your subscription has been suspended due to payment issues. Please resolve this to restore access.',
          icon: CreditCard,
          color: 'text-red-600'
        };
      default:
        return {
          title: 'Payment Issue',
          description: 'There is an issue with your payment. Please resolve this to continue.',
          icon: AlertTriangle,
          color: 'text-red-600'
        };
    }
  };

  const statusInfo = getStatusMessage();
  const StatusIcon = statusInfo.icon;

  if (showPlanSelection) {
    return (
      <div className="h-screen bg-white dark:bg-black flex items-center justify-center px-4 overflow-hidden">
        <div className="w-full max-w-6xl">
          <div className="text-center mb-8">
            <h1 className="text-3xl font-bold text-gray-900 dark:text-white mb-4">
              Choose a New Plan
            </h1>
            <p className="text-lg text-gray-600 dark:text-gray-400">
              Select a plan to continue using Adventure
            </p>
          </div>

          {plansLoading ? (
            <div className="grid md:grid-cols-3 gap-6">
              {[1, 2, 3].map((i) => (
                <div key={i} className="bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-lg p-6 animate-pulse">
                  <div className="h-6 bg-gray-200 dark:bg-gray-700 rounded mb-4"></div>
                  <div className="h-8 bg-gray-200 dark:bg-gray-700 rounded mb-4"></div>
                  <div className="space-y-2">
                    {[1, 2, 3, 4].map((j) => (
                      <div key={j} className="h-4 bg-gray-200 dark:bg-gray-700 rounded"></div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="grid md:grid-cols-3 gap-6">
              {plans.map((plan) => (
                <div
                  key={plan.plan_id}
                  className={`relative bg-white dark:bg-gray-900 border-2 rounded-lg p-6 transition-all duration-200 hover:shadow-lg ${
                    plan.name === 'Pro' 
                      ? 'border-blue-500 dark:border-blue-400' 
                      : 'border-gray-200 dark:border-gray-800'
                  }`}
                >
                  {/* Plan type badge */}
                  {plan.name === 'Pro' && (
                    <div className="absolute -top-3 left-1/2 transform -translate-x-1/2">
                      <span className="bg-blue-600 text-white text-xs px-3 py-1 rounded-full">
                        Most Popular
                      </span>
                    </div>
                  )}

                  {/* Plan name */}
                  <div className="text-center mb-6">
                    <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-2">
                      {plan.name}
                    </h3>
                    <div className="text-3xl font-bold text-gray-900 dark:text-white">
                      {plan.is_pricing_custom ? (
                        'Custom'
                      ) : plan.monthly_price_cents === 0 ? (
                        'Free'
                      ) : (
                        <>
                          {formatPrice(plan.monthly_price_cents)}
                          <span className="text-sm font-normal text-gray-500 dark:text-gray-400">/month</span>
                        </>
                      )}
                    </div>
                  </div>

                  {/* Features */}
                  <ul className="space-y-3 mb-8">
                    {getPlanFeatures(plan).map((feature, featureIndex) => (
                      <li key={featureIndex} className="flex items-center text-sm">
                        <Check className="h-4 w-4 text-green-500 mr-3 flex-shrink-0" />
                        <span className="text-gray-600 dark:text-gray-400">{feature}</span>
                      </li>
                    ))}
                  </ul>

                  {/* CTA Button */}
                  {plan.is_pricing_custom ? (
                    <Button
                      className="w-full transition-colors duration-200 bg-gray-600 hover:bg-gray-700 text-white"
                      onClick={() => window.location.href = '/contact'}
                    >
                      Contact Sales
                    </Button>
                  ) : (
                    <Button
                      onClick={() => handlePlanSelection(plan)}
                      disabled={processingPlan === plan.plan_id}
                      className={`w-full transition-colors duration-200 ${
                        plan.name === 'Pro'
                          ? 'bg-blue-600 hover:bg-blue-700 text-white'
                          : 'bg-gray-100 hover:bg-gray-200 dark:bg-gray-800 dark:hover:bg-gray-700 text-gray-900 dark:text-white'
                      }`}
                    >
                      {processingPlan === plan.plan_id ? 'Processing...' : 'Choose Plan'}
                    </Button>
                  )}
                </div>
              ))}
            </div>
          )}

          <div className="text-center mt-8">
            <Button
              variant="outline"
              onClick={() => setShowPlanSelection(false)}
              className="mr-4"
            >
              Back to Payment Options
            </Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="h-screen bg-white dark:bg-black flex items-center justify-center px-4 overflow-hidden">
      <div className="w-full max-w-md">
        <Card className="border-2">
          <CardHeader className="text-center">
            <div className="mx-auto mb-4">
              <StatusIcon className={`h-12 w-12 ${statusInfo.color}`} />
            </div>
            <CardTitle className="text-xl">{statusInfo.title}</CardTitle>
            <CardDescription className="text-base">
              {statusInfo.description}
            </CardDescription>
          </CardHeader>
          
          <CardContent className="space-y-4">
            {subscription && (
              <div className="p-4 bg-gray-50 dark:bg-gray-900 rounded-lg">
                <h3 className="font-semibold text-gray-900 dark:text-white mb-2">
                  Subscription Details
                </h3>
                <div className="space-y-2 text-sm text-gray-600 dark:text-gray-400">
                  <div className="flex justify-between">
                    <span>Status:</span>
                    <span className="font-medium text-red-600 dark:text-red-400 capitalize">
                      {subscription.status}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span>Amount Due:</span>
                    <span className="font-medium text-gray-900 dark:text-white">
                      ${(subscription.monthly_price_cents / 100).toFixed(2)}
                    </span>
                  </div>
                </div>
              </div>
            )}
            
            <div className="space-y-3">
              <Button
                onClick={handleResolvePayment}
                disabled={resolving}
                className="w-full bg-gray-900 dark:bg-white text-white dark:text-gray-900"
              >
                {resolving ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin mr-2" />
                    Opening payment portal...
                  </>
                ) : (
                  <>
                    <CreditCard className="h-4 w-4 mr-2" />
                    Update Payment Method
                  </>
                )}
              </Button>
              
              <Button
                onClick={handleCancelSubscription}
                disabled={loading}
                variant="outline"
                className="w-full"
              >
                {loading ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin mr-2" />
                    Canceling...
                  </>
                ) : (
                  'Cancel & Choose New Plan'
                )}
              </Button>
            </div>
            
            <div className="text-xs text-gray-500 dark:text-gray-400 text-center">
              <p>Need help? Contact support for assistance.</p>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

export default function PaymentRequiredPage() {
  return (
    <Suspense fallback={<div>Loading...</div>}>
      <PaymentRequiredPageContent />
    </Suspense>
  );
} 
