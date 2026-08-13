import { requireAdmin } from "@/lib/auth";
import { getI18n } from "@/lib/i18n/server";
import { getAnalytics, resolvePeriod } from "@/lib/analytics";
import { analyticsWorkbook, analyticsFilename, workbookResponse } from "@/lib/analytics-export";
import { localized } from "@/lib/i18n/config";
import { prisma } from "@/lib/prisma";

/**
 * The operator's copy of the export.
 *
 * `requireAdmin()` rather than `requireAdminPage()`: the page helper redirects
 * to the login screen, which is right for a page and wrong for a download —
 * the browser would save the sign-in HTML as a .csv. This one answers 401 and
 * lets the caller see what happened.
 *
 * Like every route handler, it authorises itself: the /admin layout does not
 * wrap this file, and `requireAdmin` re-reads the role from the database rather
 * than trusting a 30-day JWT that was minted before a demotion.
 */
export async function GET(request: Request) {
  const admin = await requireAdmin().catch(() => null);
  if (!admin) {
    return new Response("Unauthorized", { status: 401 });
  }

  const { t, locale } = await getI18n();
  const params = new URL(request.url).searchParams;

  const period = resolvePeriod({
    period: params.get("period") ?? undefined,
    from: params.get("from") ?? undefined,
    to: params.get("to") ?? undefined,
  });
  const listingId = params.get("listing") || undefined;

  const data = await getAnalytics({ listingId }, period);

  const scoped = listingId
    ? await prisma.listing.findUnique({
        where: { id: listingId },
        select: { name: true, nameEn: true },
      })
    : null;

  const scopeLabel = scoped
    ? localized(scoped.name, scoped.nameEn, locale)
    : t.analytics.allListings;

  return workbookResponse(analyticsWorkbook(data, t, locale, scopeLabel), analyticsFilename(data));
}
