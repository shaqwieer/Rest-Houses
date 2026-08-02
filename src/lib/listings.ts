import { cache } from "react";
import type { Prisma } from "@prisma/client";
import { prisma } from "./prisma";
import { parseIdList } from "./json-list";
import { getAmenities, type SortId } from "./constants";
import { activeOwnerWhere, publicOwnerFields } from "./owners";
import type { ISODate } from "./dates";
import { nightsInRange, todayISO } from "./dates";

/**
 * Listing queries — the read side of the public site.
 *
 * Every function returns a `ListingView`: the database row with the JSON id
 * columns already parsed and amenities resolved to their Arabic labels, so no
 * component has to know about the storage representation.
 */

/* -------------------------------------------------------------------------- */
/* Public visibility                                                          */
/* -------------------------------------------------------------------------- */

/**
 * The predicate that decides whether a listing may be seen by the public.
 *
 * ─── This is THE security boundary for requirement 3 ─────────────────────────
 * Every public read path must start from this object — the results grid, the
 * featured row, the detail page, the sitemap, favourites, the map, the category
 * tallies on the home page, and the booking action's listing lookup. A path that
 * builds its own `{ published: true }` is a hole: an expired owner's listings
 * stay reachable through it, which is exactly the leak this exists to close.
 * (`tests/visibility.test.ts` asserts the leak is closed on each of them.)
 *
 * Two conditions, and the second is the new one:
 *
 *   1. `published` — the owner's own intent. Untouched by any of this.
 *
 *   2. the owner is eligible, meaning **either**
 *        • there is no owner at all (`ownerId: null`) — platform-owned
 *          listings, including everything seeded before owners existed. These
 *          must keep working; gating them on an owner they don't have would
 *          empty the catalogue on the day this shipped.
 *        • or the owner is APPROVED and inside their membership period.
 *
 * ─── Why expiry is not a stored flag ─────────────────────────────────────────
 * Note what this does *not* do: it never writes to `Listing.published`. Hiding
 * an expired owner's listings by unpublishing them would destroy the owner's
 * own publish/unpublish choices, and renewal could then only guess which
 * listings to restore. Keeping visibility as a query-time predicate means
 * renewal is a single date change and every listing returns to exactly the
 * state its owner left it in — including the ones they had deliberately
 * unpublished, which stay unpublished.
 */
export function publicListingWhere(now: Date = new Date()): Prisma.ListingWhereInput {
  return {
    published: true,
    OR: [{ ownerId: null }, { owner: { is: activeOwnerWhere(now) } }],
  };
}

/**
 * Merge extra filters onto the public predicate.
 *
 * `AND` rather than spreading into one object: several callers add their own
 * `OR` (free-text search across name and area, for one), and a spread would
 * silently overwrite the `OR` that enforces owner eligibility — turning the
 * search box into a way to see hidden listings. Nesting both under `AND` keeps
 * each intact.
 */
export function withPublicListingWhere(
  extra: Prisma.ListingWhereInput,
  now: Date = new Date(),
): Prisma.ListingWhereInput {
  return { AND: [publicListingWhere(now), extra] };
}

const listingInclude = {
  images: { orderBy: { sortOrder: "asc" } },
  // The owner is included on every read so `resolveListingWhatsapp()` can route
  // contact buttons to the right person without a second query per card. Only
  // the public-safe columns are selected — never the private phone, ID number,
  // status or membership dates.
  owner: { select: publicOwnerFields() },
} satisfies Prisma.ListingInclude;

type ListingRow = Prisma.ListingGetPayload<{ include: typeof listingInclude }>;

export type ListingView = ReturnType<typeof toView>;

function toView(row: ListingRow) {
  const amenityIds = parseIdList(row.amenities);
  const categoryIds = parseIdList(row.categories);

  return {
    ...row,
    amenityIds,
    categoryIds,
    amenityList: getAmenities(amenityIds),
    images: row.images,
    coverUrl: row.images[0]?.url ?? null,
    /** 0 reviews drives the design's "استراحة جديدة" state. */
    isNew: row.reviewsCount === 0,
  };
}

/* -------------------------------------------------------------------------- */
/* Filters                                                                    */
/* -------------------------------------------------------------------------- */

export type ListingFilters = {
  city?: string; // "all" or a CITIES id
  category?: string; // "all" or a CATEGORIES id
  maxPrice?: number;
  minCapacity?: number;
  amenities?: string[];
  sort?: SortId;
  /** Free-text search over name and area. */
  q?: string;
  /** Only listings free for every night of this range. */
  availableFrom?: ISODate;
  availableTo?: ISODate;
};

