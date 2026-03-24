// @ts-nocheck
import { supabase } from '@/lib/supabase';
import type { Database } from '@/types/database';
import { getStripeSecretKey, getResolvedStripeMode, StripeMode } from "../config";
import { Plan, UserSubscription } from "@/types";
import Stripe from "stripe";
import { createClient } from '@supabase/supabase-js';

export class SubscriptionService {
  private supabase: typeof supabase;

  constructor(supabaseClient?: typeof supabase) {
    // Always use service role key for backend logic
    this.supabase = supabaseClient || createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );
  }

  /**
   * Check if user has an active subscription and create one if needed
   */
  async ensureUserSubscription(userId: string, mode: StripeMode = getResolvedStripeMode()): Promise<UserSubscription | null> {
    try {
      // First, clean up any duplicate subscriptions
      await this.cleanupDuplicateSubscriptions(userId);
      
      // Get all subscriptions for the user, ordered by creation date (newest first)
      const { data: allSubscriptions, error: subError } = await this.supabase
        .from("user_subscriptions")
        .select("*")
        .eq("user_id", userId)
        .order("created_at", { ascending: false });

      if (subError) {
        return null;
      }

      if (!allSubscriptions || allSubscriptions.length === 0) {
        // No subscriptions exist, redirect to onboarding
        return null;
      }

      // Find the most recent active/trialing subscription
      const activeSubscription = allSubscriptions.find((sub: any) => 
        sub.status === "active" || sub.status === "trialing"
      );

      if (activeSubscription) {
        return activeSubscription as any;
      }

      // If no active subscription, return the most recent one (could be canceled, past_due, etc.)
      return allSubscriptions[0] as any;
    } catch (error) {
      return null;
    }
  }

  /**
   * Check if account has an active subscription and create one if needed
   */
  async ensureAccountSubscription(accountId: string, mode: StripeMode = getResolvedStripeMode()): Promise<UserSubscription | null> {
    try {
      // First, clean up any duplicate subscriptions
      await this.cleanupDuplicateAccountSubscriptions(accountId);
      
      // Get all subscriptions for the account, ordered by creation date (newest first)
      const { data: allSubscriptions, error: subError } = await this.supabase
        .from("user_subscriptions")
        .select("*")
        .eq("account_id", accountId)
        .order("created_at", { ascending: false });

      if (subError) {
        return null;
      }

      if (!allSubscriptions || allSubscriptions.length === 0) {
        // No subscriptions exist, redirect to onboarding
        return null;
      }

      // Find the most recent active/trialing subscription
      const activeSubscription = allSubscriptions.find((sub: any) => 
        sub.status === "active" || sub.status === "trialing"
      );

      if (activeSubscription) {
        return activeSubscription;
      }

      // If no active subscription, return the most recent one (could be canceled, past_due, etc.)
      return allSubscriptions[0];
    } catch (error) {
      return null;
    }
  }

  /**
   * Create a trial subscription for a specific plan
   */
  async createTrialSubscriptionForPlan(
    userId: string, 
    planId: string, 
    mode: StripeMode = getResolvedStripeMode(), 
    userEmail?: string, 
    existingStripeCustomerId?: string
  ): Promise<UserSubscription | null> {
    try {
      // Get the plan details
      const { data: plan } = await this.supabase
        .from("plans")
        .select("*")
        .eq("plan_id", planId)
        .maybeSingle();

      if (!plan) {
        return null;
      }

      // Use the existing Stripe customer ID if provided (from webhook)
      const stripeCustomerId = existingStripeCustomerId;

      // Calculate trial end date (14 days from now)
      const trialEndDate = new Date();
      trialEndDate.setDate(trialEndDate.getDate() + 14);

      // Use service role for subscription creation (bypass RLS)
      const serviceSupabase = createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.SUPABASE_SERVICE_ROLE_KEY!
      );

      // Use UPSERT to handle unique constraint properly
      const { data: subscription, error } = await serviceSupabase
        .from("user_subscriptions")
        .upsert({
          user_id: userId,
          plan_id: plan.plan_id,
          monthly_price_cents: plan.monthly_price_cents,
          ai_credits_balance: plan.ai_credits_included, // Give trial users full credits
          status: "trialing", // New status for trial period
          start_date: new Date().toISOString(),
          end_date: trialEndDate.toISOString(),
          stripe_customer_id: stripeCustomerId, // Store Stripe customer ID for future billing
          stripe_subscription_id: null, // No Stripe subscription yet (just trial)
          auto_purchase_enabled: true, // Default to enabled
          auto_purchase_amount: 40, // Default to $40 (stored in dollars)
          additional_credit_price: plan.additional_credit_price, // Copy from plan
          updated_at: new Date().toISOString(),
        }, {
          onConflict: 'user_id', // Use the unique constraint on user_id
          ignoreDuplicates: false // Update if exists
        })
        .select()
        .single();

      if (error) {
        return null;
      }



      return subscription;
    } catch (error) {
      return null;
    }
  }

  /**
   * Reactivate a cancelled subscription by creating a new subscription
   */
  async reactivateCancelledSubscription(
    userId: string,
    mode: StripeMode = getResolvedStripeMode()
  ): Promise<string | null> {
    try {
      // Check if user has had a trial before
      const { data: previousSubscriptions, error: historyError } = await this.supabase
        .from("user_subscriptions")
        .select("*")
        .eq("user_id", userId)
        .in("status", ["trialing", "active", "canceled", "past_due", "unpaid"])
        .order("created_at", { ascending: false });

      if (historyError) {
        return null;
      }

      // Check if user has had any subscription before (including cancelled ones)
      const hasHadAnySubscription = previousSubscriptions && previousSubscriptions.length > 0;

      // Get the most recent cancelled subscription to get plan details
      const cancelledSubscription = previousSubscriptions?.find((sub: any) => sub.status === "canceled");

      if (!cancelledSubscription) {
        return null;
      }

      // Get the plan details
      if (!cancelledSubscription.plan_id) {
        return null;
      }

      const { data: plan } = await this.supabase
        .from("plans")
        .select("*")
        .eq("plan_id", cancelledSubscription.plan_id)
        .maybeSingle();

      if (!plan) {
        return null;
      }

      // Get Stripe configuration
      const stripeKey = getStripeSecretKey(mode);
      if (!stripeKey) {
        throw new Error("Stripe secret key not configured");
      }

      const stripe = new Stripe(stripeKey, {
        apiVersion: "2023-10-16",
      });

      // Get user email
      const { data: { user } } = await this.supabase.auth.getUser();
      if (!user?.email) {
        return null;
      }

      // Get or create Stripe customer
      const customer = await this.getOrCreateStripeCustomer(userId, mode);

      let newStripeSubscription;
      try {
        // First, create or get the product
        let product;
        const productName = `${plan.name} Plan`;

        // Try to find existing product
        const existingProducts = await stripe.products.list({
          limit: 100,
          active: true
        });

        product = existingProducts.data.find(p => p.name === productName);

        if (!product) {
          // Create new product
          product = await stripe.products.create({
            name: productName,
            description: `${plan.ai_credits_included} credits/month`,
          });
        }

        // Create price for the product
        const price = await stripe.prices.create({
          product: product.id,
          unit_amount: plan.monthly_price_cents,
          currency: "usd",
          recurring: {
            interval: "month"
          }
        });

        // Prepare subscription creation options
        const subscriptionOptions: any = {
          customer: customer.id,
          items: [
            {
              price: price.id,
              quantity: 1,
            },
          ],
          metadata: {
            userId,
            planId: plan.plan_id,
            planName: plan.name.toLowerCase(),
            mode,
          },
        };

        // Only add trial if user hasn't had any subscription before
        if (!hasHadAnySubscription) {
          subscriptionOptions.trial_period_days = 14;
        } else {}

        newStripeSubscription = await stripe.subscriptions.create(subscriptionOptions);
      } catch (stripeError: any) {
        if (stripeError.code === 'card_declined') {
          throw new Error("Payment method was declined. Please update your payment method.");
        } else {
          throw new Error(`Stripe error: ${stripeError.message}`);
        }
      }

      // Create a new subscription record in our database (don't update the old one)
      const { data: newSubscription, error: insertError } = await this.supabase
        .from("user_subscriptions")
        .insert({
          user_id: userId,
          plan_id: plan.plan_id,
          monthly_price_cents: plan.monthly_price_cents,
          ai_credits_balance: plan.ai_credits_included,
          status: newStripeSubscription.status,
          start_date: new Date().toISOString(),
          end_date: new Date(newStripeSubscription.current_period_end * 1000).toISOString(),
          stripe_customer_id: customer.id,
          stripe_subscription_id: newStripeSubscription.id,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .select()
        .single();

      if (insertError) {
        return null;
      }

      return newStripeSubscription.id;
    } catch (error) {
      return null;
    }
  }

  /**
   * Create a Stripe checkout session for plan upgrade (with trial)
   */
  async createCheckoutSession(
    accountId: string,
    planName: "basic" | "pro" | "enterprise" | "partner",
    mode: StripeMode = getResolvedStripeMode(),
    userEmail?: string,
    isAccountBased: boolean = false,
    userId?: string,
    baseUrl?: string
  ): Promise<string | null> {
    try {
      // Get the plan details
      const capitalizedPlanName = planName.charAt(0).toUpperCase() + planName.slice(1).toLowerCase();

      const { data: plan, error: planError } = await this.supabase
        .from("plans")
        .select("*")
        .eq("name", capitalizedPlanName)
        .maybeSingle();

      if (!plan) {
        return null;
      }

      if (!userEmail || !userId || !accountId) {
        throw new Error("User email, userId, or accountId not found");
      }

      // Validate Stripe configuration
      const stripeKey = getStripeSecretKey(mode);

      if (!stripeKey) {
        throw new Error(`Stripe secret key not configured`);
      }

      // Create checkout session with trial
      const stripe = new Stripe(stripeKey, {
        apiVersion: "2023-10-16",
      });

      const customer = await this.getOrCreateStripeCustomer(userId, mode);
      const customerId = customer.id;

      // Use dynamic baseUrl or fallback to environment variable
      const origin = baseUrl || process.env.STRIPE_SUCCESS_URL || 'http://localhost:3000';
      
      const isPartnerPlan = capitalizedPlanName === 'Partner';
      
      // For all plans, redirect to accounts page after success
      // Partner plans get a special flag
      const successUrl = `${origin}/accounts?payment=success${isPartnerPlan ? '&partner=true' : ''}`;
      const cancelUrl = `${origin}/accounts?payment=cancelled`;

      const sessionConfig: any = {
        line_items: [
          {
            price_data: {
              currency: "usd",
              product_data: {
                name: `${capitalizedPlanName} Plan`,
                description: `${plan.ai_credits_included} credits/month`,
              },
              unit_amount: plan.monthly_price_cents,
              recurring: {
                interval: "month"
              }
            },
            quantity: 1,
          },
        ],
        mode: "subscription",
        subscription_data: {
          trial_period_days: 14, // 14-day free trial
          metadata: {
            accountId,
            userId,
          },
        },
        success_url: successUrl,
        cancel_url: cancelUrl,
        metadata: {
          accountId,
          userId,
          planId: plan.plan_id,
          planName,
          mode,
          isAccountBased,
        },
      };

      // Always include customer since we ensure one exists
      sessionConfig.customer = customerId;

      const session = await stripe.checkout.sessions.create(sessionConfig);

      return session.url;
    } catch (error) {
      throw error;
    }
  }

  /**
   * Create a checkout session for subscription without trial (for renewals)
   */
  async createCheckoutSessionNoTrial(
    accountId: string,
    planName: "basic" | "pro" | "enterprise" | "partner",
    mode: StripeMode = getResolvedStripeMode(),
    userEmail?: string,
    userId?: string,
    baseUrl?: string
  ): Promise<string | null> {
    try {
      // Get the plan details
      const capitalizedPlanName = planName.charAt(0).toUpperCase() + planName.slice(1).toLowerCase();

      const { data: plan, error: planError } = await this.supabase
        .from("plans")
        .select("*")
        .eq("name", capitalizedPlanName)
        .maybeSingle();

      if (!plan) {
        return null;
      }

      if (!userEmail || !userId || !accountId) {
        throw new Error("User email, userId, or accountId not found");
      }

      // Validate Stripe configuration
      const stripeKey = getStripeSecretKey(mode);

      if (!stripeKey) {
        throw new Error(`Stripe secret key not configured`);
      }

      // Create checkout session without trial
      const stripe = new Stripe(stripeKey, {
        apiVersion: "2023-10-16",
      });

      const customer = await this.getOrCreateStripeCustomer(userId, mode);
      const customerId = customer.id;

      // Use dynamic baseUrl or fallback to environment variable
      const origin = baseUrl || process.env.STRIPE_SUCCESS_URL || 'http://localhost:3000';
      
      const isPartnerPlan = capitalizedPlanName === 'Partner';
      
      // For all plans, redirect to accounts page after success
      // Partner plans get a special flag
      const successUrl = `${origin}/accounts?payment=success${isPartnerPlan ? '&partner=true' : ''}`;
      const cancelUrl = `${origin}/accounts?payment=cancelled`;

      const sessionConfig: any = {
        line_items: [
          {
            price_data: {
              currency: "usd",
              product_data: {
                name: `${capitalizedPlanName} Plan`,
                description: `${plan.ai_credits_included} credits/month`,
              },
              unit_amount: plan.monthly_price_cents,
              recurring: {
                interval: "month"
              }
            },
            quantity: 1,
          },
        ],
        mode: "subscription",
        subscription_data: {
          metadata: {
            accountId,
            userId,
          },
        },
        success_url: successUrl,
        cancel_url: cancelUrl,
        metadata: {
          accountId,
          userId,
          planId: plan.plan_id,
          planName,
          mode,
          noTrial: "true", // Flag to indicate no trial
        },
      };

      // Always include customer since we ensure one exists
      sessionConfig.customer = customerId;

      const session = await stripe.checkout.sessions.create(sessionConfig);

      return session.url;
    } catch (error) {
      throw error;
    }
  }



  /**
   * Get or create a Stripe customer for the user
   */
  private async getOrCreateStripeCustomer(userId: string, mode: StripeMode): Promise<Stripe.Customer> {
    try {
      // Get user details first
      const { data: { user } } = await this.supabase.auth.getUser();
      if (!user || !user.email) {
        throw new Error("User or user email not found");
      }

      const stripe = new Stripe(getStripeSecretKey(mode), {
        apiVersion: "2023-10-16",
      });

      // First, check if user already has a Stripe customer ID in our database
      const { data: subscription } = await this.supabase
        .from("user_subscriptions")
        .select("stripe_customer_id")
        .eq("user_id", userId)
        .not("stripe_customer_id", "is", null)
        .maybeSingle();

      if (subscription?.stripe_customer_id) {
        // Try to retrieve the existing customer from Stripe
        try {
          const existingCustomer = await stripe.customers.retrieve(subscription.stripe_customer_id) as Stripe.Customer;
          return existingCustomer;
        } catch (stripeError: any) {
          // If customer doesn't exist in Stripe, clear the ID from our database
          if (stripeError.code === 'resource_missing') {
            await this.supabase
              .from("user_subscriptions")
              .update({ stripe_customer_id: null })
              .eq("user_id", userId);
          } else {
            // Re-throw other Stripe errors
            throw stripeError;
          }
        }
      }

      const existingCustomers = await stripe.customers.list({
        email: user.email,
        limit: 1
      });

      if (existingCustomers.data.length > 0) {
        const existingCustomer = existingCustomers.data[0];

        // Update the customer metadata to include our userId if not present
        if (!existingCustomer.metadata?.userId) {
          await stripe.customers.update(existingCustomer.id, {
            metadata: { userId }
          });
        }

        // Update our database with the found customer ID
        await this.supabase
          .from("user_subscriptions")
          .update({ stripe_customer_id: existingCustomer.id })
          .eq("user_id", userId);

        return existingCustomer;
      }

      const customer = await stripe.customers.create({
        email: user.email,
        metadata: {
          userId,
        },
      });

      // Update our database with the new customer ID
      await this.supabase
        .from("user_subscriptions")
        .update({ stripe_customer_id: customer.id })
        .eq("user_id", userId);

      return customer;
    } catch (error) {
      throw error;
    }
  }

  /**
   * Upgrade user's plan using existing payment method
   */
  async upgradePlan(
    userId: string,
    planName: "basic" | "pro" | "enterprise",
    mode: StripeMode = getResolvedStripeMode()
  ): Promise<boolean> {
    try {
      // Get the most recent active/trialing subscription
      const { data: subscriptions, error: subscriptionError } = await this.supabase
        .from("user_subscriptions")
        .select("*")
        .eq("user_id", userId)
        .in("status", ["active", "trialing"])
        .order("created_at", { ascending: false })
        .limit(1);

      const currentSubscription = subscriptions?.[0];

      if (subscriptionError) {
        return false;
      }

      if (!currentSubscription) {
        return false;
      }

      if (!currentSubscription.stripe_subscription_id) {
        return false;
      }

      // Get the new plan details
      const capitalizedPlanName = planName.charAt(0).toUpperCase() + planName.slice(1);
      const { data: plan, error: planError } = await this.supabase
        .from("plans")
        .select("*")
        .eq("name", capitalizedPlanName)
        .single();

      if (planError) {
        return false;
      }

      if (!plan) {
        return false;
      }

      // Get Stripe configuration
      const stripeKey = getStripeSecretKey(mode);
      if (!stripeKey) {
        return false;
      }

      const stripe = new Stripe(stripeKey, {
        apiVersion: "2023-10-16",
      });

      let stripeSubscription: Stripe.Subscription;
      try {
        stripeSubscription = await stripe.subscriptions.retrieve(
          currentSubscription.stripe_subscription_id
        );

        if (!stripeSubscription) {
          return false;
        }
      } catch (stripeError) {
        return false;
      }

      // Create a new price for the plan if it doesn't exist
      let priceId = plan.stripe_price_id;
      if (!priceId) {
        const price = await stripe.prices.create({
          unit_amount: plan.monthly_price_cents,
          currency: 'usd',
          recurring: { interval: 'month' },
          product_data: {
            name: `${plan.name} Plan`,
          },
        });
        priceId = price.id;

        // Update the plan with the new price ID
        await this.supabase
          .from("plans")
          .update({ stripe_price_id: priceId })
          .eq("plan_id", plan.plan_id);
      }

      // Update the subscription with the new price
      const updatedSubscription = await stripe.subscriptions.update(
        currentSubscription.stripe_subscription_id,
        {
          items: [{
            id: stripeSubscription.items.data[0].id,
            price: priceId,
          }],
          metadata: {
            userId,
            planId: plan.plan_id,
            planName: plan.name,
            mode,
          },
        }
      );

      if (updatedSubscription.status === 'active' || updatedSubscription.status === 'trialing') {
        // Update the specific database subscription record
        await this.supabase
          .from("user_subscriptions")
          .update({
            plan_id: plan.plan_id,
            monthly_price_cents: plan.monthly_price_cents,
            additional_credit_price: plan.additional_credit_price, // Update with new plan's price
            updated_at: new Date().toISOString(),
          })
          .eq("subscription_id", currentSubscription.subscription_id);

        return true;
      } else {
        return false;
      }
    } catch (error) {
      return false;
    }
  }

  /**
   * Clean up duplicate subscriptions for a user
   * Ensures only one active/trialing subscription per user by canceling duplicates
   */
  async cleanupDuplicateSubscriptions(userId: string): Promise<void> {
    try {
      // Get all subscriptions for the user
      const { data: subscriptions } = await this.supabase
        .from("user_subscriptions")
        .select("*")
        .eq("user_id", userId)
        .order("created_at", { ascending: false });

      if (!subscriptions || subscriptions.length <= 1) {
        return;
      }

      // Find active/trialing subscriptions
      const activeSubscriptions = subscriptions.filter((sub: any) => 
        sub.status === "active" || sub.status === "trialing"
      );

      if (activeSubscriptions.length > 1) {
        // Keep the most recent active subscription, cancel the others
        const [keepSubscription, ...cancelSubscriptions] = activeSubscriptions;

        // Cancel duplicate active subscriptions (don't delete, keep history)
        for (const sub of cancelSubscriptions) {
          const { error: updateError } = await this.supabase
            .from("user_subscriptions")
            .update({ 
              status: "canceled",
              updated_at: new Date().toISOString()
            })
            .eq("subscription_id", sub.subscription_id);

          if (updateError) {} else {}
        }
      } else {}
    } catch (error) {}
  }

  /**
   * Ensures only one active/trialing subscription per account by canceling duplicates
   */
  async cleanupDuplicateAccountSubscriptions(accountId: string): Promise<void> {
    try {
      // Get all subscriptions for the account
      const { data: subscriptions } = await this.supabase
        .from("user_subscriptions")
        .select("*")
        .eq("account_id", accountId)
        .order("created_at", { ascending: false });

      if (!subscriptions || subscriptions.length <= 1) {
        return;
      }

      // Find active/trialing subscriptions
      const activeSubscriptions = subscriptions.filter((sub: any) => 
        sub.status === "active" || sub.status === "trialing"
      );

      if (activeSubscriptions.length > 1) {
        // Keep the most recent active subscription, cancel the others
        const [keepSubscription, ...cancelSubscriptions] = activeSubscriptions;

        // Cancel duplicate active subscriptions (don't delete, keep history)
        for (const sub of cancelSubscriptions) {
          const { error: updateError } = await this.supabase
            .from("user_subscriptions")
            .update({ 
              status: "canceled",
              updated_at: new Date().toISOString()
            })
            .eq("subscription_id", sub.subscription_id);

          if (updateError) {} else {}
        }
      } else {}
    } catch (error) {}
  }

  /**
   * Check if user needs onboarding (no subscription exists)
   */
  async needsOnboarding(userId: string): Promise<boolean> {
    try {
      const { data: subscription } = await this.supabase
        .from("user_subscriptions")
        .select("subscription_id")
        .eq("user_id", userId)
        .maybeSingle();
      return !subscription;
    } catch (error) {
      // If no subscription found, user needs onboarding
      return true;
    }
  }

  /**
   * Get the current subscription status for a user
   */
  async getSubscriptionStatus(userId: string): Promise<string | null> {
    try {
      const { data: subscriptions, error } = await this.supabase
        .from("user_subscriptions")
        .select("*")
        .eq("user_id", userId)
        .order("created_at", { ascending: false });

      if (error) {
        return null;
      }

      if (!subscriptions || subscriptions.length === 0) {
        return null;
      }

      const mostRecent = subscriptions[0];

      return mostRecent.status;
    } catch (error) {
      return null;
    }
  }
} 