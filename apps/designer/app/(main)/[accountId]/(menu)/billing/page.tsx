"use client";

import { useEffect, useState, useCallback } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import { useCredits } from '@/contexts/CreditContext';
import { useAuth } from '@/contexts/AuthContext';
import { useAccountSubscription } from '@/hooks/use-account-subscription';
import { useStripeMode } from '@/hooks/use-stripe-mode';
import { useCreditPurchaseStatus } from '@/hooks/use-credit-purchase-status';
import { SettingsShell } from '@/components/layout/SettingsShell';
import { 
  BillingLayout, 
  CreditsTab, 
  BillingTab, 
  InvoicesTab 
} from '@/components/billing';
import { CreditLogsTable } from '@/components/billing/CreditLogsTable';
import { Spinner } from '@/components/ui/spinner';
import {
  type BillingSnapshot,
  fetchBillingSnapshotCached,
  getCachedBillingSnapshot,
  makeBillingSnapshotCacheKey,
} from '@/lib/billing-snapshot-cache';
import type { Plan, UserSubscription } from '@/types/plans';


type TabType = 'credits' | 'billing' | 'invoices';

// Adapter interfaces to match component expectations
interface ComponentSubscription {
  id: string;
  status: string;
  ai_credits_balance: number;
  stripe_customer_id?: string;
  end_date?: string;
  plan_id?: string;
  additional_credit_price?: number;
}

interface ComponentPlan {
  plan_id: string;
  name: string;
  monthly_price_cents: number;
  ai_credits_included: number;
  is_pricing_custom: boolean;
}