const SORT_ORDER: Record<SortId, Prisma.ListingOrderByWithRelationInput[]> = {
  // "Best match" = high rating weighted by how many reviews back it up.
  reco: [{ rating: "desc" }, { reviewsCount: "desc" }],
  low: [{ pricePerNight: "asc" }],
  high: [{ pricePerNight: "desc" }],
  rated: [{ rating: "desc" }],
  cap: [{ capacity: "desc" }],
};

/**
 * Search + filter.
 *
 * ─── Why there is no pagination ──────────────────────────────────────────────
 * Amenity filtering happens in memory, because amenities are stored as JSON
 * text for SQLite/Postgres portability (see prisma/schema.prisma) and neither
 * `contains` on a JSON string nor a LIKE is a correct set-containment test.
 * Adding a SQL-level `take`/`skip` while amenities are filtered afterwards
 * would silently return short or empty pages — page 2 could drop everything.
 *
 * The design has no pagination control anywhere, and a private rest-house
 * catalogue is tens to low hundreds of rows, so fetching the city/price/
 * capacity-filtered set and narrowing it in JS is both correct and cheap.
 *
 * If the catalogue ever outgrows this: move amenities to a `ListingAmenity`
 * join table, express the filter as `amenities: { every: … }`, and only then
 * add `take`/`skip`. Those three changes have to land together.
 * ───────────────────────────────────────────────────────────────────────────
 */
export async function findListings(filters: ListingFilters = {}): Promise<ListingView[]> {
  const {
    city,
    category,
    maxPrice,
    minCapacity,
    amenities = [],
    sort = "reco",
    q,
    availableFrom,
    availableTo,
  } = filters;

  // Built as a separate object and merged under AND, because the free-text
  // search below sets its own `OR` — spreading it into the visibility predicate
  // would overwrite the `OR` that enforces owner eligibility and turn the
  // search box into a way to surface hidden listings.
  const sqlFilters: Prisma.ListingWhereInput = {};

  if (city && city !== "all") sqlFilters.city = city;
  if (typeof maxPrice === "number") sqlFilters.pricePerNight = { lte: maxPrice };
  if (typeof minCapacity === "number" && minCapacity > 0) {
    sqlFilters.capacity = { gte: minCapacity };
  }
  if (q && q.trim()) {
    const term = q.trim();
    sqlFilters.OR = [{ name: { contains: term } }, { area: { contains: term } }];
  }

  const rows = await prisma.listing.findMany({
    where: withPublicListingWhere(sqlFilters),
    include: listingInclude,
    orderBy: SORT_ORDER[sort] ?? SORT_ORDER.reco,
  });

  let views = rows.map(toView);

  // Category: same JSON-column constraint as amenities.
  if (category && category !== "all") {
    views = views.filter((v) => v.categoryIds.includes(category));
  }

  // Amenities are AND-ed: "with a pool AND a majlis", matching the design where
  // selecting two chips narrows rather than widens the result set.
  if (amenities.length > 0) {
    views = views.filter((v) => amenities.every((a) => v.amenityIds.includes(a)));
  }

  // Date availability: drop anything with a blocked/booked night in the range.
  if (availableFrom && availableTo) {
    const wanted = nightsInRange(availableFrom, availableTo);
    if (wanted.length > 0) {
      const clashes = await prisma.availability.findMany({
        where: {
          listingId: { in: views.map((v) => v.id) },
          date: { in: wanted },
        },
        select: { listingId: true },
      });
      const busy = new Set(clashes.map((c) => c.listingId));
      views = views.filter((v) => !busy.has(v.id));
    }
  }

  return views;
}

/** Home page — the hand-picked "featured this week" row. */
export const getFeaturedListings = cache(async (limit = 4): Promise<ListingView[]> => {
  const rows = await prisma.listing.findMany({
    where: withPublicListingWhere({ featured: true }),
    include: listingInclude,
    orderBy: [{ rating: "desc" }, { reviewsCount: "desc" }],
    take: limit,
  });
  return rows.map(toView);
});

/**
 * The public detail page.
 *
 * Uses the same predicate as the grid, so a listing that has dropped out of the
 * results because its owner lapsed is *also* a 404 by direct URL. Hiding a
 * listing from the grid while leaving it reachable by slug would not be hiding
 * it at all — the URLs are in the sitemap and in people's history.
 */
export const getListingBySlug = cache(async (slug: string) => {
  const row = await prisma.listing.findFirst({
    where: withPublicListingWhere({ slug }),
    include: {
      ...listingInclude,
      reviews: { where: { published: true }, orderBy: { createdAt: "desc" }, take: 12 },
    },
  });
  if (!row) return null;

  const { reviews, ...rest } = row;
  return { ...toView(rest as ListingRow), reviews };
});

/**
 * Public counts for the home page's hero badge and category tiles.
 *
 * These live here rather than inline in the page for one reason: they are
 * public read paths, and a public read path that builds its own `where` is how
 * an inactive owner's listings leak back into a count. Routing them through the
 * same predicate as everything else makes that impossible by construction.
 */
