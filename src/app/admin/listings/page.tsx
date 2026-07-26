import Link from "next/link";
import { Icon } from "@/components/ui/icon";
import { AdminListingRow } from "@/components/admin/listing-row";
import { getAllListingsForAdmin } from "@/lib/listings";
import { cityLabel } from "@/lib/constants";
import { arNum } from "@/lib/format";

/** Listings management. Cards rather than a table — a table can't be read on a
 *  phone, and this dashboard is phone-first. */
export default async function AdminListingsPage() {
  const listings = await getAllListingsForAdmin();

  return (
    <div className="animate-fade-up">
      <div className="mb-4 flex items-center justify-between gap-3">
        <div>
          <h1 className="m-0 font-display text-[20px] font-extrabold text-ink">استراحاتي</h1>
          <p className="m-0 text-[12.5px] text-muted">{arNum(listings.length)} استراحة</p>
        </div>
        <Link
          href="/admin/listings/new"
          className="flex shrink-0 items-center gap-2 rounded-full bg-linear-[140deg,var(--gold-500),var(--gold-600)] px-4 py-3 text-[13.5px] font-extrabold text-night-900 no-underline shadow-gold hover:no-underline"
        >
          <Icon name="add" size={19} />
          إضافة
        </Link>
      </div>

      {listings.length === 0 ? (
        <div className="rounded-[20px] border border-dashed border-sand-300 bg-surface p-8 text-center">
          <Icon name="holiday_village" size={46} className="mx-auto text-sand-400" />
          <h2 className="mt-3.5 mb-2 font-display text-[17px] font-bold text-ink">
            لم تُضف أي استراحة بعد
          </h2>
          <p className="m-0 text-[13.5px] text-muted">
            اضغط «إضافة» لإنشاء أول استراحة على الموقع.
          </p>
        </div>
      ) : (
        <div className="grid gap-2.5 lg:grid-cols-2">
          {listings.map((listing) => (
            <AdminListingRow
              key={listing.id}
              listing={{
                id: listing.id,
                slug: listing.slug,
                name: listing.name,
                area: listing.area || cityLabel(listing.city),
                pricePerNight: listing.pricePerNight,
                capacity: listing.capacity,
                coverUrl: listing.coverUrl,
                published: listing.published,
                verified: listing.verified,
                featured: listing.featured,
              }}
            />
          ))}
        </div>
      )}
    </div>
  );
}
