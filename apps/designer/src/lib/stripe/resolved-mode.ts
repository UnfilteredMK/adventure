export type StripeMode = "test" | "live";

/**
 * Default is live (real Stripe). Set NEXT_PUBLIC_STRIPE_MODE=test for test keys / dashboard.
 */
export function getResolvedStripeMode(): StripeMode {
  const env = process.env.NEXT_PUBLIC_STRIPE_MODE?.toLowerCase()?.trim();
  if (env === "test" || env === "live") return env;
  return "live";
}
