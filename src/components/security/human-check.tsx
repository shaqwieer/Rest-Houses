"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import clsx from "clsx";
import { Icon } from "@/components/ui/icon";
import { useLocale } from "@/lib/i18n/provider";
import { sha256Hex, leadingZeroBits } from "@/lib/security/sha256";

/**
 * The human check that sits above the submit button on the booking and owner
 * registration forms.
 *
 * ─── Two widgets, one slot ───────────────────────────────────────────────────
 * `/api/human-check` answers with both a challenge *and* which provider the
 * operator has configured, so this component renders whichever applies without
 * the page above it knowing or caring:
 *
 *   provider "none"      → the built-in checkbox below, whose tick is backed by
 *                          a proof of work the server verifies
 *   "turnstile"          → Cloudflare's widget
 *   "recaptcha"          → Google's "I'm not a robot" checkbox
 *
 * ─── Why the built-in check ticks itself ─────────────────────────────────────
 * The familiar checkbox asks the visitor to prove they are present by clicking.
 * The proof of work proves the same thing better — it costs the *sender* real
 * arithmetic whether or not anyone clicked — and it can run while the guest is
 * still typing their phone number. So the box fills itself in, and by the time
 * the form is complete it already reads "verified".
 *
 * Making a guest click a box we do not need them to click would be theatre. What
 * they get instead is a check that has already passed, and a submit button that
 * is only enabled once it has.
 *
 * ─── Hashing in the main thread ──────────────────────────────────────────────
 * The search runs in slices with a yield between them, so a slow phone scrolls
 * smoothly through it. At the default difficulty the whole thing is a few
 * thousand hashes — a fraction of a second — and a Web Worker for that would be
 * more moving parts than it saves.
 */

export const HUMAN_CHECK_READY_MS = 2_000;

type Purpose = "booking" | "owner-register";

type Challenge = {
  token: string;
  nonce: string;
  difficulty: number;
  provider: "none" | "turnstile" | "recaptcha";
  siteKey: string;
};

type Status = "loading" | "solving" | "ready" | "waiting" | "error";

declare global {
  interface Window {
    turnstile?: {
      render: (el: HTMLElement, opts: Record<string, unknown>) => string;
      reset: (id?: string) => void;
    };
    grecaptcha?: {
      ready: (cb: () => void) => void;
      render: (el: HTMLElement, opts: Record<string, unknown>) => number;
      reset: (id?: number) => void;
    };
  }
}

/** Load a third-party script once, no matter how many widgets ask for it. */
const scriptPromises = new Map<string, Promise<void>>();

function loadScript(src: string): Promise<void> {
  const existing = scriptPromises.get(src);
  if (existing) return existing;

  const promise = new Promise<void>((resolve, reject) => {
    const el = document.createElement("script");
    el.src = src;
    el.async = true;
    el.defer = true;
    el.onload = () => resolve();
    el.onerror = () => reject(new Error(`failed to load ${src}`));
    document.head.appendChild(el);
  });

  scriptPromises.set(src, promise);
  return promise;
}

