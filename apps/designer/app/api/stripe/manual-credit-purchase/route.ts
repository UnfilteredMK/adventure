import { NextRequest, NextResponse } from "next/server";
import { ManualCreditPurchaseService } from "@/lib/stripe";
import { getResolvedStripeMode, type StripeMode } from "@/lib/stripe/config";

export async function POST(request: NextRequest) {
  try {
    const { amount, accountId, mode: bodyMode } = await request.json() as {
      amount: number;
      accountId: string;
      mode?: StripeMode;
    };
    const mode = bodyMode ?? getResolvedStripeMode();

    if (!amount || amount < 20) {
      return NextResponse.json(
        { error: "Amount must be at least $20" },
        { status: 400 }
      );
    }

    if (!accountId) {
      return NextResponse.json(
        { error: "Account ID is required" },
        { status: 400 }
      );
    }

    const service = new ManualCreditPurchaseService(mode);

    const { data: { user }, error: userError } = await service.supabase.auth.getUser();

    if (!user) {
      return NextResponse.json(
        { error: "User not authenticated" },
        { status: 401 }
      );
    }

    // Verify the user is a member of the account (any role). Only owners and admins can purchase credits.
    const { data: userAccount, error: userAccountError } = await service.supabase
      .from('user_accounts')
      .select('user_status')
      .eq('user_id', user.id)
      .eq('account_id', accountId)
      .single();

    if (userAccountError || !userAccount) {
      return NextResponse.json(
        { error: "Access denied to this account" },
        { status: 403 }
      );
    }

    if (userAccount.user_status !== 'owner') {
      return NextResponse.json(
        { error: "Only account owners can purchase credits" },
        { status: 403 }
      );
    }

    const { data: subscription, error: subscriptionError } = await service.supabase
      .from("user_subscriptions")
      .select("subscription_id, ai_credits_balance, additional_credit_price")
      .eq("account_id", accountId)
      .in("status", ["active", "trialing"])
      .order("created_at", { ascending: false })
      .limit(1)
      .single();

    if (subscriptionError || !subscription) {
      return NextResponse.json(
        { error: "No active subscription found" },
        { status: 404 }
      );
    }

    const currentCredits = subscription.ai_credits_balance || 0;
    const creditPrice = subscription.additional_credit_price || 0.3; // Default fallback

    const result = await service.createPaymentIntent({
      amount,
      accountId,
      subscriptionId: subscription.subscription_id,
      currentCredits,
      creditPrice
    });

    if (!result.success) {
      return NextResponse.json(
        { error: result.message },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      paymentIntentId: result.paymentIntentId,
      creditsToAdd: result.creditsToAdd,
      message: result.message
    });
  } catch (error) {
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
} 