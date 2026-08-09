import { prisma } from "@/lib/prisma";
import { buildListingCalendar, icalTimestamp } from "@/lib/calendar/export";

/**
 * The public .ics feed for one listing — `/api/calendar/<token>.ics`.
 *
 * Fetched by Airbnb and Booking.com, not by a person, so there is nobody to
 * sign in and the token in the path is the entire authentication. The same
 * arrangement as ReviewInvite, and the same three properties make it safe:
 *
 *   * 32 random bytes from `crypto.randomBytes` (minted in actions/calendar.ts),
 *     never derived from the listing id or slug — both of which are public, and
 *     either of which would make every listing's calendar readable by anyone
 *     who can open a listing page.
 *   * opt-in: `Listing.calendarToken` is null until an owner turns export on,
 *     so a listing nobody enabled has no feed rather than an unshared one.
 *   * revocable: regenerating the token 404s the old URL.
 *
 * The body carries no guest details at all — see the note in lib/calendar/export.
 *
 * ─── `.ics` in the path ─────────────────────────────────────────────────────
 * Some importers will not accept a URL that does not end in .ics, and some
 * validate the extension before ever reading Content-Type. The suffix is
 * therefore part of the published URL and stripped here, so both
 * `/api/calendar/<token>` and `/api/calendar/<token>.ics` resolve.
 */

export const runtime = "nodejs";
// A booking confirmed a minute ago has to appear in the next fetch. Caching a
// calendar feed is how a platform keeps selling a night that was just taken.
export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token: raw } = await params;
  const token = raw.endsWith(".ics") ? raw.slice(0, -4) : raw;

  // Cheap shape check before touching the database, so a scan for guessable
  // tokens costs no queries. `crypto.randomBytes(32).toString("hex")` is always
  // 64 lowercase hex characters.
  if (!/^[0-9a-f]{64}$/.test(token)) return notFound();

  const listing = await prisma.listing.findUnique({
    where: { calendarToken: token },
    select: { id: true, name: true },
  });
  if (!listing) return notFound();

  const body = await buildListingCalendar({
    listingId: listing.id,
    listingName: listing.name,
    dtstamp: icalTimestamp(new Date()),
  });

  return new Response(body, {
    status: 200,
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      // Prompts a filename if a human opens it, and satisfies importers that
      // sniff the disposition rather than the URL.
      "Content-Disposition": 'inline; filename="calendar.ics"',
      "Cache-Control": "no-store, max-age=0",
      // The token is in the URL; keep it out of any Referer this response leads
      // to, and out of search results.
      "Referrer-Policy": "no-referrer",
      "X-Robots-Tag": "noindex, nofollow",
    },
  });
}

/**
 * The same answer for a malformed token, an unknown one and a revoked one.
 *
 * Plain text rather than the site's 404 page: the caller is a crawler, and
 * distinguishing "no such listing" from "export disabled" would confirm which
 * tokens exist.
 */
function notFound(): Response {
  return new Response("Not found", {
    status: 404,
    headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" },
  });
}
