import { getActiveOwnerSession } from "@/lib/auth";
import { getI18n } from "@/lib/i18n/server";
import { getAnalytics, resolvePeriod } from "@/lib/analytics";
import { analyticsWorkbook, analyticsFilename, workbookResponse } from "@/lib/analytics-export";
import { localized } from "@/lib/i18n/config";
import { prisma } from "@/lib/prisma";

/**
 * The owner's dashboard, as a spreadsheet.
 *
 * ─── This route authorises itself ────────────────────────────────────────────
 * A route handler is NOT wrapped by the /owner layout, so the gate that keeps a
 * pending or suspended owner out of the dashboard does not run here. It has to
 * check for itself, and it does — `getActiveOwnerSession()` re-reads status and
 * membership from the database on every call, exactly as the layout does.
 *
 * The `?listing=` parameter is then ANDed with that owner's id inside
 * `getAnalytics`, so pointing it at somebody else's rest house returns a file
 * full of zeroes rather than their revenue. A query string is the easiest thing
 * in the world to edit, and this is the endpoint that hands back a file.
 */
export async function GET(request: Request) {
  const session = await getActiveOwnerSession();
  if (!session) {
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

  const data = await getAnalytics(
    { ownerId: session.owner.id, listingId },
    period,
  );

  // Read through the same owner scope as the figures, so a listing id belonging
  // to somebody else names nothing rather than leaking the rest house's name in
  // the header row of an otherwise empty file.
  const scoped = listingId
    ? await prisma.listing.findFirst({
        where: { id: listingId, ownerId: session.owner.id },
        select: { name: true, nameEn: true },
      })
    : null;

  const scopeLabel = scoped
    ? localized(scoped.name, scoped.nameEn, locale)
    : t.analytics.allListings;

  return workbookResponse(analyticsWorkbook(data, t, locale, scopeLabel), analyticsFilename(data));
}
