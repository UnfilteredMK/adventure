import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { type StripeMode, getResolvedStripeMode, getStripeSecretKey } from "@/lib/stripe/config";
import Stripe from "stripe";

const LOG = "[stripe:create-customer-portal]";

function logError(context: string, extra: Record<string, unknown> = {}) {
  console.error(`${LOG} ${context}`, extra);
}

function serializeError(error: unknown) {
  if (error instanceof Stripe.errors.StripeError) {
    return {
      name: error.name,
      message: error.message,
      type: error.type,
      code: error.code,
      statusCode: error.statusCode,
      requestId: error.requestId,
    };
  }
  if (error instanceof Error) {
    return { name: error.name, message: error.message, stack: error.stack };
  }
  return { raw: String(error) };
}

/** Stripe requires an absolute return_url; mirrors create-checkout-session fallbacks. */
function resolvePublicAppOrigin(request: Request): { origin: string; source: string } {
  const fromEnv = process.env.NEXT_PUBLIC_APP_URL?.trim().replace(/\/$/, "");
  if (fromEnv && /^https?:\/\//i.test(fromEnv)) {
    return { origin: fromEnv, source: "NEXT_PUBLIC_APP_URL" };
  }

  const headerOrigin = request.headers.get("origin")?.trim().replace(/\/$/, "");
  if (headerOrigin && /^https?:\/\//i.test(headerOrigin)) {
    return { origin: headerOrigin, source: "request_origin" };
  }

  const referer = request.headers.get("referer");
  if (referer) {
    try {
      const u = new URL(referer);
      return {
        origin: `${u.protocol}//${u.host}`,
        source: "referer",
      };
    } catch {
      /* ignore */
    }
  }

  const vercel = process.env.VERCEL_URL?.trim();
  if (vercel) {
    const host = vercel.replace(/^https?:\/\//i, "").replace(/\/$/, "");
    return { origin: `https://${host}`, source: "VERCEL_URL" };
  }

  return { origin: "http://localhost:3000", source: "localhost_default" };
}

export async function POST(request: Request) {
  try {
    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookies: {
          get(name: string) {
            return cookies().get(name)?.value;
          },
        },
      }
    );
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      logError("unauthorized", { reason: "no_session" });
      return NextResponse.json(
        { error: "Unauthorized" },
        { status: 401 }
      );
    }

    const { mode = getResolvedStripeMode(), accountId } = await request.json() as { 
      mode?: StripeMode;
      accountId?: string;
    };

    if (!accountId) {
      logError("bad_request", { userId: user.id, reason: "missing_accountId" });
      return NextResponse.json(
        { error: "Account ID is required" },
        { status: 400 }
      );
    }

    // Verify the user is the owner for this account
    const { data: userAccount, error: userAccountError } = await supabase
      .from('user_accounts')
      .select('user_status')
      .eq('user_id', user.id)
      .eq('account_id', accountId)
      .single();

    if (userAccountError || !userAccount) {
      logError("forbidden", {
        accountId,
        userId: user.id,
        reason: "not_linked_to_account",
        supabase: userAccountError?.message,
        code: userAccountError?.code,
      });
      return NextResponse.json(
        { error: "Access denied to this account" },
        { status: 403 }
      );
    }
    if (userAccount.user_status !== 'owner') {
      logError("forbidden", {
        accountId,
        userId: user.id,
        reason: "not_owner",
        userStatus: userAccount.user_status,
      });
      return NextResponse.json(
        { error: "Only account owners can manage billing" },
        { status: 403 }
      );
    }

    // Get the account's subscription to find Stripe customer ID
    const { data: subscription, error: subscriptionError } = await supabase
      .from("user_subscriptions")
      .select("stripe_customer_id, stripe_subscription_id, status")
      .eq("account_id", accountId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (subscriptionError) {
      logError("subscription_query_failed", {
        accountId,
        userId: user.id,
        message: subscriptionError.message,
        code: subscriptionError.code,
        details: subscriptionError.details,
      });
      return NextResponse.json(
        { error: "Error fetching subscription data" },
        { status: 500 }
      );
    }

    // Validate Stripe configuration
    const stripeKey = getStripeSecretKey(mode);
    if (!stripeKey) {
      logError("stripe_not_configured", { accountId, mode });
      return NextResponse.json(
        { error: "Stripe not configured" },
        { status: 500 }
      );
    }

    // Create Stripe instance
    const stripe = new Stripe(stripeKey, {
      apiVersion: "2023-10-16",
    });

    let customerId = subscription?.stripe_customer_id;

    // If we have a customer ID, verify it exists in Stripe
    if (customerId) {
      try {
        await stripe.customers.retrieve(customerId);
      } catch (error: unknown) {
        const code = (error as { code?: string })?.code;
        if (code === 'resource_missing') {
          logError("stale_stripe_customer_id_cleared", {
            accountId,
            customerId,
          });
          // Clear the invalid customer ID from our database
          await supabase
            .from("user_subscriptions")
            .update({ stripe_customer_id: null })
            .eq("account_id", accountId)
            .in('status', ['active', 'trialing']);
          customerId = null;
        } else {
          logError("customer_retrieve_failed", {
            accountId,
            customerId,
            ...serializeError(error),
          });
          throw error;
        }
      }
    }

    // If no customer ID but we have a subscription ID, try to get customer from subscription
    if (!customerId && subscription?.stripe_subscription_id) {
      try {
        const stripeSubscription = await stripe.subscriptions.retrieve(subscription.stripe_subscription_id);
        customerId = stripeSubscription.customer as string;

        // Update our database with the found customer ID
        await supabase
          .from("user_subscriptions")
          .update({ stripe_customer_id: customerId })
          .eq("account_id", accountId)
          .in('status', ['active', 'trialing']);
      } catch (error) {
        logError("subscription_lookup_fallback_failed", {
          accountId,
          subscriptionId: subscription?.stripe_subscription_id,
          ...serializeError(error),
        });
      }
    }

    // If still no customer ID, try to find customer by user email
    if (!customerId) {
      try {
        const { data: { user: authUser } } = await supabase.auth.getUser();
        if (authUser?.email) {
        const customers = await stripe.customers.list({
          email: authUser.email,
          limit: 1
        });
        
        if (customers.data.length > 0) {
          customerId = customers.data[0].id;

          // Update our database with the found customer ID
          await supabase
            .from("user_subscriptions")
            .update({ stripe_customer_id: customerId })
            .eq("account_id", accountId)
            .in('status', ['active', 'trialing']);
        }
      }
      } catch (error) {
        logError("email_customer_lookup_failed", {
          accountId,
          ...serializeError(error),
        });
      }
    }

    if (!customerId) {
      logError("no_stripe_customer", {
        accountId,
        userId: user.id,
        hadSubscriptionRow: Boolean(subscription),
      });
      return NextResponse.json(
        { error: "No billing information found. Please complete your subscription setup first." },
        { status: 404 }
      );
    }

    const { origin: returnUrlBase, source: originSource } =
      resolvePublicAppOrigin(request);
    if (!process.env.NEXT_PUBLIC_APP_URL?.trim()) {
      console.warn(`${LOG} return_url_base_fallback`, {
        accountId,
        originSource,
        returnUrlBase,
      });
    }

    const session = await stripe.billingPortal.sessions.create({
      customer: customerId,
      return_url: `${returnUrlBase}/get-credits`,
    });

    return NextResponse.json({ url: session.url });
  } catch (error) {
    logError("unhandled", serializeError(error));
    return NextResponse.json(
      { error: "Error creating customer portal session. Please try again or contact support." },
      { status: 500 }
    );
  }
} 