import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { SubscriptionService } from '@/lib/stripe';
import { type StripeMode, getResolvedStripeMode } from "@/lib/stripe/config";

export async function POST(request: Request) {
  try {
    const cookieStore = cookies();
    const supabase = createServerClient(
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
    const { data: { user } } = await supabase.auth.getUser();

    if (!user || !user.id || !user.email) {
      return NextResponse.json(
        { error: "Unauthorized or missing user info" },
        { status: 401 }
      );
    }

    const { planName, mode = getResolvedStripeMode(), accountId } = await request.json() as { 
      planName: "basic" | "pro" | "enterprise" | "partner"; 
      mode?: StripeMode;
      accountId: string;
    };

    if (!accountId) {
      return NextResponse.json(
        { error: "Account ID is required" },
        { status: 400 }
      );
    }

    // Defensive: Ensure accountId exists in accounts table
    const { data: account, error: accountError } = await supabase
      .from('accounts')
      .select('id')
      .eq('id', accountId)
      .single();
    if (accountError || !account) {
      return NextResponse.json(
        { error: 'Invalid accountId: account does not exist' },
        { status: 400 }
      );
    }

    // Verify user has access to this account
    const { data: userAccount, error: accessError } = await supabase
      .from('user_accounts')
      .select('user_status')
      .eq('user_id', user.id)
      .eq('account_id', accountId)
      .single();

    if (accessError || !userAccount) {
      return NextResponse.json(
        { error: "Access denied to this account" },
        { status: 403 }
      );
    }

    // Only owners can manage billing
    if (userAccount.user_status !== 'owner') {
      return NextResponse.json(
        { error: "Only account owners can manage billing" },
        { status: 403 }
      );
    }

    // Ensure account has a subscription
    const subscriptionService = new SubscriptionService(supabase);
    await subscriptionService.ensureAccountSubscription(accountId, mode);

    // Get the origin from the request
    const origin = request.headers.get('origin') || 
                   request.headers.get('referer')?.split('/').slice(0, 3).join('/') ||
                   'http://localhost:3000';

    // Create checkout session
    const checkoutUrl = await subscriptionService.createCheckoutSession(
      accountId,
      planName,
      mode,
      user.email,
      true, // isAccountBased
      user.id, // pass userId explicitly
      origin // pass the dynamic baseUrl
    );

    if (!checkoutUrl) {
      return NextResponse.json(
        { error: "Error creating checkout session" },
        { status: 500 }
      );
    }

    return NextResponse.json({ url: checkoutUrl });
  } catch (error) {
    return NextResponse.json(
      { error: "Error creating checkout session" },
      { status: 500 }
    );
  }
} 