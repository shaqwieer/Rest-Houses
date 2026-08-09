import Link from "next/link";
import { AvailabilityEditor } from "@/components/admin/availability-editor";
import { CalendarSyncPanel } from "@/components/admin/calendar-sync-panel";
import { Icon } from "@/components/ui/icon";
import { loadCalendarBoard } from "@/lib/calendar/board";
import { listingsForCalendar } from "@/lib/listing-access";
import { getI18n } from "@/lib/i18n/server";
import { requireAdminPage } from "@/lib/auth";

/** Availability editor. `?listing=<id>` selects which calendar is shown. */
export default async function AdminCalendarPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireAdminPage();

  const [sp, { t }] = await Promise.all([searchParams, getI18n()]);

  // No owner scope: an operator's calendar covers every listing.
  const listings = await listingsForCalendar();

  if (listings.length === 0) {
    return (
      <div className="rounded-[20px] border border-dashed border-sand-300 bg-surface p-8 text-center">
        <Icon name="calendar_month" size={46} className="mx-auto text-sand-400" />
        <h1 className="mt-3.5 mb-2 font-display text-[17px] font-bold text-ink">
          {t.admin.noListingsForCalendar}
        </h1>
        <p className="m-0 mb-4 text-[13.5px] text-muted">{t.admin.addListingFirstShort}</p>
        <Link
          href="/admin/listings/new"
          className="inline-flex items-center gap-2 rounded-full bg-night-900 px-5 py-3 text-[14px] font-bold text-sand-50 no-underline hover:no-underline"
        >
          <Icon name="add" size={18} />
          {t.admin.quickAddListing}
        </Link>
      </div>
    );
  }

  const requested = typeof sp.listing === "string" ? sp.listing : null;
  // Fall back to the first listing if the id in the URL is stale or missing.
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
        basePath="/admin/calendar"
      />
      <CalendarSyncPanel
        scope="admin"
        listingId={selectedId}
        feeds={board.feeds}
        exportUrl={board.exportUrl}
      />
    </>
  );
}
