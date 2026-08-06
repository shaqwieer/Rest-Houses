"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Icon } from "@/components/ui/icon";
import { useLocale } from "@/lib/i18n/provider";
import { useStaleBuildReload } from "@/lib/stale-build";

/**
 * Catch-all error boundary — the dashboards' safety net.
 *
 * ─── Why this sits at the app root and not under /owner and /admin ───────────
 * Only `src/app/(site)/error.tsx` existed, so a failure anywhere in the owner or
 * admin dashboard fell through to Next's built-in boundary, whose entire output
 * is «Application error: a server-side exception has occurred… Digest: …» on a
 * blank page. That is the screen a new owner was shown when a photo upload died
 * (the truncated-body bug fixed in next.config.ts alongside this file): no
 * explanation, no way back, and no clue that their work was not saved.
 *
 * A boundary is placed *here* rather than as `owner/error.tsx` + `admin/error.tsx`
 * because `error.tsx` cannot catch a throw from the layout it lives beside — and
 * both dashboard layouts query the database on every request, which is exactly
 * where a failure is likely. One boundary in the parent segment covers the pages,
 * both layouts and /login, and there is one copy of the markup instead of two.
 *
 * The nested `(site)` boundary still wins for guest pages: it keeps the site
 * chrome and a link into the catalogue, which is the right offer for a visitor
 * and the wrong one for a signed-in owner.
 */

export default function DashboardError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const { t } = useLocale();
  const pathname = usePathname();
  const reloading = useStaleBuildReload(error);

  // Send the operator back to their own dashboard rather than to the public
  // home page. Read off the URL because a boundary this high in the tree serves
  // owners, admins and the login page, and it has no session to ask.
  const home = pathname?.startsWith("/owner")
    ? { href: "/owner", label: t.owner.goToDashboard }
    : pathname?.startsWith("/admin")
      ? { href: "/admin", label: t.admin.dashboard }
      : { href: "/", label: t.notFound.home };

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
            <p className="m-0 mb-7 text-[15px] leading-[1.9] text-muted">
              {t.error.dashboardBody}
            </p>

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
                href={home.href}
                className="inline-flex items-center gap-2 rounded-full border border-line bg-surface px-6 py-3.5 text-[15px] font-bold text-ink no-underline hover:border-gold-500 hover:no-underline"
              >
                {home.label}
              </Link>
            </div>

            {/* The one piece of machine-readable evidence the owner can pass on.
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
