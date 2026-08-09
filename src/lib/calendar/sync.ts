/**
 * Importing external calendars into `Availability`.
 *
 * One feed at a time: fetch it, parse it, and make this platform's imported
 * days for that feed match what it now says. The rows written carry
 * `sourceKey = <feed id>` and `status = "EXTERNAL"`, so they are visible to
 * every existence-based availability check the moment they land, and invisible
 * to every path that edits the calendar on a human's behalf. See the note on
 * `Availability` in prisma/schema.prisma.
 *
 * ─── The rule that matters most ─────────────────────────────────────────────
 * Reconciliation DELETES this feed's previously imported days before inserting
 * the current ones. That is only safe when the feed actually spoke. If Airbnb
 * times out, answers 500, or serves an HTML error page with a 200, the correct
 * action is to change nothing and leave last week's imported blocks exactly
 * where they are — a stale block costs one missed enquiry, while wrongly
 * clearing one sells a night that is already sold.
 *
 * `parseICal` returns null for anything without a complete VCALENDAR envelope,
 * and this module treats null as "did not speak". A *valid* calendar with zero
 * events is the opposite case — it means every booking there was cancelled —
 * and it does reconcile, clearing that feed's days and no other's.
 */

import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { todayISO, type ISODate } from "@/lib/dates";
import { fetchCalendar, type FetchFailure } from "./fetch";
import { daysOfCalendar, parseICal } from "./ical";

/**
 * Why a sync did not complete.
 *
 * `WRITE_FAILED` is the database's own refusal — a deadlock, a lost connection,
 * or a unique violation from two runs reaching the same feed at once. Distinct
 * from the fetch codes because the remedy is completely different: nothing is
 * wrong with the owner's URL and there is nothing for them to fix.
 */
export type SyncFailure = FetchFailure | "WRITE_FAILED";

/** What one feed's sync did, for the UI and for the cron route's summary. */
export type FeedSyncResult = {
  feedId: string;
  listingId: string;
  platform: string;
  ok: boolean;
  /** Days now imported from this feed. 0 on failure — nothing was changed. */
  days: number;
  events: number;
  /** Present when `ok` is false. A code; the UI translates it. */
  failure?: SyncFailure;
};

/**
 * How stale a feed may be before the scheduled run picks it up.
 *
 * The cron fires every 15 minutes (see DEPLOYMENT.md). This threshold sits just
 * under that so a run is never skipped by a few seconds of jitter, and so a
 * feed added between runs is picked up by the next one rather than waiting two.
 *
 * There is no point going faster. Airbnb regenerates its own .ics roughly every
 * 3 hours, so polling every minute would fetch the same bytes 180 times and
 * learn nothing; the refresh interval on their side, not ours, is what bounds
 * how quickly a booking there closes a night here.
 */
export const SYNC_INTERVAL_MINUTES = 14;

type FeedRow = {
  id: string;
  listingId: string;
  platform: string;
  url: string;
  kind: string;
};

/**
 * Sync one feed.
 *
 * Never throws: a scheduled run walks every feed on the platform, and one
 * owner's expired token must not abort the other fifty.
 */
export async function syncFeed(feed: FeedRow): Promise<FeedSyncResult> {
  const base = {
    feedId: feed.id,
    listingId: feed.listingId,
    platform: feed.platform,
  };

  // The discriminator that keeps a future channel-manager source from needing a
  // second table. Today there is one transport.
  if (feed.kind !== "ICAL") {
    await recordFailure(feed.id, "NOT_CALENDAR");
    return { ...base, ok: false, days: 0, events: 0, failure: "NOT_CALENDAR" };
  }

  const fetched = await fetchCalendar(feed.url);
  if (!fetched.ok) {
    await recordFailure(feed.id, fetched.failure);
    return { ...base, ok: false, days: 0, events: 0, failure: fetched.failure };
  }

  const calendar = parseICal(fetched.body);
  if (!calendar) {
    // Reached the server, got 200, and it was not a calendar. Previously
    // imported days stay exactly as they are — see the note at the top.
    await recordFailure(feed.id, "NOT_CALENDAR");
    return { ...base, ok: false, days: 0, events: 0, failure: "NOT_CALENDAR" };
  }

  const days = daysOfCalendar(calendar, todayISO());

  // The database can refuse this — a deadlock, a dropped connection, or a
  // unique violation if two runs reach the same feed at once (the staleness
  // filter narrows that window but does not close it: the SELECT and the
  // UPDATE of `lastSyncedAt` are not one atomic step).
  //
  // Caught rather than thrown, because the promise this returns is one of four
  // handed to `Promise.all` in `syncDueFeeds`. A rejection there discards the
  // three siblings' results and fails the whole cron run, so one owner's
  // unlucky moment would stop everyone else's calendar syncing — exactly the
  // blast radius the per-feed error handling exists to prevent. The transaction
  // in `reconcile` means a failure here changed nothing.
  try {
    await reconcile(feed, days, calendar.events.length);
  } catch {
    await recordFailure(feed.id, "WRITE_FAILED");
    return { ...base, ok: false, days: 0, events: calendar.events.length, failure: "WRITE_FAILED" };
  }

  return {
    ...base,
    ok: true,
    days: days.size,
    events: calendar.events.length,
  };
}

