import Link from "next/link";
import { Icon } from "@/components/ui/icon";
import { AdminListingRow } from "@/components/admin/listing-row";
import { getListingsForOwner } from "@/lib/listings";
import { getActiveOwnerSession } from "@/lib/auth";
import { cityLabel } from "@/lib/constants";
import { getI18n } from "@/lib/i18n/server";
import { arNum } from "@/lib/format";

/**
 * The owner's own listings.
 *
 * `getListingsForOwner(owner.id)` filters by `ownerId` in SQL, so this page
 * cannot show another owner's rows even by accident — there is no client-side
 * filter to get wrong.
 */
export default async function OwnerListingsPage() {
  // null while the owner is pending/rejected/suspended/expired — the layout
  // is rendering the status panel and discards this page's output.
  const session = await getActiveOwnerSession();
  if (!session) return null;
  const { owner } = session;
  const { t, locale } = await getI18n();

  const listings = await getListingsForOwner(owner.id);

  return (
    <div className="animate-fade-up">
      <div className="mb-4 flex items-center justify-between gap-3">
        <div>
          <h1 className="m-0 font-display text-[20px] font-extrabold text-ink">
            {t.owner.myListings}
          </h1>
          <p className="m-0 text-[12.5px] text-muted">
            {t.owner.listingsCount(arNum(listings.length, locale), listings.length)}
          </p>
        </div>
        <Link
          href="/owner/listings/new"
          className="flex shrink-0 items-center gap-2 rounded-full bg-linear-[140deg,var(--gold-500),var(--gold-600)] px-4 py-3 text-[13.5px] font-extrabold text-night-900 no-underline shadow-gold hover:no-underline"
        >
          <Icon name="add" size={19} />
          {t.common.add}
        </Link>
      </div>

      {listings.length === 0 ? (
        <div className="rounded-[20px] border border-dashed border-sand-300 bg-surface p-8 text-center">
          <Icon name="holiday_village" size={46} className="mx-auto text-sand-400" />
          <h2 className="mt-3.5 mb-2 font-display text-[17px] font-bold text-ink">
            {t.owner.noListingsTitle}
          </h2>
          <p className="m-0 text-[13.5px] text-muted">{t.owner.noListingsBody}</p>
        </div>
      ) : (
        <div className="grid gap-2.5 lg:grid-cols-2">
          {listings.map((listing) => (
            <AdminListingRow
              key={listing.id}
              scope="owner"
              listing={{
                id: listing.id,
                slug: listing.slug,
                name: listing.name,
                area: listing.area || cityLabel(listing.city, locale),
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
