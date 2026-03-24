import { getResolvedStripeMode, type StripeMode } from "./resolved-mode";

export type { StripeMode } from "./resolved-mode";

export function getStripeSecretKey(mode: StripeMode = getResolvedStripeMode()): string {
  // First try the new format with separate test/live keys
  const testKey = process.env.STRIPE_TEST_SECRET_KEY;
  const liveKey = process.env.STRIPE_SECRET_KEY;
  
  // If we have separate keys, use the appropriate one
  if (testKey && liveKey) {
    const key = mode === "test" ? testKey : liveKey;
    if (!key) {
      throw new Error(`Stripe ${mode} secret key not configured. Please set STRIPE_${mode === "test" ? "TEST_" : ""}SECRET_KEY in your environment variables.`);
    }
    return key;
  }
  
  // Fallback to the old format (single key for both modes)
  const key = process.env.STRIPE_SECRET_KEY;
  
  if (!key) {
    throw new Error(`Stripe secret key not configured. Please set STRIPE_SECRET_KEY in your environment variables.`);
  }
  
  return key;
}

export function getStripeWebhookSecret(mode: StripeMode = getResolvedStripeMode()): string {
  // First try the new format with separate test/live webhook secrets
  const testSecret = process.env.STRIPE_TEST_WEBHOOK_SECRET;
  const liveSecret = process.env.STRIPE_WEBHOOK_SECRET;
  
  // If we have separate secrets, use the appropriate one
  if (testSecret && liveSecret) {
    const secret = mode === "test" ? testSecret : liveSecret;
    if (!secret) {
      throw new Error(`Stripe ${mode} webhook secret not configured. Please set STRIPE_${mode === "test" ? "TEST_" : ""}WEBHOOK_SECRET in your environment variables.`);
    }
    return secret;
  }
  
  // Fallback to the old format (single webhook secret for both modes)
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  
  if (!secret) {
    throw new Error(`Stripe webhook secret not configured. Please set STRIPE_WEBHOOK_SECRET in your environment variables.`);
  }
  
  return secret;
}

export function getStripePriceId(creditAmount: number, mode: StripeMode = getResolvedStripeMode()): string {
  const priceId = mode === "test" 
    ? process.env[`STRIPE_PRICE_ID_${creditAmount}_CREDITS_TEST`]
    : process.env[`STRIPE_PRICE_ID_${creditAmount}_CREDITS_LIVE`];
  
  if (!priceId) {
    throw new Error(`Stripe price ID for ${creditAmount} credits not configured for ${mode} mode`);
  }
  
  return priceId;
}

export { getResolvedStripeMode } from "./resolved-mode";