/**
 * Make this feed's imported rows equal `days`.
 *
 * Delete-then-insert rather than a diff. The set is small (a busy listing holds
 * a few hundred days a year), the write happens once every fifteen minutes, and
 * a diff would have to reason about a day that moved between two events in the
 * same feed — which is a source of exactly the off-by-one this table cannot
 * afford. Replacing the feed's own rows wholesale has one outcome and no edge
 * cases.
 *
 * ─── Scoped two ways, both deliberate ───────────────────────────────────────
 * `sourceKey: feed.id` — so syncing Airbnb never touches the days Booking.com
 * imported, nor the owner's manual blocks, nor a confirmed booking's nights.
 * That is the guarantee the three-column unique key exists to provide.
 *
 * `date >= today` — the past is left alone. Yesterday's imported block cannot
 * affect a bookable night, and re-deriving history on every run would churn
 * rows for no reader. It also means a feed that stops advertising last month's
 * bookings does not quietly rewrite what the calendar showed at the time.
 *
 * In one transaction, matching how `actions/requests.ts` closes a calendar: a
 * delete that commits without its insert is a listing that just went from
 * "fully booked on Airbnb" to "available", which is the worst state this
 * feature can produce.
 */
async function reconcile(feed: FeedRow, days: Set<ISODate>, eventCount: number): Promise<void> {
  const today = todayISO();
  const sorted = [...days].sort();

  await prisma.$transaction([
    prisma.availability.deleteMany({
      where: { listingId: feed.listingId, sourceKey: feed.id, date: { gte: today } },
    }),
    prisma.availability.createMany({
      data: sorted.map((date) => ({
        listingId: feed.listingId,
        date,
        status: "EXTERNAL",
        sourceKey: feed.id,
        feedId: feed.id,
      })),
    }),
    prisma.calendarFeed.update({
      where: { id: feed.id },
      data: {
        lastSyncedAt: new Date(),
        lastOkAt: new Date(),
        lastError: null,
        lastEventCount: eventCount,
        lastDayCount: sorted.length,
      },
    }),
  ]);
}

/**
 * Record that an attempt failed, touching nothing else.
 *
 * `lastSyncedAt` moves and `lastOkAt` does not, which is what lets the owner's
 * panel say "last successful sync was Tuesday" instead of showing a feed that
 * has been broken for a week as freshly synced.
 *
 * The stored value is a code, never the underlying error text: that text can
 * contain the feed URL, which is a credential for the owner's account on the
 * other platform. See `FetchFailure`.
 */
async function recordFailure(feedId: string, failure: string): Promise<void> {
  await prisma.calendarFeed
    .update({
      where: { id: feedId },
      data: { lastSyncedAt: new Date(), lastError: failure },
    })
    // The feed may have been deleted while its fetch was in flight; that is not
    // an error worth failing a scheduled run over.
    .catch(() => undefined);
}

const FEED_SELECT = {
  id: true,
  listingId: true,
  platform: true,
  url: true,
  kind: true,
} satisfies Prisma.CalendarFeedSelect;

/**
 * Sync every active feed on one listing — what "Sync now" runs.
 *
 * Sequential, not `Promise.all`: a listing has at most a handful of feeds, and
 * serialising them keeps one owner's manual press from opening a dozen outbound
 * sockets at once.
 */
export async function syncListing(listingId: string): Promise<FeedSyncResult[]> {
  const feeds = await prisma.calendarFeed.findMany({
    where: { listingId, active: true },
    select: FEED_SELECT,
    orderBy: { createdAt: "asc" },
  });

  const results: FeedSyncResult[] = [];
  for (const feed of feeds) results.push(await syncFeed(feed));
  return results;
}

/**
 * Every active feed that has not been tried recently — what the cron runs.
 *
 * The staleness filter is what makes the schedule safe to run often and safe to
 * retry: a run that overlaps the previous one, or a second cron someone adds by
 * accident, re-fetches nothing.
 *
 * Batched in small groups rather than one at a time or all at once. All at once
 * would open one socket per feed on the platform; one at a time makes a full
 * pass take as long as the sum of every slow feed's timeout, and with a 10s
 * timeout and a hundred feeds that exceeds the interval it runs on.
 */
export async function syncDueFeeds(limit = 200): Promise<FeedSyncResult[]> {
  const staleBefore = new Date(Date.now() - SYNC_INTERVAL_MINUTES * 60_000);

  const feeds = await prisma.calendarFeed.findMany({
    where: {
      active: true,
      OR: [{ lastSyncedAt: null }, { lastSyncedAt: { lt: staleBefore } }],
    },
    select: FEED_SELECT,
    // Never-synced first, then the longest-waiting. A newly added feed is the
    // one an owner is watching.
    orderBy: [{ lastSyncedAt: { sort: "asc", nulls: "first" } }, { createdAt: "asc" }],
    take: limit,
  });

  const results: FeedSyncResult[] = [];
  const CONCURRENCY = 4;

  for (let i = 0; i < feeds.length; i += CONCURRENCY) {
    const batch = feeds.slice(i, i + CONCURRENCY);
    results.push(...(await Promise.all(batch.map(syncFeed))));
  }

  return results;
}
