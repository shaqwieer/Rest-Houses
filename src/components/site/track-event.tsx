"use client";

import { useEffect } from "react";
import { track, trackOnce, type TrackEventName, type TrackPayload } from "@/lib/tracking-events";

/**
 * Report an event for a page that has just been rendered.
 *
 * Some of what the plan asks for is a *moment* — a WhatsApp button pressed, a
 * booking request accepted — and those call `track()` from the handler that
 * already knows it happened. The rest is a *page*: opening a rest house is
 * `ViewProperty`, and a results page is `Search`. Those have no handler to hang
 * off, and the pages themselves are server components, so this is the one-line
 * client island that fires them.
 *
 * Renders nothing. Placed anywhere inside the page it describes.
 *
 * ─── Why it is an effect and not a render-time call ──────────────────────────
 * The pixels install their globals with `next/script`'s `afterInteractive`,
 * which runs after hydration. Reporting during render would also mean reporting
 * during the server render, where there is no browser at all.
 *
 * ─── `dedupeKey` ─────────────────────────────────────────────────────────────
 * Given a key, the event is reported at most once for that key per tab —
 * through `trackOnce`, whose sessionStorage guard survives the back button and
 * a refresh. That is what a `Purchase` needs: a guest who reloads the
 * confirmation screen has not paid a second time.
 *
 * Without a key the event fires on every mount, which is what a page view
 * wants: opening the same rest house twice in a session really is two views.
 */
export function TrackEvent({
  event,
  payload,
  dedupeKey,
}: {
  event: TrackEventName;
  payload?: TrackPayload;
  /** Present for events that must not repeat — a booking reference, say. */
  dedupeKey?: string;
}) {
  // The payload is a fresh object on every render, so the effect keys off its
  // *contents*. Without this, a parent re-render would re-report the event.
  const fingerprint = JSON.stringify(payload ?? {});

  useEffect(() => {
    const data = JSON.parse(fingerprint) as TrackPayload;
    if (dedupeKey) trackOnce(dedupeKey, event, data);
    else track(event, data);
  }, [event, fingerprint, dedupeKey]);

  return null;
}
