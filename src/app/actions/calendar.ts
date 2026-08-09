"use server";

import { randomBytes } from "node:crypto";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { authorizeListing } from "@/lib/listing-access";
import { auditData } from "@/lib/audit";
import { isCalendarPlatform, CALENDAR_PLATFORM_NAMES } from "@/lib/constants";
import { validateFeedUrl } from "@/lib/calendar/fetch";
import { syncFeed, syncListing } from "@/lib/calendar/sync";
import { getI18n } from "@/lib/i18n/server";
import type { ActionResult } from "./listings";

/**
 * External calendar feeds — the owner-facing actions.
 *
 * Two entry points per operation, one implementation, exactly as in
 * actions/listings.ts: the admin form works on any listing, the owner form is
 * scoped to their own rows by putting `ownerId` in the WHERE clause rather than
 * checking after the read. An owner asking about someone else's listing gets
 * "not found", which is both the right authorisation answer and the one that
 * does not confirm the other listing exists.
 *
 * ─── The feed URL is a credential ───────────────────────────────────────────
 * An Airbnb or Booking.com iCal export URL contains a token that grants read
 * access to that listing's calendar on the other platform. So it is:
 *   * never written to AuditLog (the platform id is; the URL is not)
 *   * never returned to the client — `listCalendarFeeds` sends a masked hint
 *   * never quoted in an error message, which is why `fetchCalendar` answers
 *     with codes instead of exception text
 */

/** Every surface that shows availability for this listing. */
function revalidateCalendarViews(slug: string): void {
  revalidatePath(`/listings/${slug}`);
  revalidatePath("/listings");
  revalidatePath("/admin/calendar");
  revalidatePath("/admin");
  revalidatePath("/owner");
  revalidatePath("/owner/calendar");
  revalidatePath("/owner/listings");
}

/* -------------------------------------------------------------------------- */
/* Feeds                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Add a feed, then sync it immediately.
 *
 * The sync is part of the action rather than left to the next cron run because
 * pasting a URL and being told nothing for fifteen minutes is indistinguishable
 * from pasting a wrong one. Syncing now turns a typo into an error message
 * while the owner is still looking at the field — and if it succeeds, the days
 * appear in the calendar on the same page load.
 */
export async function addCalendarFeed(
  listingId: string,
  platformRaw: string,
  urlRaw: string,
  labelRaw: string,
): Promise<ActionResult> {
  const { t } = await getI18n();

  const auth = await authorizeListing(listingId, t);
  if (!auth.ok) return { ok: false, error: auth.error };

  if (!isCalendarPlatform(platformRaw)) {
    return { ok: false, error: t.validation.invalidPlatform };
  }

  // Validated before storage, not only before fetching: an unusable URL should
  // never become a row that fails forever in the background.
  const validated = validateFeedUrl(urlRaw);
  if (!validated.ok) {
    return { ok: false, error: t.calendar.fetchError(validated.failure) };
  }
  const url = validated.url.toString();

  const existing = await prisma.calendarFeed.findFirst({
    where: { listingId, url },
    select: { id: true },
  });
  if (existing) return { ok: false, error: t.validation.feedAlreadyAdded };

  // A small cap. Nothing legitimate needs more, and each one is an outbound
  // request every fifteen minutes.
  const count = await prisma.calendarFeed.count({ where: { listingId } });
  if (count >= 10) return { ok: false, error: t.validation.tooManyFeeds };

  const label = labelRaw.trim().slice(0, 60);

  const feed = await prisma.calendarFeed.create({
    data: { listingId, platform: platformRaw, url, label, kind: "ICAL" },
    select: { id: true, listingId: true, platform: true, url: true, kind: true },
  });

  await prisma.auditLog.create({
    data: auditData({
      actor: auth.actor,
      action: "CALENDAR_FEED_ADDED",
      entityType: "Listing",
      entityId: listingId,
      summary: `${CALENDAR_PLATFORM_NAMES[platformRaw] || label} — ${auth.listing.name}`,
      // The platform and the listing, never the URL. See the note at the top.
      metadata: { platform: platformRaw },
    }),
  });

  const result = await syncFeed(feed);

  revalidateCalendarViews(auth.listing.slug);

  if (!result.ok) {
    // The feed is kept. It is saved, visible, and showing its error — which is
    // more useful than discarding a URL the owner just fetched from another
    // site, and lets a transient outage resolve itself on the next run.
    return { ok: true, message: t.calendar.addedButFailed(t.calendar.fetchError(result.failure!)) };
  }

  return { ok: true, message: t.calendar.addedAndSynced(String(result.days)) };
}