export default function BillingPage() {
  const router = useRouter();
  const params = useParams();
  const { session } = useAuth();
  const { updateCredits, refreshCredits } = useCredits();
  const accountId = params.accountId as string;
  const { mode: stripeMode } = useStripeMode();
  const { /* addPendingPurchase */ } = useCreditPurchaseStatus(accountId);

  const { isOwner: isAccountOwner } = useAccountSubscription(accountId ?? null, {
    enabled: !!accountId && !!session?.user,
  });

  const billingCacheKey = session?.user?.id ? makeBillingSnapshotCacheKey(session.user.id, accountId) : null;
  const cachedSnapshot = billingCacheKey ? getCachedBillingSnapshot(billingCacheKey) : null;
  
  const [activeTab, setActiveTab] = useState<TabType>('credits');
  const [subscription, setSubscription] = useState<UserSubscription | null>(cachedSnapshot?.subscription ?? null);
  const [plans, setPlans] = useState<Plan[]>(cachedSnapshot?.plans ?? []);
  const [currentPlan, setCurrentPlan] = useState<Plan | null>(cachedSnapshot?.currentPlan ?? null);
  const [loading, setLoading] = useState(false);
  const [paymentProcessing, setPaymentProcessing] = useState(false);
  const [fetchingData, setFetchingData] = useState(!cachedSnapshot);
  const [subscriptionLoading, setSubscriptionLoading] = useState(!cachedSnapshot);
  const [autoPurchaseEnabled, setAutoPurchaseEnabled] = useState(cachedSnapshot?.autoPurchaseEnabled ?? true);
  const [autoPurchaseAmount, setAutoPurchaseAmount] = useState(cachedSnapshot?.autoPurchaseAmount ?? 40);
  const [upgradeModalOpen, setUpgradeModalOpen] = useState(false);
  const [selectedPlan, setSelectedPlan] = useState<Plan | null>(null);
  const [showSuccessMessage, setShowSuccessMessage] = useState(false);
  const [showErrorMessage, setShowErrorMessage] = useState(false);
  const [successMessage, setSuccessMessage] = useState('');
  const [errorMessage, setErrorMessage] = useState('');
  const userId = session?.user?.id ?? null;



  // Prevent page scrolling while on the billing page
  useEffect(() => {
    const html = document.documentElement;
    const body = document.body;

    const prevHtmlOverflow = html.style.getPropertyValue('overflow');
    const prevBodyOverflow = body.style.getPropertyValue('overflow');
    const prevHtmlOverscroll = html.style.getPropertyValue('overscroll-behavior');
    const prevBodyOverscroll = body.style.getPropertyValue('overscroll-behavior');

    html.style.setProperty('overflow', 'hidden');
    body.style.setProperty('overflow', 'hidden');
    html.style.setProperty('overscroll-behavior', 'none');
    body.style.setProperty('overscroll-behavior', 'none');

    return () => {
      if (prevHtmlOverflow) {
        html.style.setProperty('overflow', prevHtmlOverflow);
      } else {
        html.style.removeProperty('overflow');
      }
      if (prevBodyOverflow) {
        body.style.setProperty('overflow', prevBodyOverflow);
      } else {
        body.style.removeProperty('overflow');
      }
      if (prevHtmlOverscroll) {
        html.style.setProperty('overscroll-behavior', prevHtmlOverscroll);
      } else {
        html.style.removeProperty('overscroll-behavior');
      }
      if (prevBodyOverscroll) {
        body.style.setProperty('overscroll-behavior', prevBodyOverscroll);
      } else {
        body.style.removeProperty('overscroll-behavior');
      }
    };
  }, []);

  // Adapter functions to transform data for components
  const adaptSubscription = (sub: UserSubscription | null): ComponentSubscription | null => {
    if (!sub) return null;
    return {
      id: sub.subscription_id,
      status: sub.status || 'inactive',  // Provide default if null
      ai_credits_balance: sub.ai_credits_balance,
      stripe_customer_id: sub.stripe_customer_id || undefined,
      end_date: sub.end_date || undefined,
      plan_id: sub.plan_id || undefined,
      additional_credit_price: sub.additional_credit_price || undefined
    };
  };

  const adaptPlan = (plan: Plan): ComponentPlan => {
    return {
      plan_id: plan.plan_id,
      name: plan.name,
      monthly_price_cents: plan.monthly_price_cents,
      ai_credits_included: plan.ai_credits_included,
      is_pricing_custom: plan.is_pricing_custom
    };
  };

  const showSuccess = (message: string) => {
    setSuccessMessage(message);
    setShowSuccessMessage(true);
    setShowErrorMessage(false);
    setTimeout(() => setShowSuccessMessage(false), 5000);
  };

  const showError = (message: string) => {
    setErrorMessage(message);
    setShowErrorMessage(true);
    setShowSuccessMessage(false);
    setTimeout(() => setShowErrorMessage(false), 5000);
  };

  const applySnapshot = useCallback((snapshot: BillingSnapshot) => {
    setSubscription(snapshot.subscription);
    setPlans(snapshot.plans);
    setCurrentPlan(snapshot.currentPlan);
    setAutoPurchaseEnabled(snapshot.autoPurchaseEnabled);
    setAutoPurchaseAmount(snapshot.autoPurchaseAmount);
  }, []);

  const refreshSubscriptionData = useCallback(
    async (opts?: { background?: boolean; force?: boolean }) => {
      if (!accountId) return;
      if (!session?.user?.id) {
        router.push('/auth');
        return;
      }

      if (!opts?.background) {
        setFetchingData(true);
        setSubscriptionLoading(true);
      }

      try {
        const snapshot = await fetchBillingSnapshotCached(session.user.id, accountId, {
          force: opts?.force,
        });
        applySnapshot(snapshot);
      } finally {
        setFetchingData(false);
        setSubscriptionLoading(false);
      }
    },
    [accountId, applySnapshot, router, session?.user?.id],
  );

  useEffect(() => {
    refreshSubscriptionData();
  }, [refreshSubscriptionData]);

  // Redirect non-owners away from billing tab
  useEffect(() => {
    if (!isAccountOwner && activeTab === 'billing') {
      setActiveTab('credits');
    }
  }, [isAccountOwner, activeTab]);

  // Subscribe to realtime updates for this account's subscription; drop manual polling
  useEffect(() => {
    if (!userId || !accountId) return;

    const channel = supabase
      .channel(`billing_${accountId}`)
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'user_subscriptions',
          filter: `account_id=eq.${accountId}`
        },
        (payload: any) => {
          // When subscription updates (e.g., credits changed), refresh local state
          refreshSubscriptionData({ background: true, force: true });
          // Also push the new balance to the global credits context for Navbar
          const newBalance = payload?.new?.ai_credits_balance;
          if (typeof newBalance === 'number') {
            updateCredits(newBalance);
          }
          // Ensure UI syncs across contexts
          refreshCredits();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [userId, accountId, refreshSubscriptionData, updateCredits, refreshCredits]);

  // Handler functions
  const handlePurchaseCredits = async (amount: number) => {
    if (!isAccountOwner) return;
    setLoading(true);
    setPaymentProcessing(true);
    try {
      const requestData = { amount, accountId: accountId, mode: stripeMode };
      
      const response = await fetch("/api/stripe/manual-credit-purchase", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(requestData)
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || "Failed to purchase credits");
      }

      const responseData = await response.json();
      
      const { success, paymentIntentId, creditsToAdd, message } = responseData;
      if (success && paymentIntentId) {
        // Keep the inline loader on and rely on realtime subscription + refresh
        // Allow realtime to update the UI; do a safety refresh shortly after
        setTimeout(() => {
          refreshSubscriptionData({ background: true, force: true });
          refreshCredits();
          setLoading(false);
          setPaymentProcessing(false);
        }, 1500);
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
      showError(`Failed to purchase credits: ${errorMessage}`);
      setLoading(false);
      setPaymentProcessing(false);
    }
  };

  const handleManageBilling = async () => {
    setLoading(true);
    try {
      const response = await fetch("/api/stripe/create-customer-portal", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: stripeMode, accountId: accountId })
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || "Failed to create customer portal session");
      }

      const { url } = await response.json();
      if (url) {
        window.location.href = url;
      } else {
        throw new Error("No customer portal URL received");
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
      showError(`Failed to open billing portal: ${errorMessage}`);
    } finally {
      setLoading(false);
    }
  };



  const handleAutoPurchaseToggle = async (enabled: boolean) => {
    if (!isAccountOwner) return;
    setLoading(true);
    try {
      const response = await fetch('/api/user-subscriptions/account', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          accountId, 
          auto_purchase_enabled: enabled, 
          auto_purchase_amount: enabled ? autoPurchaseAmount : null 
        }),
      });
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to update auto-purchase settings');
      }
      setAutoPurchaseEnabled(enabled);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
      showError(`Failed to update auto-purchase settings: ${errorMessage}`);
    } finally {
      setLoading(false);
    }
  };

  const handleAutoPurchaseAmountChange = async (amount: number) => {
    if (!isAccountOwner) return;
    setLoading(true);
    try {
      const response = await fetch('/api/user-subscriptions/account', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          accountId, 
          auto_purchase_enabled: autoPurchaseEnabled, 
          auto_purchase_amount: amount 
        }),
      });
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to update auto-purchase amount');
      }
      setAutoPurchaseAmount(amount);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
      showError(`Failed to update auto-purchase amount: ${errorMessage}`);
    } finally {
      setLoading(false);
    }
  };

  const handleUpgradeClick = (plan: ComponentPlan) => {
    const fullPlan = plans.find(p => p.plan_id === plan.plan_id);
    setSelectedPlan(fullPlan || null);
    setUpgradeModalOpen(true);
  };

  const handleNewSubscription = async (plan: ComponentPlan) => {
    const fullPlan = plans.find(p => p.plan_id === plan.plan_id);
    if (!fullPlan) return;
    
    setLoading(true);
    try {
      if (fullPlan.name === "Enterprise") {
        router.push(`/${accountId}/contact`);
        return;
      }

      const response = await fetch("/api/stripe/create-checkout-session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          planName: fullPlan.name.toLowerCase() as "basic" | "pro" | "enterprise",
          mode: stripeMode,
          accountId: accountId
        })
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || "Failed to create checkout session");
      }

      const { url } = await response.json();
      if (url) {
        window.location.href = url;
      } else {
        throw new Error("No checkout URL received");
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
      showError(`Failed to create checkout session: ${errorMessage}`);
    } finally {
      setLoading(false);
    }
  };

  const handleCancelPlan = async () => {
    setLoading(true);
    try {
      // Use customer portal for subscription cancellation
      const response = await fetch("/api/stripe/create-customer-portal", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: stripeMode, accountId: accountId })
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || "Failed to create customer portal session");
      }

      const { url } = await response.json();
      window.location.href = url;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
      showError(`Failed to open customer portal: ${errorMessage}`);
    } finally {
      setLoading(false);
    }
  };

  const handleConfirmUpgrade = async () => {
    if (!selectedPlan) return;
    
    setLoading(true);
    try {
      if (selectedPlan.name === "Enterprise") {
        router.push(`/${accountId}/contact`);
        return;
      }

      const response = await fetch("/api/stripe/upgrade-plan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          planName: selectedPlan.name.toLowerCase() as "basic" | "pro" | "enterprise",
          mode: stripeMode,
          accountId: accountId
        })
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || errorData.details || `Failed to upgrade plan: ${response.statusText}`);
      }

      const { success } = await response.json();
      if (success) {
        setUpgradeModalOpen(false);
        setSelectedPlan(null);
        showSuccess("Your plan has been updated successfully.");
        setTimeout(() => {
          window.location.reload();
        }, 2000);
      } else {
        throw new Error("Upgrade was not successful");
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
      showError(`Failed to upgrade plan: ${errorMessage}`);
    } finally {
      setLoading(false);
    }
  };

  // Computed values
  const isInTrial = subscription?.status === 'trialing';
  const trialEndDate = subscription?.end_date ? new Date(subscription.end_date) : null;
  const daysLeftInTrial = trialEndDate ? Math.ceil((trialEndDate.getTime() - new Date().getTime()) / (1000 * 60 * 60 * 24)) : 0;
  const hasActiveSubscription = subscription?.status === 'active' || subscription?.status === 'trialing';
  const hasStripeCustomer = Boolean(subscription?.stripe_customer_id);

  if (fetchingData || subscriptionLoading) {
    return (
      <SettingsShell
        accountId={accountId}
        active="billing"
        title="Settings"
        description="Billing, credits, and invoices."
      >
        <div className="flex items-center justify-center py-16">
          <Spinner className="h-6 w-6 text-muted-foreground" />
          <div className="ml-3 text-sm text-muted-foreground">Loading billing…</div>
        </div>
      </SettingsShell>
    );
  }

  return (
    <div>
      <SettingsShell
        accountId={accountId}
        active="billing"
        title="Settings"
        description="Billing, credits, and invoices."
      >
        <BillingLayout activeTab={activeTab} onTabChange={setActiveTab} isAccountOwner={isAccountOwner}>
          {activeTab === 'credits' && (
            <CreditsTab
              subscription={adaptSubscription(subscription)}
              loading={paymentProcessing}
              hasActiveSubscription={hasActiveSubscription}
              hasStripeCustomer={hasStripeCustomer}
              accountId={accountId}
              canPurchase={isAccountOwner}
              autoPurchaseEnabled={autoPurchaseEnabled}
              autoPurchaseAmount={autoPurchaseAmount}
              onPurchaseCredits={handlePurchaseCredits}
              onManageBilling={handleManageBilling}
              onAutoPurchaseToggle={handleAutoPurchaseToggle}
              onAutoPurchaseAmountChange={handleAutoPurchaseAmountChange}
            />
          )}
          
          {activeTab === 'billing' && isAccountOwner && (
            <BillingTab
              subscription={adaptSubscription(subscription)}
              plans={plans.map(adaptPlan)}
              currentPlan={currentPlan ? adaptPlan(currentPlan) : null}
              loading={loading}
              showSuccessMessage={showSuccessMessage}
              showErrorMessage={showErrorMessage}
              successMessage={successMessage}
              errorMessage={errorMessage}
              hasActiveSubscription={hasActiveSubscription}
              hasStripeCustomer={hasStripeCustomer}
              isInTrial={isInTrial}
              daysLeftInTrial={daysLeftInTrial}
              trialEndDate={trialEndDate}
              upgradeModalOpen={upgradeModalOpen}
              selectedPlan={selectedPlan ? adaptPlan(selectedPlan) : null}
              onUpgradeClick={handleUpgradeClick}
              onNewSubscription={handleNewSubscription}
              onCancelPlan={handleCancelPlan}
              onManageBilling={handleManageBilling}
              onConfirmUpgrade={handleConfirmUpgrade}
              setUpgradeModalOpen={setUpgradeModalOpen}
            />
          )}
          
          {activeTab === 'invoices' && (
            <InvoicesTab
              hasStripeCustomer={hasStripeCustomer}
              loading={loading}
              onManageBilling={handleManageBilling}
            />
          )}
        </BillingLayout>
      </SettingsShell>
    </div>
  );
}
