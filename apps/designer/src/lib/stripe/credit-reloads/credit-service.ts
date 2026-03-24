import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/types/database';
import { UserSubscription } from '@/types';
import { SubscriptionService } from '../subscriptions/subscription-service';
import { getStripeSecretKey, getResolvedStripeMode, StripeMode } from '../config';
import Stripe from 'stripe';

export class CreditService {
  private supabase: SupabaseClient<Database>;
  private subscriptionService: SubscriptionService;

  constructor(supabaseClient?: SupabaseClient<Database>) {
    // Always use service role key for backend logic
    this.supabase = supabaseClient || createClient<Database>(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );
    this.subscriptionService = new SubscriptionService(this.supabase);
  }

  // Credit rate: $1 = 10 credits (adjust as needed)
  private CREDIT_RATE = 10;

  private calculateCreditsFromAmount(amount: number): number {
    return Math.floor(amount * this.CREDIT_RATE);
  }

  private calculateCreditsFromAmountWithPrice(amount: number, additionalCreditPrice: number): number {
    return Math.floor(amount / additionalCreditPrice);
  }

  /**
   * Check if account has enough credits for an operation
   */
  async checkCredits(accountId: string, requiredCredits: number): Promise<{
    hasEnough: boolean;
    currentBalance: number;
    shortfall: number;
    canAutoPurchase: boolean;
  }> {
    try {
      const { data: subscription } = await this.supabase
        .from('user_subscriptions')
        .select('*')
        .eq('account_id', accountId)
        .in('status', ['active', 'trialing'])
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      const typedSubscription = subscription as UserSubscription | null;
      if (!typedSubscription) {
        return {
          hasEnough: false,
          currentBalance: 0,
          shortfall: requiredCredits,
          canAutoPurchase: false,
        };
      }

      const currentBalance = typedSubscription.ai_credits_balance;
      const hasEnough = currentBalance >= requiredCredits;
      const shortfall = Math.max(0, requiredCredits - currentBalance);
      const canAutoPurchase = Boolean((typedSubscription as any).auto_purchase_enabled && 
                             (typedSubscription as any).auto_purchase_amount && 
                             typedSubscription.stripe_customer_id);

      return {
        hasEnough,
        currentBalance,
        shortfall,
        canAutoPurchase,
      };
    } catch (error) {
      return {
        hasEnough: false,
        currentBalance: 0,
        shortfall: requiredCredits,
        canAutoPurchase: false,
      };
    }
  }

  /**
   * Deduct credits from account's balance
   */
  async deductCredits(accountId: string, creditsToDeduct: number, operation: string): Promise<{
    success: boolean;
    newBalance: number;
    autoPurchased: boolean;
    paymentIntentId?: string;
  }> {
    try {
      // Check current balance
      const creditCheck = await this.checkCredits(accountId, creditsToDeduct);

      if (!creditCheck.hasEnough) {
        // Try auto-purchase if enabled
        if (creditCheck.canAutoPurchase) {
          const autoPurchaseResult = await this.autoPurchaseCredits(accountId, creditCheck.shortfall);
          if (autoPurchaseResult.success) {
            // Auto-purchase initiated successfully - return with autoPurchased flag
            // The calling code should retry the operation after a short delay
            return {
              success: false, // Still need to retry the original operation
              newBalance: creditCheck.currentBalance,
              autoPurchased: true,
              paymentIntentId: autoPurchaseResult.paymentIntentId,
            };
          }
        }
        
        return {
          success: false,
          newBalance: creditCheck.currentBalance,
          autoPurchased: false,
        };
      }

      // Deduct credits
      const { data: subscription } = await this.supabase
        .from('user_subscriptions')
        .select('*')
        .eq('account_id', accountId)
        .in('status', ['active', 'trialing'])
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      const typedSubscription = subscription as UserSubscription | null;
      if (!typedSubscription) {
        throw new Error('Subscription not found');
      }

      // Safety check: Never allow negative balance
      const newBalance = Math.max(0, typedSubscription.ai_credits_balance - creditsToDeduct);

      await this.supabase
        .from('user_subscriptions')
        .update({
          ai_credits_balance: newBalance,
        })
        .eq('subscription_id', typedSubscription.subscription_id);

      return {
        success: true,
        newBalance,
        autoPurchased: false,
      };
    } catch (error) {
      return {
        success: false,
        newBalance: 0,
        autoPurchased: false,
      };
    }
  }

