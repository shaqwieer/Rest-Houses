import Link from "next/link";
import { AvailabilityEditor } from "@/components/admin/availability-editor";
import { Icon } from "@/components/ui/icon";
import { prisma } from "@/lib/prisma";
import { todayISO } from "@/lib/dates";
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

  // `weekendMode` comes along so the editor shades the same days this listing
  // charges the weekend rate for — an admin looking at a Sharjah calendar sees
  // Friday marked as the weekend night it is priced as.
  const listings = await prisma.listing.findMany({
    select: { id: true, name: true, weekendMode: true },
    orderBy: { createdAt: "asc" },
  });

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

  // Only load from today forward — past days aren't editable, so shipping years
  // of history to the client would be dead weight.
  const rows = await prisma.availability.findMany({
    where: { listingId: selectedId, date: { gte: todayISO() } },
    select: { date: true, status: true },
    orderBy: { date: "asc" },
  });

  return (
    <AvailabilityEditor
      listings={listings}
      selectedId={selectedId}
      entries={rows.map((r) => ({
        date: r.date,
        status: r.status === "BOOKED" ? "BOOKED" : "BLOCKED",
      }))}
    />
  );
}
