import type { Settings } from "../settings";
import { availableProviders, onlinePaymentsEnabled } from "./config";

/**
 * ===========================================================================
 * PAYMENTS — the entry point
 * ===========================================================================
 *
 * This module used to be a single disabled stub whose only job was to say "no
 * gateway is wired". It is now a directory, and the stub's two exported
 * functions are kept at the bottom of this file with their behaviour intact, so
 * the two pages that already import them did not have to change.
 *
 * ─── What is where ──────────────────────────────────────────────────────────
 *   types.ts       the `PaymentProvider` contract every gateway implements
 *   status.ts      provider vocabularies → the internal lifecycle, and the
 *                  booking-level roll-up. Pure functions, no database
 *   config.ts      environment credentials + the three gates. SERVER ONLY
 *   methods.ts     which payment modes a platform and a listing offer
 *   service.ts     the only module that writes the payment tables: amounts,
 *                  idempotency, settlement, refunds
 *   links.ts       the "semi-self" payment link — token, expiry, single use
 *   providers/     one file per gateway. Telr, Tabby, Tamara
 *
 * ─── The state of play, stated plainly ──────────────────────────────────────
 * No merchant credentials exist for this platform, for any provider. Every
 * adapter under providers/ is written to its gateway's documented contract and
 * NONE of them has been executed against a real account — not in sandbox and
 * not in production. The architecture is complete; the integrations are not
 * proven, and this comment is the honest version of that distinction.
 *
 * Because `availableProviders()` returns [] without credentials, the whole
 * subsystem is inert on every deployment today: the booking flow behaves
 * exactly as it always has — save the request, open WhatsApp, the owner
 * collects the deposit — and no code path can reach a gateway. Switching one on
 * later is a credential deployment plus two toggles in /admin/settings, with no
 * code change.
 *
 * ─── To connect Telr, when the merchant account exists ──────────────────────
 *  1. .env:  TELR_STORE_ID, TELR_AUTH_KEY, TELR_TEST_MODE="true"
 *  2. /admin/settings → enable online payments, then enable Telr
 *  3. give Telr the two URLs this platform serves:
 *       return  https://<site>/api/payments/telr/return
 *       advice  https://<site>/api/payments/telr/webhook
 *  4. run one sandbox booking end to end and check the `Payment`,
 *     `PaymentEvent` and `AuditLog` rows it produces
 *  5. only then TELR_TEST_MODE="false"
 *
 * Tabby and Tamara follow the same shape and are additionally blocked on
 * commercial approval — see the header of each adapter.
 * ---------------------------------------------------------------------------
 */

export * from "./types";
export * from "./status";
export * from "./config";
export * from "./methods";
export * from "./links";
export {
  applyCallback,
  assertChargeable,
  recordManualPayment,
  refreshBookingPaymentRollup,
  refundPayment,
  resolvePayable,
  settlePayment,
  startPayment,
  type CallbackOutcome,
  type PaymentFailure,
  type StartPaymentResult,
} from "./service";
export { getProvider } from "./providers";

/* --------------------------------------------------------------------------
 * The two functions the original stub exported.
 *
 * Kept at these names and with these signatures because
 * src/app/(site)/booking/[reference]/page.tsx and
 * src/app/admin/settings/page.tsx call them, and neither of those pages has any
 * business knowing that a provider layer appeared underneath.
 *
 * What changed is only what they consult: `process.env.STRIPE_SECRET_KEY` — a
 * gateway this platform never had — has become "is at least one configured
 * provider enabled". Left as it was, the admin toggle could never turn online
 * payments on however many providers were connected.
 * -------------------------------------------------------------------------- */

/**
 * Whether the UI should offer an online payment step.
 *
 * Requires BOTH the operator's opt-in in settings AND a provider with
 * credentials, so ticking the box without deploying keys cannot strand a guest
 * on a dead checkout button. That was the original contract and it is unchanged
 * — only the definition of "a gateway is configured" moved.
 */
export function isDepositPaymentEnabled(settings: Settings): boolean {
  if (!onlinePaymentsEnabled(settings)) return false;
  return availableProviders(settings).length > 0;
}

/**
 * Which of three states the gateway layer is in.
 *
 * Returns a stable code rather than a sentence: this module is imported by
 * server code with no request scope and therefore no locale, so translating
 * here would hard-code one language. The admin settings page resolves the code
 * against the dictionary, where the operator's language is known.
 */
export type DepositPaymentState = "DISABLED" | "MISCONFIGURED" | "ENABLED";

export function depositPaymentStatus(settings: Settings): DepositPaymentState {
  if (!onlinePaymentsEnabled(settings)) return "DISABLED";
  if (availableProviders(settings).length === 0) return "MISCONFIGURED";
  return "ENABLED";
}
