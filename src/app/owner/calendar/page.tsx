import Link from "next/link";
import { AvailabilityEditor } from "@/components/admin/availability-editor";
import { CalendarSyncPanel } from "@/components/admin/calendar-sync-panel";
import { Icon } from "@/components/ui/icon";
import { loadCalendarBoard } from "@/lib/calendar/board";
import { listingsForCalendar } from "@/lib/listing-access";
import { getActiveOwnerSession } from "@/lib/auth";
import { getI18n } from "@/lib/i18n/server";

/**
 * The owner's own calendar — the same editor the operator uses, scoped to the
 * rest houses this owner actually has.
 *
 * ─── The scoping, and why it is in two places ───────────────────────────────
 * `listingsForCalendar(owner.id)` puts `ownerId` in the WHERE clause, so the
 * `<select>` can only offer this owner's listings, and `selectedId` is then
 * checked against that list — an id typed into `?listing=` that belongs to
 * somebody else simply falls back to the owner's first listing.
 *
 * That is the *navigation* guard, and it is not the enforcement. Every action
 * the editor fires re-authorises independently through `authorizeListing()`,
 * which applies the same `ownerId` scope server-side. Server actions are
 * reachable by anyone who can guess their id, so a page-level filter protects
 * nothing on its own — see the note at the top of src/app/actions/listings.ts.
 */
export default async function OwnerCalendarPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  // null while the owner is pending/rejected/suspended/expired — the layout is
  // rendering the status panel and discards this page's output.
  const session = await getActiveOwnerSession();
  if (!session) return null;
  const { owner } = session;

  const [sp, { t }] = await Promise.all([searchParams, getI18n()]);
  const listings = await listingsForCalendar(owner.id);

  if (listings.length === 0) {
    return (
      <div className="rounded-[20px] border border-dashed border-sand-300 bg-surface p-8 text-center">
        <Icon name="calendar_month" size={46} className="mx-auto text-sand-400" />
        <h1 className="mt-3.5 mb-2 font-display text-[17px] font-bold text-ink">
          {t.admin.noListingsForCalendar}
        </h1>
        <p className="m-0 mb-4 text-[13.5px] text-muted">{t.admin.addListingFirstShort}</p>
        <Link
          href="/owner/listings/new"
          className="inline-flex items-center gap-2 rounded-full bg-night-900 px-5 py-3 text-[14px] font-bold text-sand-50 no-underline hover:no-underline"
        >
          <Icon name="add" size={18} />
          {t.owner.addListing}
        </Link>
      </div>
    );
  }

  const requested = typeof sp.listing === "string" ? sp.listing : null;
  const selectedId =
    requested && listings.some((l) => l.id === requested) ? requested : listings[0].id;

  const board = await loadCalendarBoard(selectedId);

  return (
    <>
      <AvailabilityEditor
        listings={listings}
        selectedId={selectedId}
        entries={board.entries}
        specialDays={board.specialDays}
        basePath="/owner/calendar"
      />
      <CalendarSyncPanel
        scope="owner"
        listingId={selectedId}
        feeds={board.feeds}
        exportUrl={board.exportUrl}
      />
    </>
  );
}