export function HumanCheck({
  purpose,
  /** Bump to throw away the current challenge and fetch a fresh one. */
  resetKey = 0,
  onReadyChange,
  className,
}: {
  purpose: Purpose;
  resetKey?: number;
  onReadyChange?: (ready: boolean) => void;
  className?: string;
}) {
  const { t, locale } = useLocale();

  const [challenge, setChallenge] = useState<Challenge | null>(null);
  const [solution, setSolution] = useState("");
  const [captchaToken, setCaptchaToken] = useState("");
  const [status, setStatus] = useState<Status>("loading");

  // Bumped by the retry button. Combined with `resetKey` so a reset asked for
  // by the parent and one asked for by the visitor take the identical path.
  const [retryCount, setRetryCount] = useState(0);

  const widgetRef = useRef<HTMLDivElement | null>(null);
  const renderedFor = useRef<string | null>(null);

  // `onReadyChange` is usually an inline arrow, so it changes identity on every
  // render of the parent. Held in a ref so it never re-triggers the effects.
  const onReadyRef = useRef(onReadyChange);
  onReadyRef.current = onReadyChange;

  /* ---- fetch a challenge ------------------------------------------------ */
  useEffect(() => {
    let cancelled = false;
    setStatus("loading");
    setSolution("");
    setCaptchaToken("");

    // Bounded, so a request that never comes back cannot leave the check sitting
    // on "verifying…" with a permanently disabled send button and no way out.
    // Found by running it: the first hit in dev waits on the route compiling, and
    // a visitor on a bad connection would see the same stall in production. On
    // timeout the widget shows its retry button, which is a dead end no longer.
    fetch(`/api/human-check?purpose=${purpose}`, {
      cache: "no-store",
      signal: AbortSignal.timeout(15_000),
    })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((data: Challenge) => {
        if (cancelled) return;
        setChallenge(data);
      })
      .catch(() => {
        if (!cancelled) setStatus("error");
      });

    return () => {
      cancelled = true;
    };
  }, [purpose, resetKey, retryCount]);

  /* ---- solve the proof of work ------------------------------------------ */
  useEffect(() => {
    if (!challenge) return;

    let cancelled = false;
    let counter = 0;
    setStatus("solving");

    // Sized so a slice is a few milliseconds even on a slow device, keeping the
    // page responsive while the search runs.
    const SLICE = 1_500;

    function step() {
      if (cancelled || !challenge) return;
      const end = counter + SLICE;

      for (; counter < end; counter++) {
        if (leadingZeroBits(sha256Hex(`${challenge.nonce}:${counter}`)) >= challenge.difficulty) {
          setSolution(String(counter));
          return;
        }
      }

      // A run this long means the difficulty was raised past what this device
      // can do quickly. Stop rather than spin: the server will refuse the
      // submission and the guest gets a retry button, which beats a frozen tab.
      if (counter > 40_000_000) {
        setStatus("error");
        return;
      }

      setTimeout(step, 0);
    }

    step();
    return () => {
      cancelled = true;
    };
  }, [challenge]);

  /* ---- mount the third-party widget, when one is configured -------------- */
  useEffect(() => {
    if (!challenge || challenge.provider === "none" || !widgetRef.current) return;
    // Re-rendering a provider widget into the same node duplicates it.
    if (renderedFor.current === challenge.token) return;
    renderedFor.current = challenge.token;

    const node = widgetRef.current;
    node.innerHTML = "";
    let cancelled = false;

    const src =
      challenge.provider === "turnstile"
        ? "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit"
        : `https://www.google.com/recaptcha/api.js?render=explicit&hl=${locale}`;

    loadScript(src)
      .then(() => {
        if (cancelled) return;
        if (challenge.provider === "turnstile") {
          window.turnstile?.render(node, {
            sitekey: challenge.siteKey,
            language: locale,
            callback: (token: string) => setCaptchaToken(token),
            "expired-callback": () => setCaptchaToken(""),
            "error-callback": () => setCaptchaToken(""),
          });
        } else {
          window.grecaptcha?.ready(() => {
            if (cancelled) return;
            window.grecaptcha?.render(node, {
              sitekey: challenge.siteKey,
              callback: (token: string) => setCaptchaToken(token),
              "expired-callback": () => setCaptchaToken(""),
              "error-callback": () => setCaptchaToken(""),
            });
          });
        }
      })
      .catch(() => {
        if (!cancelled) setStatus("error");
      });

    return () => {
      cancelled = true;
    };
  }, [challenge, locale]);

  /* ---- readiness --------------------------------------------------------- */
  //
  // Solved is not the same as submittable. The server refuses a submission that
  // arrives less than two seconds after its challenge was minted — no human
  // fills a booking form that fast — so the button stays disabled until that
  // floor has passed. In practice it elapses long before anyone finishes typing.
  const needsCaptcha = challenge?.provider !== "none";
  const solved = solution !== "" && (!needsCaptcha || captchaToken !== "");

  useEffect(() => {
    if (status === "error") {
      onReadyRef.current?.(false);
      return;
    }
    if (!solved) {
      if (status !== "loading") setStatus("solving");
      onReadyRef.current?.(false);
      return;
    }

    setStatus("waiting");
    onReadyRef.current?.(false);

    const timer = setTimeout(() => {
      setStatus("ready");
      onReadyRef.current?.(true);
    }, HUMAN_CHECK_READY_MS);

    return () => clearTimeout(timer);
    // `status` is deliberately absent: this effect sets it, and reading it back
    // would loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [solved, challenge]);

  const retry = useCallback(() => setRetryCount((n) => n + 1), []);

  return (
    <div className={className}>
      {/* The values the server reads. Kept out of the visual layout entirely. */}
      <input type="hidden" name="securityToken" value={challenge?.token ?? ""} readOnly />
      <input type="hidden" name="humanProof" value={solution} readOnly />
      <input type="hidden" name="captchaToken" value={captchaToken} readOnly />

      {/* ---- honeypot ----
          Hidden by clipping it to nothing rather than by `display:none` (which
          some form fillers skip) or by shoving it off-screen at -9999px. The
          off-screen trick is the usual one and it is wrong here: this site's
          default direction is RTL, where a negative inline-start offset pushes
          the field 9999px past the right edge and gives the whole page a
          horizontal scrollbar. Clipping occupies no space in any direction.

          `aria-hidden` + `tabIndex={-1}` keep it away from screen readers and
          the keyboard, so no real visitor can put anything in it — which is what
          makes a non-empty value conclusive. */}
      <div
        aria-hidden
        className="pointer-events-none absolute h-px w-px overflow-hidden opacity-0"
        style={{ clipPath: "inset(50%)" }}
      >
        <label htmlFor="website-url-hp">Website</label>
        <input
          id="website-url-hp"
          name="websiteUrl"
          type="text"
          tabIndex={-1}
          autoComplete="off"
          defaultValue=""
        />
      </div>

      {challenge && challenge.provider !== "none" ? (
        // The provider draws its own box; all this contributes is the spacing
        // and the note underneath.
        <div className="flex flex-col gap-2">
          <div ref={widgetRef} />
          {status === "error" && <RetryLine label={t.security.retry} onRetry={retry} />}
        </div>
      ) : (
        <BuiltInCheck status={status} onRetry={retry} />
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------- */

function BuiltInCheck({ status, onRetry }: { status: Status; onRetry: () => void }) {
  const { t } = useLocale();
  const done = status === "ready";
  const failed = status === "error";

  return (
    <div
      className={clsx(
        "flex items-center gap-3 rounded-[16px] border px-4 py-3.5 transition",
        failed ? "border-busy bg-busy-bg" : done ? "border-ok/40 bg-ok-bg" : "border-line bg-sand-50",
      )}
      // Announced once it settles, so a screen-reader user is told the form is
      // ready to send rather than silently waiting on a disabled button.
      role="status"
      aria-live="polite"
    >
      <span
        className={clsx(
          "grid size-6 shrink-0 place-items-center rounded-[7px] border-2 transition",
          failed
            ? "border-busy text-busy"
            : done
              ? "border-ok bg-ok text-white"
              : "border-sand-400 text-transparent",
        )}
      >
        {failed ? (
          <Icon name="error" size={16} />
        ) : done ? (
          <Icon name="check" size={16} />
        ) : (
          <span className="size-2.5 animate-pulse rounded-full bg-sand-400" />
        )}
      </span>

      <span className="min-w-0 flex-1">
        <span className="block text-[13.5px] font-bold text-ink">
          {failed ? t.security.checkFailedShort : done ? t.security.verified : t.security.verifying}
        </span>
        <span className="block text-[11.5px] text-muted">{t.security.protectedNote}</span>
      </span>

      {failed && <RetryLine label={t.security.retry} onRetry={onRetry} />}
    </div>
  );
}

function RetryLine({ label, onRetry }: { label: string; onRetry: () => void }) {
  return (
    <button
      type="button"
      onClick={onRetry}
      className="shrink-0 rounded-full border border-line bg-surface px-3 py-1.5 text-[12px] font-bold text-bronze transition hover:border-gold-500"
    >
      {label}
    </button>
  );
}
