import { cache } from "react";
import type { Prisma } from "@prisma/client";
import { prisma } from "./prisma";
import { parseIdList } from "./json-list";
import { getAmenities, type SortId } from "./constants";
import type { ISODate } from "./dates";
import { nightsInRange, todayISO } from "./dates";

/**
 * Listing queries — the read side of the public site.
 *
 * Every function returns a `ListingView`: the database row with the JSON id
 * columns already parsed and amenities resolved to their Arabic labels, so no
 * component has to know about the storage representation.
 */

const listingInclude = {
  images: { orderBy: { sortOrder: "asc" } },
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

  const where: Prisma.ListingWhereInput = { published: true };

  if (city && city !== "all") where.city = city;
  if (typeof maxPrice === "number") where.pricePerNight = { lte: maxPrice };
  if (typeof minCapacity === "number" && minCapacity > 0) {
    where.capacity = { gte: minCapacity };
  }
  if (q && q.trim()) {
    const term = q.trim();
    where.OR = [{ name: { contains: term } }, { area: { contains: term } }];
  }

  const rows = await prisma.listing.findMany({
    where,
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

/** Home page — the hand-picked "استراحات مميّزة هذا الأسبوع" row. */
export const getFeaturedListings = cache(async (limit = 4): Promise<ListingView[]> => {
  const rows = await prisma.listing.findMany({
    where: { published: true, featured: true },
    include: listingInclude,
    orderBy: [{ rating: "desc" }, { reviewsCount: "desc" }],
    take: limit,
  });
  return rows.map(toView);
});

export const getListingBySlug = cache(async (slug: string) => {
  const row = await prisma.listing.findFirst({
    where: { slug, published: true },
    include: {
      ...listingInclude,
      reviews: { where: { published: true }, orderBy: { createdAt: "desc" }, take: 12 },
    },
  });
  if (!row) return null;

  const { reviews, ...rest } = row;
  return { ...toView(rest as ListingRow), reviews };
});

/** Admin: includes unpublished drafts. */
export async function getListingById(id: string) {
  const row = await prisma.listing.findUnique({ where: { id }, include: listingInclude });
  return row ? toView(row) : null;
}

export async function getAllListingsForAdmin(): Promise<ListingView[]> {
  const rows = await prisma.listing.findMany({
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
