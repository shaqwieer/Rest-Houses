"use client";

const reportedBookings = new Set<string>();

/**
 * Report the booking-request conversion to Google Ads after
 * `createBookingRequest` succeeds.
 *
 * ─── `sendTo` is a parameter, not a constant ─────────────────────────────────
 * It used to be a string literal in this file. /admin/settings collected a tag
 * ID and a conversion label, validated them, and showed the operator a green
 * "tracking is live" line — while the conversion this function actually
 * reported went to a hardcoded account that had nothing to do with either
 * field. Every symptom of that is silent: the form looks configured, the page
 * looks live, and the conversions arrive somewhere else entirely.
 *
 * So the value comes from the settings row now, assembled by `googleAdsSendTo`
 * — which returns "" unless BOTH halves are configured, because
 * "AW-950802645/" is a `send_to` Google accepts and attributes to nothing.
 * An empty value reports nothing at all.
 *
 * ─── Why this is imperative and not a confirmation-page component ────────────
 * Viewing or refreshing an existing booking must never be enough to produce a
 * conversion. The caller supplies the server-issued reference only from the
 * action's successful result.
 *
 * The in-memory and session-storage guards cover repeated result handling,
 * back/forward navigation, and accidental duplicate calls in the same tab. If
 * storage is unavailable, the in-memory guard still protects this page load.
 *
 * ─── `transaction_id` is the third guard, and the only one Google holds ──────
 * The reference is sent as the conversion's transaction id. Google Ads counts
 * one conversion per transaction id per conversion action, so a repeat that
 * gets past both browser guards — a second tab, a cleared session, a retry
 * from a different device — is dropped on Google's side instead of counted.
 * No `value`: a request is not revenue until the owner confirms it.
 *
 * This is the Google Ads conversion specifically. The same moment is reported
 * to Meta, TikTok and Snapchat through `track("BookingRequested")` — see
 * src/lib/tracking-events.ts — because a Google Ads conversion has a `send_to`
 * and its own de-duplication rules that the other three do not share.
 */
export function reportBookingRequestConversion(reference: string, sendTo: string): boolean {
  if (
    !reference ||
    !sendTo ||
    reportedBookings.has(reference) ||
    typeof window === "undefined"
  ) {
    return false;
  }

  const gtag = (window as unknown as { gtag?: (...args: unknown[]) => void }).gtag;
  if (typeof gtag !== "function") return false;

  const storageKey = `gads-booking-request:${reference}`;
  try {
    if (window.sessionStorage.getItem(storageKey) === "1") {
      reportedBookings.add(reference);
      return false;
    }
  } catch {
    // Storage can be unavailable in privacy modes. The in-memory guard above
    // still prevents duplicate calls during this page lifetime.
  }

  // Mark before calling external code so a synchronous re-entry cannot report
  // the same successful booking twice. Tracking must never interrupt the
  // redirect to the confirmation and WhatsApp flow, even if gtag itself throws.
  reportedBookings.add(reference);
  try {
    window.sessionStorage.setItem(storageKey, "1");
  } catch {
    // The in-memory guard remains active.
  }

  try {
    gtag("event", "conversion", { send_to: sendTo, transaction_id: reference });
  } catch {
    // Analytics failures must not affect a successful booking.
  }

  return true;
}
