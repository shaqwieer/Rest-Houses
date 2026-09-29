import { cache } from "react";
import { prisma } from "./prisma";
import { parseIdList } from "./json-list";
import { getListingType, label, type Localized } from "./constants";
import type { Locale } from "./i18n/config";
import { publicListingWhere } from "./listings";
import { parseListingFilters, type ListingFilters } from "./search";

/**
 * The home page's direct routes into the searches people actually type —
 * «شاليهات حتا», «مزارع للإيجار», «استراحات بمسبح».
 *
 * Each one is an ordinary results URL, so it is also a usable Google Ads final
 * URL for the ad group of the same name: the results page reads the same
 * parameters and titles itself after them.
 *
 * ─── Shown only when there is something behind it ────────────────────────────
 * A link is rendered only while at least one public listing matches it. That
 * is the whole point of counting: «لهباب» used to sit in this row and led to
 * zero results, because no listing there is live. «مزارع عجمان» is defined
 * below for the same reason — it appears by itself the day a farm in Ajman is
 * published, and not before.
 *
 * Order is display order.
 */
export type PopularSearch = Localized & {
  id: string;
  /** The results page's own query parameters. */
  params: Record<string, string>;
};

export const POPULAR_SEARCHES: readonly PopularSearch[] = [
  { id: "hatta", ar: "شاليهات حتا", en: "Hatta chalets", params: { q: "حتا" } },
  { id: "farms", ar: "مزارع للإيجار", en: "Farms for rent", params: { type: "farm" } },
  {
    id: "ajman-farms",
    ar: "مزارع عجمان",
    en: "Farms in Ajman",
    params: { type: "farm", city: "ajman" },
  },
  {
    id: "abudhabi",
    ar: "استراحات أبوظبي",
    en: "Abu Dhabi rest houses",
    params: { city: "abudhabi" },
  },
  {
    id: "pool",
    ar: "استراحات بمسبح خاص",
    en: "With a private pool",
    params: { amenities: "pool" },
  },
  { id: "ajman", ar: "استراحات عجمان", en: "Ajman rest houses", params: { city: "ajman" } },
  { id: "rak", ar: "استراحات رأس الخيمة", en: "Ras Al Khaimah", params: { city: "rak" } },
];

export function popularSearchHref(search: PopularSearch): string {
  return `/listings?${new URLSearchParams(search.params).toString()}`;
}

/** The columns a popular search can filter on — nothing else is read. */
type MatchRow = {
  city: string;
  name: string;
  nameEn: string | null;
  area: string;
  areaEn: string | null;
  capacity: number;
  pricePerNight: number;
  amenities: string;
  categories: string;
};

/** Postgres `ILIKE '%term%'`, which is what `contains` + insensitive compiles to. */
function has(value: string | null, term: string): boolean {
  return (value ?? "").toLocaleLowerCase().includes(term.toLocaleLowerCase());
}

/**
 * `findListings`' filters, evaluated against one row in memory.
 *
 * Exists so the counts below cost one query instead of one per link: the home
 * page is rendered per request, takes the paid traffic, and runs on a single
 * core. Dates are deliberately not handled — no popular search carries any,
 * and availability needs the calendar table.
 *
 * It has to agree with `findListings` exactly, or a link would promise results
 * its page does not show. tests/popular-searches.test.ts holds the two side by
 * side for every entry above.
 */
export function matchesFilters(row: MatchRow, f: ListingFilters): boolean {
  if (f.city && f.city !== "all" && row.city !== f.city) return false;
  if (typeof f.maxPrice === "number" && row.pricePerNight > f.maxPrice) return false;
  if (f.minCapacity && row.capacity < f.minCapacity) return false;
  if (f.q && f.q.trim()) {
    const term = f.q.trim();
    if (![row.name, row.nameEn, row.area, row.areaEn].some((v) => has(v, term))) return false;
  }
  const type = getListingType(f.type);
  if (type && !type.terms.some((term) => has(row.name, term) || has(row.nameEn, term))) {
    return false;
  }
  if (f.category && f.category !== "all" && !parseIdList(row.categories).includes(f.category)) {
    return false;
  }
  const amenityIds = parseIdList(row.amenities);
  if ((f.amenities ?? []).some((a) => !amenityIds.includes(a))) return false;
  return true;
}

export type PopularSearchLink = { id: string; label: string; href: string; count: number };

/**
 * The popular searches that currently lead somewhere, with how many listings
 * each one shows. Request-cached; one query.
 */
export const getPopularSearches = cache(
  async (locale: Locale): Promise<PopularSearchLink[]> => {
    const rows = await prisma.listing.findMany({
      where: publicListingWhere(),
      select: {
        city: true,
        name: true,
        nameEn: true,
        area: true,
        areaEn: true,
        capacity: true,
        pricePerNight: true,
        amenities: true,
        categories: true,
      },
    });

    return POPULAR_SEARCHES.map((search) => {
      const filters = parseListingFilters(search.params);
      return {
        id: search.id,
        label: label(search, locale),
        href: popularSearchHref(search),
        count: rows.filter((row) => matchesFilters(row, filters)).length,
      };
    }).filter((link) => link.count > 0);
  },
);
