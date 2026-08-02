import Link from "next/link";
import { Icon } from "@/components/ui/icon";
import { AdminListingRow } from "@/components/admin/listing-row";
import {
  AdminFilterChips,
  AdminPagination,
  AdminSearch,
} from "@/components/admin/table-shell";
import { requireAdminPage } from "@/lib/auth";
import { listListingsForAdmin, readPage } from "@/lib/admin-queries";
import { localizeListing } from "@/lib/listings";
import { DEFAULT_PHOTO_URL } from "@/lib/constants";
import { getI18n } from "@/lib/i18n/server";
import { arNum } from "@/lib/format";

/**
 * Listings management. Cards rather than a table — a table can't be read on a
 * phone, and this dashboard is phone-first.
 *
 * Paged in SQL, unlike the public grid: this list filters only on indexed
 * scalar columns (name, area, published, ownerId), so `skip`/`take` returns
 * correct pages. The public grid narrows by amenity in memory and therefore
 * cannot — see the note in src/lib/listings.ts.
 */
export default async function AdminListingsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireAdminPage();

  const sp = await searchParams;
  const { t, locale } = await getI18n();

  const page = readPage(sp.page);
  const search = typeof sp.q === "string" ? sp.q : "";
  const ownerId = typeof sp.owner === "string" ? sp.owner : "all";
  const publishedRaw = typeof sp.published === "string" ? sp.published : "all";
  const published = publishedRaw === "yes" || publishedRaw === "no" ? publishedRaw : "all";

  const result = await listListingsForAdmin({ page, search, ownerId, published });

  // Named rather than spread from `localizeListing()`: the row is a client
  // component, so every field handed to it is serialised into the RSC payload.
  // Spreading would ship each listing's full description to the browser for a
  // grid that never renders one — the same waste `toCardData()` exists to avoid.
  const rows = result.rows.map((listing) => {
    const { name, area } = localizeListing(listing, locale);
    return { listing, name, area };
  });

  return (
    <div className="animate-fade-up">
      <div className="mb-4 flex items-center justify-between gap-3">
        <div>
          <h1 className="m-0 font-display text-[20px] font-extrabold text-ink">
            {t.admin.listings}
          </h1>
          <p className="m-0 text-[12.5px] text-muted">
            {t.owner.listingsCount(arNum(result.total, locale), result.total)}
          </p>
        </div>
        <Link
          href="/admin/listings/new"
          className="flex shrink-0 items-center gap-2 rounded-full bg-linear-[140deg,var(--gold-500),var(--gold-600)] px-4 py-3 text-[13.5px] font-extrabold text-night-900 no-underline shadow-gold hover:no-underline"
        >
          <Icon name="add" size={19} />
          {t.common.add}
        </Link>
      </div>

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <AdminSearch />
      </div>

      <div className="mb-3">
        <AdminFilterChips
          param="published"
          options={[
            { value: "all", label: t.common.all },
            { value: "yes", label: t.admin.publishedBadge },
            { value: "no", label: t.admin.hiddenBadge },
          ]}
        />
      </div>

      {result.rows.length === 0 ? (
        <div className="rounded-[20px] border border-dashed border-sand-300 bg-surface p-8 text-center">
          <Icon name="holiday_village" size={46} className="mx-auto text-sand-400" />
          <h2 className="mt-3.5 mb-2 font-display text-[17px] font-bold text-ink">
            {t.admin.noMatches}
          </h2>
        </div>
      ) : (
        <div className="grid gap-2.5 lg:grid-cols-2">
          {rows.map(({ listing, name, area }) => (
            <AdminListingRow
              key={listing.id}
              listing={{
                id: listing.id,
                slug: listing.slug,
                name,
                area,
                pricePerNight: listing.pricePerNight,
                capacity: listing.capacity,
                coverUrl: listing.images[0]?.url ?? DEFAULT_PHOTO_URL,
                published: listing.published,
                verified: listing.verified,
                featured: listing.featured,
                hiddenByOwnerState: listing.hiddenByOwnerState,
              }}
            />
          ))}
        </div>
      )}

      <AdminPagination
        page={result.page}
        pageCount={result.pageCount}
        total={result.total}
        pageSize={result.pageSize}
      />
    </div>
  );
}
