/**
 * ===========================================================================
 * ONLINE DEPOSIT PAYMENTS — DISABLED STUB
 * ===========================================================================
 *
 * The booking flow today is: save the request → open WhatsApp → the owner
 * collects the deposit off-platform. No money moves through this site.
 *
 * This module is the seam where a gateway plugs in later. It exists now so the
 * booking flow already has the right *shape*: `BookingRequest` carries
 * `depositDue`, `paymentStatus` and `paymentReference` columns, and the confirm
 * page checks `isDepositPaymentEnabled()` before deciding whether to show a
 * "pay deposit" step. Nothing anywhere calls a payment API.
 *
 * ---------------------------------------------------------------------------
 * TO ENABLE (example: Stripe)
 * ---------------------------------------------------------------------------
 *  1. npm install stripe
 *  2. .env: STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET,
 *           NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY
 *  3. Replace `createDepositCheckout` below with a real implementation:
 *
 *       const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);
 *       const session = await stripe.checkout.sessions.create({
 *         mode: "payment",
 *         currency: "aed",
 *         line_items: [{
 *           quantity: 1,
 *           price_data: {
 *             currency: "aed",
 *             unit_amount: input.amount * 100,          // fils
 *             product_data: { name: `عربون — ${input.listingName}` },
 *           },
 *         }],
 *         metadata: { bookingId: input.bookingId, reference: input.reference },
 *         success_url: `${siteUrl()}/booking/${input.reference}?paid=1`,
 *         cancel_url:  `${siteUrl()}/booking/${input.reference}`,
 *       });
 *       return { ok: true, checkoutUrl: session.url! };
 *
 *  4. Add a webhook route at src/app/api/payments/webhook/route.ts that
 *     verifies the signature and, on `checkout.session.completed`, sets
 *     `paymentStatus = "PAID"` and `paymentReference = session.id` on the
 *     booking, then flips its `status` to "CONFIRMED" and writes the stay's
 *     nights into `Availability` with status "BOOKED".
 *
 *  5. Flip `depositPaymentsEnabled` to true in /admin/settings.
 *
 *  A local UAE gateway (Network International, Telr, PayTabs, Ziina) drops into
 *  exactly the same two functions — only the SDK call differs.
 * ---------------------------------------------------------------------------
 */

import type { Settings } from "../settings";

export type DepositCheckoutInput = {
  bookingId: string;
  reference: string;
  listingName: string;
  /** Deposit amount in whole dirhams. */
  amount: number;
  customerName: string;
  customerPhone: string;
};

export type DepositCheckoutResult =
  | { ok: true; checkoutUrl: string }
  | { ok: false; reason: string };

/**
 * Whether the UI should offer an online deposit step.
 *
 * Requires BOTH the owner's opt-in in settings AND provider credentials in the
 * environment — so turning the toggle on without configuring a gateway can't
 * strand a guest on a dead checkout button.
 */
export function isDepositPaymentEnabled(settings: Settings): boolean {
  if (!settings.depositPaymentsEnabled) return false;
  return Boolean(process.env.STRIPE_SECRET_KEY);
}

/** Human-readable reason the payment step is hidden — surfaced in admin settings. */
export function depositPaymentStatus(settings: Settings): string {
  if (!settings.depositPaymentsEnabled) {
    return "الدفع الإلكتروني غير مُفعّل — العربون يُحصّل مباشرة من المالك.";
  }
  if (!process.env.STRIPE_SECRET_KEY) {
    return "الخيار مُفعّل لكن مفاتيح بوابة الدفع غير مُهيّأة في الخادم (STRIPE_SECRET_KEY).";
  }
  return "الدفع الإلكتروني مُفعّل.";
}

/**
 * Deliberately unimplemented. Never called while
 * `isDepositPaymentEnabled()` returns false, which it always does today.
 */
export async function createDepositCheckout(
  _input: DepositCheckoutInput,
): Promise<DepositCheckoutResult> {
  return {
    ok: false,
    reason:
      "لم يتم تفعيل بوابة الدفع بعد. راجع src/lib/payments/index.ts لإضافة مزوّد الدفع.",
  };
}