/**
 * Remove a feed, and with it every day it imported.
 *
 * The days go through the `onDelete: Cascade` on `Availability.feedId` — no
 * second delete here, so there is no way for the two to disagree. Owner blocks
 * and confirmed bookings on the same days are untouched: they are separate rows
 * with `sourceKey = "LOCAL"`.
 */
export async function removeCalendarFeed(
  listingId: string,
  feedId: string,
): Promise<ActionResult> {
  const { t } = await getI18n();

  const auth = await authorizeListing(listingId, t);
  if (!auth.ok) return { ok: false, error: auth.error };

  // `listingId` in the WHERE clause as well as the id: without it, an owner who
  // may edit listing A could delete a feed belonging to listing B by id.
  const feed = await prisma.calendarFeed.findFirst({
    where: { id: feedId, listingId },
    select: { id: true, platform: true },
  });
  if (!feed) return { ok: false, error: t.validation.feedNotFound };

  await prisma.$transaction([
    prisma.calendarFeed.delete({ where: { id: feed.id } }),
    prisma.auditLog.create({
      data: auditData({
        actor: auth.actor,
        action: "CALENDAR_FEED_REMOVED",
        entityType: "Listing",
        entityId: listingId,
        summary: `${CALENDAR_PLATFORM_NAMES[feed.platform as never] || feed.platform} — ${auth.listing.name}`,
        metadata: { platform: feed.platform },
      }),
    }),
  ]);

  revalidateCalendarViews(auth.listing.slug);
  return { ok: true, message: t.calendar.feedRemoved };
}

/** "Sync now" — every active feed on this listing, on demand. */
export async function syncCalendarNow(listingId: string): Promise<ActionResult> {
  const { t } = await getI18n();

  const auth = await authorizeListing(listingId, t);
  if (!auth.ok) return { ok: false, error: auth.error };

  const results = await syncListing(listingId);
  revalidateCalendarViews(auth.listing.slug);

  if (results.length === 0) return { ok: false, error: t.calendar.noFeedsToSync };

  const failed = results.filter((r) => !r.ok);
  const days = results.reduce((sum, r) => sum + r.days, 0);

  if (failed.length === results.length) {
    return { ok: false, error: t.calendar.fetchError(failed[0].failure!) };
  }
  if (failed.length > 0) {
    return { ok: true, message: t.calendar.syncedWithErrors(String(days), String(failed.length)) };
  }

  return { ok: true, message: t.calendar.syncedAll(String(days)) };
}

/* -------------------------------------------------------------------------- */
/* Export token                                                               */
/* -------------------------------------------------------------------------- */

/**
 * Mint (or re-mint) the token in this listing's public .ics URL.
 *
 * 32 bytes from `crypto.randomBytes`, matching `ReviewInvite` — the token is
 * the entire authentication on an endpoint no one signs in to, so it must not
 * be a cuid and must not be derived from the listing id or slug, both of which
 * are public.
 *
 * Re-minting is how a leaked URL is revoked: the old one 404s immediately.
 * It also breaks whatever was importing it, which is why the UI asks first.
 */
export async function enableCalendarExport(listingId: string): Promise<ActionResult> {
  const { t } = await getI18n();

  const auth = await authorizeListing(listingId, t);
  if (!auth.ok) return { ok: false, error: auth.error };

  const token = randomBytes(32).toString("hex");

  await prisma.$transaction([
    prisma.listing.update({ where: { id: listingId }, data: { calendarToken: token } }),
    prisma.auditLog.create({
      data: auditData({
        actor: auth.actor,
        action: "CALENDAR_EXPORT_ENABLED",
        entityType: "Listing",
        entityId: listingId,
        summary: auth.listing.name,
        // Never the token: the audit log is readable by every operator, and the
        // token is the only thing protecting the feed.
        metadata: {},
      }),
    }),
  ]);

  revalidateCalendarViews(auth.listing.slug);
  return { ok: true, message: t.calendar.exportEnabled };
}

/** Turn the public feed off entirely. The URL stops resolving. */
export async function disableCalendarExport(listingId: string): Promise<ActionResult> {
  const { t } = await getI18n();

  const auth = await authorizeListing(listingId, t);
  if (!auth.ok) return { ok: false, error: auth.error };

  await prisma.$transaction([
    prisma.listing.update({ where: { id: listingId }, data: { calendarToken: null } }),
    prisma.auditLog.create({
      data: auditData({
        actor: auth.actor,
        action: "CALENDAR_EXPORT_DISABLED",
        entityType: "Listing",
        entityId: listingId,
        summary: auth.listing.name,
        metadata: {},
      }),
    }),
  ]);

  revalidateCalendarViews(auth.listing.slug);
  return { ok: true, message: t.calendar.exportDisabled };
}