  /**
   * Auto-purchase credits when account goes over limit
   */
  async autoPurchaseCredits(accountId: string, requiredCredits: number): Promise<{
    success: boolean;
    amount: number | null;
    creditsPurchased: number;
    paymentIntentId?: string;
  }> {
    try {
      const { data: subscription } = await this.supabase
        .from('user_subscriptions')
        .select('*')
        .eq('account_id', accountId)
        .in('status', ['active', 'trialing'])
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      const typedSubscription = subscription as UserSubscription | null;
      if (!(typedSubscription && (typedSubscription as any).auto_purchase_enabled && (typedSubscription as any).auto_purchase_amount)) {
        return {
          success: false,
          amount: null,
          creditsPurchased: 0,
        };
      }

      const amount = (typedSubscription as any).auto_purchase_amount;
      const creditsToPurchase = this.calculateCreditsFromAmountWithPrice(amount, (typedSubscription as any).additional_credit_price);

      // Create Stripe payment intent for immediate purchase
      const stripe = new Stripe(getStripeSecretKey(getResolvedStripeMode()), {
        apiVersion: '2023-10-16',
      });

      const paymentIntent = await stripe.paymentIntents.create({
        amount: Math.round(amount * 100), // Convert to cents
        currency: 'usd',
        customer: typedSubscription.stripe_customer_id!,
        metadata: {
          type: 'auto_credit_purchase',
          accountId,
          subscriptionId: typedSubscription.subscription_id,
          stripeSubscriptionId: typedSubscription.stripe_subscription_id,
          amount: amount.toString(),
          creditsToAdd: creditsToPurchase.toString(),
          currentCredits: typedSubscription.ai_credits_balance.toString(),
          newTotalCredits: (typedSubscription.ai_credits_balance + creditsToPurchase).toString(),
          additionalCreditPrice: (typedSubscription as any).additional_credit_price?.toString() || '0.3',
          autoPurchase: 'true',
        },
        confirm: true,
        off_session: true,
      });

      if (paymentIntent.status === 'succeeded') {
        return {
          success: true,
          amount: amount,
          creditsPurchased: creditsToPurchase,
          paymentIntentId: paymentIntent.id,
        };
      } else if (paymentIntent.status === 'requires_payment_method' || paymentIntent.status === 'requires_action') {
        return {
          success: false,
          amount: null,
          creditsPurchased: 0,
        };
      } else {
        return {
          success: false,
          amount: null,
          creditsPurchased: 0,
        };
      }
    } catch (error) {
      return {
        success: false,
        amount: null,
        creditsPurchased: 0,
      };
    }
  }

  /**
   * Add monthly plan credits when subscription renews
   */
  async addMonthlyPlanCredits(accountId: string): Promise<void> {
    try {
      const { data: subscription } = await this.supabase
        .from('user_subscriptions')
        .select('*')
        .eq('account_id', accountId)
        .in('status', ['active', 'trialing'])
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      const typedSubscription = subscription as UserSubscription | null;
      if (!typedSubscription) return;

      // Get plan details
      if (!typedSubscription.plan_id) {
        return;
      }
      const { data: plan } = await this.supabase
        .from('plans')
        .select('*')
        .eq('plan_id', typedSubscription.plan_id)
        .single();

      if (!plan) return;

      // Add plan credits to balance (this is called only when payment succeeds)
      const planCredits = plan.ai_credits_included as number;
      if (typeof planCredits === 'number' && planCredits > 0) {
        const newBalance = typedSubscription.ai_credits_balance + planCredits;
        await this.supabase
          .from('user_subscriptions')
          .update({
            ai_credits_balance: newBalance,
          })
          .eq('subscription_id', typedSubscription.subscription_id);
      }

    } catch (error) {}
  }

  /**
   * Set auto-purchase settings
   */
  async setAutoPurchaseSettings(
    accountId: string, 
    enabled: boolean, 
    amount: number | null
  ): Promise<boolean> {
    try {
      await this.supabase
        .from('user_subscriptions')
        .update({
          auto_purchase_enabled: enabled,
          auto_purchase_amount: amount,
        })
        .eq('account_id', accountId)
        .in('status', ['active', 'trialing']);

      return true;
    } catch (error) {
      return false;
    }
  }

  /**
   * Purchase credits manually
   */
  async purchaseCredits(accountId: string, amount: number): Promise<boolean> {
    try {
      const { data: subscription } = await this.supabase
        .from('user_subscriptions')
        .select('*')
        .eq('account_id', accountId)
        .in('status', ['active', 'trialing'])
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      const typedSubscription = subscription as UserSubscription | null;
      if (!typedSubscription) return false;

      const creditsToPurchase = this.calculateCreditsFromAmountWithPrice(amount, (typedSubscription as any).additional_credit_price);

      // Create Stripe payment intent for immediate purchase
      const stripe = new Stripe(getStripeSecretKey(getResolvedStripeMode()), {
        apiVersion: '2023-10-16',
      });

      const paymentIntent = await stripe.paymentIntents.create({
        amount: Math.round(amount * 100), // Convert to cents
        currency: 'usd',
        customer: typedSubscription.stripe_customer_id!,
        metadata: {
          accountId,
          amount: amount.toString(),
          creditsAmount: creditsToPurchase.toString(),
          autoPurchase: 'false',
        },
        confirm: true,
        off_session: true,
      });

      if (paymentIntent.status === 'succeeded') {
        // Add credits immediately
        const newBalance = typedSubscription.ai_credits_balance + creditsToPurchase;

        await this.supabase
          .from('user_subscriptions')
          .update({
            ai_credits_balance: newBalance,
          })
          .eq('subscription_id', typedSubscription.subscription_id);

        return true;
      }

      return false;
    } catch (error) {
      return false;
    }
  }

  /**
   * Get credit usage history (simplified - no longer tracking individual usage)
   */
  async getCreditUsage(accountId: string, limit: number = 50): Promise<any[]> {
    // Since we simplified the credit system, we no longer track individual usage
    // Users can see their current balance and auto-purchase settings instead
    return [];
  }

  /**
   * Get credit purchase history (simplified - no longer tracking individual purchases)
   */
  async getCreditPurchases(accountId: string, limit: number = 50): Promise<any[]> {
    // Since we simplified the credit system, we no longer track individual purchases
    // Users can see their current balance and auto-purchase settings instead
    return [];
  }

  /**
   * Handle subscription renewal (called by webhook)
   */
  async handleSubscriptionRenewal(accountId: string): Promise<void> {
    try {
      await this.addMonthlyPlanCredits(accountId);
    } catch (error) {}
  }
} 