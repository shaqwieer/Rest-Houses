import Link from "next/link";
import { Icon } from "@/components/ui/icon";
import { RecordBookingForm } from "@/components/admin/record-booking-form";
import { prisma } from "@/lib/prisma";
import { requireAdminPage } from "@/lib/auth";
import { getI18n } from "@/lib/i18n/server";

/**
 * "Record an outside booking" — the operator's copy.
 *
 * The same form component the owner uses, on a different route, with every rest
 * house on the platform in the dropdown instead of one owner's. Written once
 * for the same reason the analytics panels are: two forms built to agree would
 * drift, and this one decides what a booking is worth.
 */
export default async function AdminRecordBookingPage() {
  await requireAdminPage();
  const { t } = await getI18n();

  const listings = await prisma.listing.findMany({
    select: { id: true, name: true, nameEn: true },
    orderBy: { name: "asc" },
    take: 500,
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
          href="/admin/requests"
          className="inline-flex items-center gap-1.5 rounded-full border border-line bg-surface px-3.5 py-2 text-[12.5px] font-bold text-ink no-underline transition hover:border-gold-500 hover:no-underline"
        >
          <Icon name="inbox" size={16} className="text-bronze" />
          {t.recordBooking.backToBookings}
        </Link>
      </div>

      <RecordBookingForm listings={listings} backHref="/admin/requests" />
    </div>
  );
}
