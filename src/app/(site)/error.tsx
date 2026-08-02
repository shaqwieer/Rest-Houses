"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Icon } from "@/components/ui/icon";
import { useLocale } from "@/lib/i18n/provider";

/**
 * Error boundary for the public site.
 *
 * ─── Why this file exists ────────────────────────────────────────────────────
 * There was no `error.tsx` anywhere in the tree, so any failure below the site
 * layout fell all the way through to Next's built-in root boundary, whose
 * entire output is the sentence «Application error: a client-side exception has
 * occurred (see the browser console for more information)» on a blank page.
 * That is the screen guests were being shown. It offers them nothing to do, and
 * it offers us nothing to debug: the real message is minified away in a
 * production build, and the visitor is the only person who can see the console.
 *
 * This boundary changes both halves of that:
 *
 *   • the guest gets the site's own chrome, a sentence in their language, a
 *     retry button and a way back to the catalogue
 *   • we get `error.digest` printed on the page — the id Next also writes into
 *     the *server* log for the same failure, so a guest can read six characters
 *     over the phone and we can `grep` the container log for the stack
 *
 * ─── The chunk-load case, which is handled rather than reported ──────────────
 * One failure mode here is not worth showing anybody. After a deploy, a browser
 * still holding the previous build's page navigates and asks for a JavaScript
 * chunk whose content hash no longer exists on the server. The request 404s and
 * React unmounts into this boundary. It looks exactly like a bug and is cured
 * entirely by reloading — which is precisely the "the error goes away when I
 * refresh" report that led here.
 *
 * So we reload automatically instead of asking the guest to — but at most once
 * in any ten-second window, remembered in sessionStorage. A boundary that
 * reloads on every render is an infinite loop that pins the CPU and locks the
 * visitor out of the page entirely, so if the reload did not fix it the cause
 * was something else and the message is shown instead. A *time* window rather
 * than a one-shot flag because the same tab may still be open across the next
 * deploy days later, and that reload is a new, legitimate one.
 *
 * `reset()` alone is not enough for this case — it re-renders the same tree,
 * which asks for the same missing chunk again. Only a document reload fetches
 * the new build's HTML and its new chunk names.
 */

/** Matches what every browser and bundler calls a failed lazy import. */
const CHUNK_ERROR = /ChunkLoadError|Loading chunk [\w-]+ failed|Failed to fetch dynamically imported module|error loading dynamically imported module|Importing a module script failed/i;

const RELOAD_KEY = "desert-chalets:chunk-reloaded-at";

/** How long one automatic reload suppresses the next. */
const RELOAD_COOLDOWN_MS = 10_000;

export default function SiteError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const { t } = useLocale();
  const [reloading, setReloading] = useState(false);

  useEffect(() => {
    const stale = CHUNK_ERROR.test(`${error.name} ${error.message}`);
    if (!stale) return;

    const now = Date.now();
    try {
      const last = Number(window.sessionStorage.getItem(RELOAD_KEY) ?? 0);
      if (now - last < RELOAD_COOLDOWN_MS) return;
      window.sessionStorage.setItem(RELOAD_KEY, String(now));
    } catch {
      // Private browsing with storage disabled: we cannot remember that we
      // already reloaded, so don't reload at all. Showing the message once is
      // far better than a reload loop we have no way to break out of.
      return;
    }

    setReloading(true);
    // A document reload, not `reset()` — `reset()` re-renders the same tree and
    // asks for the same missing chunk again.
    window.location.reload();
  }, [error]);

  return (
    <div className="grid min-h-[70vh] place-items-center bg-sand-50 px-4 py-14">
      <div className="max-w-[46ch] text-center">
        <div className="mx-auto mb-6 grid size-24 place-items-center rounded-full bg-sand-100">
          <Icon
            name={reloading ? "event_repeat" : "info"}
            size={46}
            className="text-sand-400"
          />
        </div>

        <h1 className="m-0 mb-3 font-display text-[clamp(22px,4vw,30px)] font-extrabold text-ink">
          {reloading ? t.error.updating : t.error.title}
        </h1>

        {!reloading && (
          <>
            <p className="m-0 mb-7 text-[15px] leading-[1.9] text-muted">{t.error.body}</p>

            <div className="flex flex-wrap justify-center gap-2.5">
              <button
                type="button"
                onClick={reset}
                className="inline-flex items-center gap-2 rounded-full bg-linear-[140deg,var(--gold-500),var(--gold-600)] px-6 py-3.5 font-display text-[15px] font-extrabold text-night-900 shadow-gold"
              >
                <Icon name="event_repeat" size={19} />
                {t.error.retry}
              </button>
              <Link
                href="/listings"
                className="inline-flex items-center gap-2 rounded-full border border-line bg-surface px-6 py-3.5 text-[15px] font-bold text-ink no-underline hover:border-gold-500 hover:no-underline"
              >
                {t.notFound.browse}
              </Link>
            </div>

            {/* The one piece of machine-readable evidence a guest can pass on.
                Next writes the same digest into the server log for the failure
                that produced it, so this turns "it broke" into a grep. */}
            {error.digest && (
              <p className="m-0 mt-7 text-[12px] text-muted">
                {t.error.reference}: <code dir="ltr">{error.digest}</code>
              </p>
            )}
          </>
        )}
      </div>
    </div>
  );
}
