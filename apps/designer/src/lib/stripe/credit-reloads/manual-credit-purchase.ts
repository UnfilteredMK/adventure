import Stripe from "stripe";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { getStripeSecretKey, getResolvedStripeMode, type StripeMode } from "../config";

interface CreditPurchaseRequest {
  amount: number;
  accountId: string;
  subscriptionId: string;
  currentCredits: number;
  creditPrice: number;
}

interface CreditPurchaseResponse {
  success: boolean;
  paymentIntentId?: string;
  creditsToAdd?: number;
  message: string;
}

export class ManualCreditPurchaseService {
  public supabase: any;
  private stripe: Stripe;

  constructor(mode: StripeMode = getResolvedStripeMode()) {
    const cookieStore = cookies();
    this.supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookies: {
          get(name: string) {
            return cookieStore.get(name)?.value;
          },
        },
      }
    );

    this.stripe = new Stripe(getStripeSecretKey(mode), {
      apiVersion: '2023-10-16',
    });
  }

  /**
   * Get Supabase client with service role for webhook operations
   */
  private getServiceRoleClient() {
    return createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      {
        cookies: {
          get(name: string) {
            return undefined; // No cookies needed for service role
          },
        },
      }
    );
  }

  /**
   * Calculate credits from dollar amount
   */
  private calculateCreditsFromAmount(amount: number, creditPrice: number): number {
    return Math.floor(amount / creditPrice);
  }

  /**
   * Create PaymentIntent for manual credit purchase
   */
  async createPaymentIntent(request: CreditPurchaseRequest): Promise<CreditPurchaseResponse> {
    try {
      const { amount, accountId, subscriptionId, currentCredits, creditPrice } = request;
      
      // Calculate credits to add
      const creditsToAdd = this.calculateCreditsFromAmount(amount, creditPrice);
      const newTotalCredits = currentCredits + creditsToAdd;

      // Get user and subscription for Stripe customer ID
      const { data: { user }, error: userError } = await this.supabase.auth.getUser();

      if (!user) {
        throw new Error("User not authenticated");
      }

      const { data: subscription, error: subscriptionError } = await this.supabase
        .from("user_subscriptions")
        .select("stripe_customer_id, stripe_subscription_id")
        .eq("subscription_id", subscriptionId)
        .single();

      if (!subscription?.stripe_customer_id) {
        throw new Error("No Stripe customer found for subscription");
      }

      // Get the payment method from the active subscription
      let paymentMethodId: string | null = null;

      if (subscription.stripe_subscription_id) {
        try {
          const stripeSubscription = await this.stripe.subscriptions.retrieve(subscription.stripe_subscription_id);
          const defaultPaymentMethod = stripeSubscription.default_payment_method;
          
          if (defaultPaymentMethod) {
            paymentMethodId = typeof defaultPaymentMethod === 'string' 
              ? defaultPaymentMethod 
              : defaultPaymentMethod.id;
          }
        } catch (error) {
          // Error getting subscription payment method, will fallback to customer default
        }
      }

      // Fallback to customer's default payment method if no subscription payment method
      if (!paymentMethodId) {
        try {
          const customer = await this.stripe.customers.retrieve(subscription.stripe_customer_id);
          const defaultPaymentMethod = (customer as Stripe.Customer).invoice_settings?.default_payment_method;
          paymentMethodId = defaultPaymentMethod 
            ? (typeof defaultPaymentMethod === 'string' 
                ? defaultPaymentMethod 
                : defaultPaymentMethod.id)
            : null;
        } catch (error) {
          // Error getting customer payment method
        }
      }

      if (!paymentMethodId) {
        throw new Error("No payment method found for subscription or customer");
      }



      // Create PaymentIntent with all necessary metadata
      const paymentIntent = await this.stripe.paymentIntents.create({
        amount: Math.round(amount * 100), // Convert to cents
        currency: 'usd',
        customer: subscription.stripe_customer_id,
        payment_method: paymentMethodId,
        confirm: true,
        off_session: true,
        metadata: {
          type: 'manual_credit_purchase',
          accountId,
          subscriptionId,
          stripeSubscriptionId: subscription.stripe_subscription_id,
          amount: amount.toString(),
          creditsToAdd: creditsToAdd.toString(),
          currentCredits: currentCredits.toString(),
          newTotalCredits: newTotalCredits.toString(),
          creditPrice: creditPrice.toString(),
          userId: user.id
        }
      });



      return {
        success: true,
        paymentIntentId: paymentIntent.id,
        creditsToAdd,
        message: `Payment processing... ${creditsToAdd} credits will be added to your account.`
      };

    } catch (error) {
      return {
        success: false,
        message: error instanceof Error ? error.message : "Failed to create payment"
      };
    }
  }

  /**
   * Process successful PaymentIntent from webhook
   */
  async processSuccessfulPayment(paymentIntent: Stripe.PaymentIntent): Promise<void> {
    try {

      const metadata = paymentIntent.metadata;
      
      // Validate required metadata
      if (metadata.type !== 'manual_credit_purchase') {
        return;
      }



      const subscriptionId = metadata.subscriptionId;
      const newTotalCredits = parseInt(metadata.newTotalCredits || "0");
      const creditsToAdd = parseInt(metadata.creditsToAdd || "0");
      const currentCredits = parseInt(metadata.currentCredits || "0");

      if (!subscriptionId || newTotalCredits <= 0) {
        return;
      }





      const stripeSubscriptionId = metadata.stripeSubscriptionId;
      
      if (!stripeSubscriptionId) {
        return;
      }

      // Use service role client for webhook operations to bypass RLS
      const serviceClient = this.getServiceRoleClient();



      // Update the subscription using subscription_id (not stripe_subscription_id)
      const { data: updateResult, error: updateError } = await serviceClient
        .from("user_subscriptions")
        .update({
          ai_credits_balance: newTotalCredits,
          updated_at: new Date().toISOString()
        })
        .eq("subscription_id", subscriptionId)
        .select("subscription_id, ai_credits_balance, updated_at");

      if (updateError) {
        return;
      }

      // Dedup: if we've already inserted a transaction for this PaymentIntent, skip
      const accountId = metadata.accountId;
      try {
        if (accountId && creditsToAdd > 0) {
          const { data: existing } = await serviceClient
            .from('account_credit_transactions')
            .select('id')
            .eq('account_id', accountId)
            .eq('type', 'credit_reload')
            .contains('metadata', { payment_intent_id: paymentIntent.id } as any)
            .limit(1);

          if (!existing || existing.length === 0) {
            await serviceClient
              .from("account_credit_transactions")
              .insert({
                account_id: accountId,
                type: "credit_reload",
                credit_amount: creditsToAdd,
                description: "Manual credit reload",
                reload_type: "manual",
                reload_attempt_status: "succeeded",
                reload_attempt_description: null,
                instance_id: null,
                metadata: {
                  payment_intent_id: paymentIntent.id,
                  amount_usd: Number(metadata.amount || 0),
                  credits_added: creditsToAdd,
                  current_credits_before: currentCredits,
                  new_total_credits: newTotalCredits
                } as any
              });
          }
        }
      } catch (_) {
        // do not fail webhook on ledger insert issues
      }

    } catch (error) {
      // Error processing payment
    }
  }
} 