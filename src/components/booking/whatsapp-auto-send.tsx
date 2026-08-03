"use client";

import { useEffect, useRef, useState } from "react";
import { Icon } from "@/components/ui/icon";
import { ButtonLink } from "@/components/ui/button";
import { arNum } from "@/lib/format";
import { useLocale } from "@/lib/i18n/provider";

/**
 * The confirmation screen's WhatsApp button, with a five-second countdown that
 * opens the message on its own.
 *
 * The guest has just filled in a form and pressed send; asking them to press a
 * second button to actually deliver the request is a step where people drop out
 * and the owner never hears about a booking that exists in the database. So the
 * page does it for them — and still shows the button, because an automatic
 * action nobody can see or stop is worse than a manual one.
 *
 * ─── Why the current tab, not a new one ──────────────────────────────────────
 * `window.open` and a programmatic `target="_blank"` click are both treated as
 * pop-ups once the user gesture that started them has ended — and a five-second
 * timer has very much ended it. Every pop-up blocker would swallow this
 * silently. A same-tab `location.href` is an ordinary navigation and is not
 * blocked. On a phone `wa.me` hands straight over to the WhatsApp app; on
 * desktop it opens WhatsApp Web.
 *
 * ─── Why the sessionStorage flag ─────────────────────────────────────────────
 * Coming back from WhatsApp with the browser's back button lands on this page
 * again. Without a record that it has already fired, the countdown would start
 * over and throw the guest straight back out — a loop they cannot escape
 * without closing the tab. The flag is keyed by booking reference, so a second,
 * genuinely different booking still gets its countdown, and it lives in
 * sessionStorage rather than localStorage so re-opening the confirmation link
 * tomorrow behaves like the first visit.
 *
 * Cancelling stops the timer for good on this visit. `wa.me` still pre-types
 * the message rather than sending it, so the guest always has the final say.
 */

/** Seconds on the clock before the message opens. */
const COUNTDOWN_SECONDS = 5;

export function WhatsappAutoSend({
  href,
  reference,
}: {
  /** The wa.me deep link. "" when the listing has no usable number. */
  href: string;
  /** Booking reference — scopes the already-sent flag to this request. */
  reference: string;
}) {
  const { t, locale } = useLocale();

  // null = no countdown running (already fired on an earlier visit, cancelled,
  // or there is no number to open). A number = seconds remaining.
  const [secondsLeft, setSecondsLeft] = useState<number | null>(null);
  const [cancelled, setCancelled] = useState(false);
  // Survives the re-render that starts the navigation, so a slow unload can't
  // let a second tick fire another one.
  const firedRef = useRef(false);

  const storageKey = `wa-auto-sent:${reference}`;

  // Start the clock — in an effect, not in `useState`, because sessionStorage
  // does not exist during the server render and reading it there would make the
  // first client paint disagree with the HTML.
  useEffect(() => {
    if (!href) return;

    let alreadySent = false;
    try {
      alreadySent = window.sessionStorage.getItem(storageKey) === "1";
    } catch {
      // Private mode, or storage disabled. Falling through means the countdown
      // runs — the message is pre-typed and not sent, so the worst case is one
      // extra hand-off, which beats never delivering the request at all.
    }
    if (alreadySent) return;

    setSecondsLeft(COUNTDOWN_SECONDS);
  }, [href, storageKey]);

  // Tick, then navigate.
  useEffect(() => {
    if (secondsLeft === null || cancelled) return;

    if (secondsLeft <= 0) {
      if (firedRef.current) return;
      firedRef.current = true;
      try {
        window.sessionStorage.setItem(storageKey, "1");
      } catch {
        /* nothing to do — see the note above */
      }
      window.location.href = href;
      return;
    }

    const timer = window.setTimeout(() => setSecondsLeft((s) => (s ?? 1) - 1), 1000);
    return () => window.clearTimeout(timer);
  }, [secondsLeft, cancelled, href, storageKey]);

  // No number on this listing — the page already hides the button in that case,
  // and there is nothing to count down to.
  if (!href) return null;

  const counting = secondsLeft !== null && secondsLeft > 0 && !cancelled;

  return (
    <div className="flex w-full flex-col items-center gap-2">
      {/* Tapping the button stops the clock.
          Without this, a guest who presses at t=3 opens WhatsApp in a new tab
          (ButtonLink targets _blank for external links) while this tab keeps
          ticking and hands off a *second* time at t=0.
          The handler sits on a wrapper rather than the button because
          `ButtonLink`'s external branch renders a bare anchor and does not
          spread extra props — an `onClick` passed to it would be dropped
          silently. A click on the anchor, including one from pressing Enter on
          it, bubbles here. */}
      <span onClick={() => setCancelled(true)} className="contents">
        <ButtonLink href={href} variant="whatsapp" size="lg">
          <Icon name="chat" size={20} />
          {counting
            ? t.booking.autoSendButton(arNum(secondsLeft, locale))
            : t.booking.openWhatsapp}
        </ButtonLink>
      </span>

      {/* Announced politely rather than assertively: it repeats every second,
          and an assertive region would interrupt a screen reader five times
          over. The cancel control is a real button, reachable by keyboard. */}
      <p
        aria-live="polite"
        className="m-0 flex flex-wrap items-center justify-center gap-2 text-[12px] text-muted"
      >
        {counting ? (
          <>
            <span>
              {t.booking.autoSendCountdown(arNum(secondsLeft, locale), secondsLeft)}
            </span>
            <button
              type="button"
              onClick={() => setCancelled(true)}
              className="rounded-lg border border-line bg-surface px-2.5 py-1 text-[12px] font-bold text-ink transition hover:border-busy hover:text-busy"
            >
              {t.booking.autoSendCancel}
            </button>
          </>
        ) : (
          <span>{cancelled ? t.booking.autoSendCancelled : t.booking.autoSendManual}</span>
        )}
      </p>
    </div>
  );
}
