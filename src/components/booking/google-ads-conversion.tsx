"use client";

import { useEffect, useRef } from "react";

/**
 * Reports one Google Ads conversion when the booking confirmation page is shown.
 *
 * Renders nothing. It exists as a component rather than an inline script for
 * three reasons that are all about *not* counting a booking twice.
 *
 * ─── Why it waits for `gtag` instead of pushing straight to dataLayer ────────
 * Google's own snippet gets away with calling `gtag('event', …)` while gtag.js
 * is still downloading, because the `js` and `config` commands sit above it in
 * the same `<head>` and are therefore already on the queue. Here the two live in
 * different components — the loader is mounted by the public layout — and
 * nothing guarantees the layout's script has run by the time this effect fires.
 * An event queued ahead of its `config` is dropped when the library replays the
 * queue, and a dropped conversion is invisible: no error, no console message,
 * just a number that never arrives in Google Ads.
 *
 * So it polls for `window.gtag`. The loader defines it in the same script that
 * queues `js` and `config`, so "gtag exists" is exactly the signal "the config
 * is already on the queue". The poll is fast (100 ms) because the confirmation
 * page hands the guest off to WhatsApp five seconds after it loads.
 *
 * ─── Why it fires once ──────────────────────────────────────────────────────
 * Two independent guards, because they cover different cases:
 *   • `sessionStorage`, keyed by reference — stops the back button from
 *     WhatsApp re-firing the event, the same problem `WhatsappAutoSend` solves
 *     the same way, and for the same reason.
 *   • `transaction_id` — Google's own de-duplication. It covers what the flag
 *     cannot: the guest re-opening the confirmation link tomorrow, on another
 *     device, or in a new session.
 *
 * ─── What `value` means here ────────────────────────────────────────────────
 * The booking's stored total, in AED — the snapshot taken when the request was
 * created, not the listing's current rate, so the figure reported to Google is
 * the one the guest was actually quoted. It is a *requested* booking, not a
 * settled payment; that is what this conversion has always counted, and the
 * value makes the number comparable to ad spend rather than a bare tally.
 */
export function GoogleAdsConversion({
  sendTo,
  transactionId,
  value,
  currency = "AED",
}: {
  /** "AW-950802645/dVoECJ30sOQcENWxsMUD". "" when no conversion is configured. */
  sendTo: string;
  /** The booking reference — Google de-duplicates on it. */
  transactionId: string;
  value: number;
  currency?: string;
}) {
  const fired = useRef(false);

  useEffect(() => {
    if (!sendTo || fired.current) return;

    const storageKey = `gads-conversion:${transactionId}`;
    try {
      if (window.sessionStorage.getItem(storageKey) === "1") return;
    } catch {
      // Private mode or storage disabled. Falling through means the event may
      // fire again on a back-button return — which `transaction_id` then
      // de-duplicates. Losing the conversion entirely would be the worse trade.
    }

    let tries = 0;
    const timer = window.setInterval(() => {
      const gtag = (window as unknown as { gtag?: (...args: unknown[]) => void }).gtag;

      // ~10s. If the tag has not loaded by then it is blocked (an ad blocker,
      // an offline tab, a consent tool) and no amount of waiting will help.
      if (typeof gtag !== "function") {
        if (++tries > 100) window.clearInterval(timer);
        return;
      }

      window.clearInterval(timer);
      if (fired.current) return;
      fired.current = true;

      try {
        window.sessionStorage.setItem(storageKey, "1");
      } catch {
        /* nothing to do — see the note above */
      }

      gtag("event", "conversion", {
        send_to: sendTo,
        transaction_id: transactionId,
        value,
        currency,
      });
    }, 100);

    return () => window.clearInterval(timer);
  }, [sendTo, transactionId, value, currency]);

  return null;
}