export const getPublicListingStats = cache(async () => {
  const [total, cities, categoryRows] = await Promise.all([
    prisma.listing.count({ where: publicListingWhere() }),
    prisma.listing
      .findMany({
        where: publicListingWhere(),
        select: { city: true },
        distinct: ["city"],
      })
      .then((r) => r.length),
    // Categories live in a JSON column, so counting them means reading the
    // column and tallying in memory — see the note in `findListings`.
    prisma.listing.findMany({
      where: publicListingWhere(),
      select: { categories: true },
    }),
  ]);

  const perCategory = new Map<string, number>();
  for (const row of categoryRows) {
    for (const id of parseIdList(row.categories)) {
      perCategory.set(id, (perCategory.get(id) ?? 0) + 1);
    }
  }

  return { total, cities, perCategory };
});

/** Public listings by id — for the favourites page, which stores ids locally. */
export async function getPublicListingsByIds(ids: string[]): Promise<ListingView[]> {
  if (ids.length === 0) return [];
  const rows = await prisma.listing.findMany({
    where: withPublicListingWhere({ id: { in: ids } }),
    include: listingInclude,
  });
  return rows.map(toView);
}

/** Slugs for the sitemap — public listings only. */
export async function getPublicListingSlugs(): Promise<{ slug: string; updatedAt: Date }[]> {
  return prisma.listing.findMany({
    where: publicListingWhere(),
    select: { slug: true, updatedAt: true },
  });
}

/** Admin: includes unpublished drafts and every owner's listings. */
export async function getListingById(id: string) {
  const row = await prisma.listing.findUnique({ where: { id }, include: listingInclude });
  return row ? toView(row) : null;
}

/**
 * A single listing scoped to one owner.
 *
 * `ownerId` is part of the WHERE clause, not checked after the read: an owner
 * asking for a listing that isn't theirs gets null, exactly as they would for an
 * id that doesn't exist. That is the difference between "not found" and a
 * confirmation that someone else's listing exists (IDOR).
 */
export async function getOwnerListingById(id: string, ownerId: string) {
  const row = await prisma.listing.findFirst({
    where: { id, ownerId },
    include: listingInclude,
  });
  return row ? toView(row) : null;
}

export async function getAllListingsForAdmin(): Promise<ListingView[]> {
  const rows = await prisma.listing.findMany({
    include: listingInclude,
    orderBy: { createdAt: "desc" },
  });
  return rows.map(toView);
}

/** Every listing belonging to one owner — the owner dashboard's grid. */
export async function getListingsForOwner(ownerId: string): Promise<ListingView[]> {
  const rows = await prisma.listing.findMany({
    where: { ownerId },
    include: listingInclude,
    orderBy: { createdAt: "desc" },
  });
  return rows.map(toView);
}

/** Slug list, for `uniqueSlug()` when creating or renaming. */
export async function getTakenSlugs(exceptId?: string): Promise<string[]> {
  const rows = await prisma.listing.findMany({
    where: exceptId ? { id: { not: exceptId } } : undefined,
    select: { slug: true },
  });
  return rows.map((r) => r.slug);
}

/* -------------------------------------------------------------------------- */
/* Availability                                                               */
/* -------------------------------------------------------------------------- */

/**
 * Unavailable days for a listing, as a Set of ISO dates.
 *
 * Only from today forward: past days are already unselectable and loading years
 * of history would bloat the payload for no benefit.
 */
export async function getUnavailableDates(
  listingId: string,
  fromISO: ISODate = todayISO(),
): Promise<Set<ISODate>> {
  const rows = await prisma.availability.findMany({
    where: { listingId, date: { gte: fromISO } },
    select: { date: true },
  });
  return new Set(rows.map((r) => r.date));
}

/** Admin calendar: needs the status too, to distinguish BOOKED from BLOCKED. */
export async function getAvailabilityMap(
  listingId: string,
): Promise<Map<ISODate, "BLOCKED" | "BOOKED">> {
  const rows = await prisma.availability.findMany({
    where: { listingId },
    select: { date: true, status: true },
  });
  return new Map(rows.map((r) => [r.date, r.status as "BLOCKED" | "BOOKED"]));
}

/**
 * Whether every night of a stay is free. Re-checked server-side at submit time,
 * because the visitor's calendar could be minutes stale by the time they send.
 */
export async function isRangeAvailable(
  listingId: string,
  checkIn: ISODate,
  checkOut: ISODate,
): Promise<boolean> {
  const nights = nightsInRange(checkIn, checkOut);
  if (nights.length === 0) return false;

  const clash = await prisma.availability.findFirst({
    where: { listingId, date: { in: nights } },
    select: { id: true },
  });
  return clash === null;
}
