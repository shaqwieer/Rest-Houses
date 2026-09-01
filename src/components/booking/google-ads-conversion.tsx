"use client";

const reportedBookings = new Set<string>();

/**
 * Report the Booking Request conversion after `createBookingRequest` succeeds.
 *
 * This is deliberately an imperative function, not a confirmation-page
 * component: viewing or refreshing an existing booking must never be enough to
 * produce a conversion. The caller supplies the server-issued reference only
 * from the action's successful result.
 *
 * The in-memory and session-storage guards cover repeated result handling,
 * back/forward navigation, and accidental duplicate calls in the same tab. If
 * storage is unavailable, the in-memory guard still protects this page load.
 */
export function reportBookingRequestConversion(reference: string): boolean {
  if (!reference || reportedBookings.has(reference) || typeof window === "undefined") {
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
    gtag('event', 'conversion', {
      send_to: 'AW-950802645/v8J9CO7Sk-wcENWxsMUD',
    });
  } catch {
    // Analytics failures must not affect a successful booking.
  }

  return true;
}
