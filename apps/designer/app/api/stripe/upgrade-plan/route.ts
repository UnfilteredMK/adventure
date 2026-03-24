import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { SubscriptionService } from '@/lib/stripe';
import { type StripeMode, getResolvedStripeMode } from "@/lib/stripe/config";

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
      return NextResponse.json(
        { error: "Unauthorized" },
        { status: 401 }
      );
    }

    const { planName, mode = getResolvedStripeMode(), accountId } = await request.json() as { 
      planName: "basic" | "pro" | "enterprise"; 
      mode?: StripeMode;
      accountId?: string;
    };

    if (!accountId) {
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
      return NextResponse.json(
        { error: "Access denied to this account" },
        { status: 403 }
      );
    }
    if (userAccount.user_status !== 'owner') {
      return NextResponse.json(
        { error: "Only account owners can manage billing" },
        { status: 403 }
      );
    }

    const subscriptionService = new SubscriptionService(supabase);

    // Upgrade the plan using existing payment method
    const success = await subscriptionService.upgradePlan(
      user.id,
      planName,
      mode
    );

    if (!success) {
      return NextResponse.json(
        { error: "Failed to upgrade plan. Please check your payment method and try again." },
        { status: 500 }
      );
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json(
      { 
        error: "Error upgrading plan. Please try again or contact support.",
        details: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    );
  }
} 