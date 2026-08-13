import Link from "next/link";
import { Icon } from "@/components/ui/icon";
import { RecordBookingForm } from "@/components/admin/record-booking-form";
import { prisma } from "@/lib/prisma";
import { getActiveOwnerSession } from "@/lib/auth";
import { getI18n } from "@/lib/i18n/server";

/**
 * "Record an outside booking" — the owner's copy.
 *
 * The rest houses offered are read with `ownerId` in the WHERE clause, so the
 * dropdown can only ever contain this owner's own. That is a convenience, not
 * the security boundary: `recordBooking` calls `authorizeListing`, which scopes
 * the lookup the same way, so a posted id belonging to somebody else answers
 * "not found" whatever this page rendered.
 */
export default async function OwnerRecordBookingPage() {
  // null while the owner is pending/rejected/suspended/expired — the layout is
  // rendering the status panel and discards this page's output.
  const session = await getActiveOwnerSession();
  if (!session) return null;

  const { t } = await getI18n();

  const listings = await prisma.listing.findMany({
    where: { ownerId: session.owner.id },
    select: { id: true, name: true, nameEn: true },
    orderBy: { createdAt: "asc" },
  });

  return (
    <div className="animate-fade-up flex flex-col gap-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="m-0 mb-1 font-display text-[20px] font-extrabold text-ink">
            {t.recordBooking.title}
          </h1>
        </div>
        <Link
          href="/owner/bookings"
          className="inline-flex items-center gap-1.5 rounded-full border border-line bg-surface px-3.5 py-2 text-[12.5px] font-bold text-ink no-underline transition hover:border-gold-500 hover:no-underline"
        >
          <Icon name="inbox" size={16} className="text-bronze" />
          {t.recordBooking.backToBookings}
        </Link>
      </div>

      <RecordBookingForm listings={listings} backHref="/owner/bookings" />
    </div>
  );
}
