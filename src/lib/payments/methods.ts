import { PAYMENT_MODES, isPaymentMode, type PaymentMode } from "@/lib/constants";

// Re-exported so server callers can reach it through this module alongside
// the helpers that use it. Defined in constants.ts — see the note there for
// why it cannot live in this directory.
export { PAYMENT_MODES_FIELD } from "@/lib/constants";
import { parseIdList, stringifyIdList } from "@/lib/json-list";
import type { Settings } from "@/lib/settings";
import { availableProviders, onlinePaymentsEnabled } from "./config";

/**
 * Which ways a given rest house will take money.
 *
 * Two tiers, resolved in this order:
 *
 *   1. the PLATFORM's list — what is switched on and configured at all
 *   2. the LISTING's list  — an owner narrowing that, or `null` to inherit
 *
 * The second can only ever narrow the first. An owner cannot switch on a
 * gateway the platform has not connected, which is not a UI convention but an
 * intersection computed here: `resolveListingPaymentModes` filters the owner's
 * list against the platform's rather than trusting it. Otherwise a stale
 * `paymentModes` column written while Telr was live would keep offering a
 * checkout after the operator switched Telr off.
 */

/**
 * What the platform offers, before any listing narrows it.
 *
 * "MANUAL" is unconditional. Bank transfer and cash settled with the owner is
 * what this platform has always done and is not gated on anything — a
 * deployment with no gateway, no credentials and every switch off still takes
 * bookings exactly as it does today. That is the property that lets this whole
 * subsystem ship in the off position.
 *
 * "ONLINE" needs at least one provider past all three gates in config.ts.
 * "LINK" needs that too, plus the operator's own opt-in: issuing a link is a
 * different act from taking a payment in the booking flow, and an operator may
 * reasonably want one without the other.
 */
export function platformPaymentModes(settings: Settings): PaymentMode[] {
  const modes: PaymentMode[] = ["MANUAL"];

  const online = onlinePaymentsEnabled(settings) && availableProviders(settings).length > 0;
  if (online) {
    modes.push("ONLINE");
    if (settings.paymentLinksEnabled) modes.push("LINK");
  }

  return modes;
}

/**
 * One rest house's list.
 *
 * `stored` is `Listing.paymentModes` — JSON text, or null.
 *
 * ─── null and "[]" are different answers ────────────────────────────────────
 * null means "inherit the platform's", `[]` means "this owner has switched
 * everything off". A truthiness check would collapse them and silently re-open
 * a checkout an owner deliberately closed — the same trap `resolveDepositPercent`
 * exists to avoid, documented on `Listing.depositPercent`.
 *
 * ─── MANUAL survives whatever the column says ───────────────────────────────
 * A listing that has narrowed itself to nothing still takes manual bookings,
 * because the alternative is a published rest house a guest cannot book at all.
 * An owner switching off "ONLINE" is saying "talk to me on WhatsApp", not
 * "stop selling my استراحة".
 */
export function resolveListingPaymentModes(
  stored: string | null | undefined,
  settings: Settings,
): PaymentMode[] {
  const platform = platformPaymentModes(settings);

  if (stored === null || stored === undefined) return platform;

  const chosen = parseIdList(stored).filter(isPaymentMode);

  // The intersection, in the platform's order — so the list a guest sees is
  // ordered consistently across listings rather than by whatever order the
  // owner's column happens to hold.
  const narrowed = platform.filter((m) => chosen.includes(m));

  return narrowed.includes("MANUAL") ? narrowed : ["MANUAL", ...narrowed];
}

/**
 * Serialise an owner's choice back to the column.
 *
 * Returns null — "inherit" — when the choice is everything the platform
 * currently offers, so an owner who ticks every box does not freeze today's
 * platform list onto their listing. Without this, switching a new gateway on
 * platform-side would reach none of the listings whose owners had already
 * opted into "all of them", which is the opposite of what they asked for.
 */
export function serializeListingPaymentModes(
  chosen: readonly string[],
  settings: Settings,
): string | null {
  const platform = platformPaymentModes(settings);
  const valid = PAYMENT_MODES.filter((m) => chosen.includes(m) && platform.includes(m));

  if (valid.length === platform.length) return null;
  return stringifyIdList(valid);
}

/**
 * May this listing be paid for in this way, right now?
 *
 * The single question every payment entry point asks before doing anything —
 * the booking form when a guest picks a method, `startPayment` before it opens
 * a checkout, and the payment-link page before it renders a button. Asking it
 * in one place is what stops a guest reaching a checkout for a listing whose
 * owner switched online payment off between page load and submit.
 */
export function isModeAvailable(
  mode: string,
  listingModes: string | null | undefined,
  settings: Settings,
): boolean {
  if (!isPaymentMode(mode)) return false;
  return resolveListingPaymentModes(listingModes, settings).includes(mode);
}

/**
 * The stored column as the editor wants it: a list of ids, or null to inherit.
 *
 * Distinct from `resolveListingPaymentModes` above, which answers "what may a
 * guest actually use" and therefore intersects with the platform's list. This
 * one answers "what did the owner tick", and must NOT intersect: a listing that
 * opted into ONLINE while Telr was live should show ONLINE still ticked after
 * an operator switches Telr off, so that switching it back on restores the
 * owner's actual choice rather than a narrowed copy of it.
 *
 * The two being separate is the same distinction `depositPercent` draws between
 * the stored null and the resolved number.
 */
export function parseListingPaymentModes(stored: string | null | undefined): string[] | null {
  if (stored === null || stored === undefined) return null;
  return parseIdList(stored).filter(isPaymentMode);
}
