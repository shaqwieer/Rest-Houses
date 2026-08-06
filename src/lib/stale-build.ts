"use client";

import { useEffect, useState } from "react";

/**
 * The one error-boundary case that is handled rather than reported.
 *
 * After a deploy, a browser still holding the previous build's page navigates
 * and asks for a JavaScript chunk whose content hash no longer exists on the
 * server. The request 404s and React unmounts into the nearest boundary. It
 * looks exactly like a bug and is cured entirely by reloading — which is
 * precisely the "the error goes away when I refresh" report this exists for.
 *
 * So we reload automatically instead of asking the visitor to — but at most once
 * in any ten-second window, remembered in sessionStorage. A boundary that
 * reloads on every render is an infinite loop that pins the CPU and locks the
 * visitor out of the page entirely, so if the reload did not fix it the cause was
 * something else and the boundary shows its message instead. A *time* window
 * rather than a one-shot flag because the same tab may still be open across the
 * next deploy days later, and that reload is a new, legitimate one.
 *
 * `reset()` alone is not enough here: it re-renders the same tree, which asks for
 * the same missing chunk again. Only a document reload fetches the new build's
 * HTML and its new chunk names.
 *
 * Shared by every `error.tsx` in the tree — the guest site and both dashboards —
 * because a stale tab is not a guest-only situation, and an owner leaves the
 * dashboard open for days. One implementation means the cooldown cannot drift
 * apart between them.
 */

/** Matches what every browser and bundler calls a failed lazy import. */
const CHUNK_ERROR =
  /ChunkLoadError|Loading chunk [\w-]+ failed|Failed to fetch dynamically imported module|error loading dynamically imported module|Importing a module script failed/i;

const RELOAD_KEY = "desert-chalets:chunk-reloaded-at";

/** How long one automatic reload suppresses the next. */
const RELOAD_COOLDOWN_MS = 10_000;

/**
 * Reload once if `error` looks like a stale build.
 *
 * @returns whether a reload is in flight — render "updating…" rather than an
 *   error message while it is, since nothing is actually wrong.
 */
export function useStaleBuildReload(error: Error): boolean {
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
    window.location.reload();
  }, [error]);

  return reloading;
}
