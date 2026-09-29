import { getListingType, isSortId, normalizeCityId, type SortId } from "./constants";
import { isISODate, type ISODate } from "./dates";

/**
 * The search, as a URL — shared by the hero bar that writes it, the results
 * page that reads it, and the home page's popular-search links.
 *
 * Client-safe: no Prisma, no settings. `findListings` in ./listings.ts is the
 * one place a `ListingFilters` is turned into a query.
 */

export type ListingFilters = {
  city?: string; // "all" or a CITIES id
  category?: string; // "all" or a CATEGORIES id
  /** A LISTING_TYPES id — "farm". Matched against the listing's own name. */
  type?: string;
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

type SearchParams = Record<string, string | string[] | undefined>;

/** Read the query string into typed filters, ignoring anything malformed. */
export function parseListingFilters(sp: SearchParams): ListingFilters {
  const str = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string) : undefined);
  const num = (k: string) => {
    const v = Number(str(k));
    return Number.isFinite(v) && v > 0 ? v : undefined;
  };

  const from = str("from");
  const to = str("to");
  const range = isISODate(from) && isISODate(to) && from < to;
  const sort = str("sort");

  return {
    // A bookmarked ?city=alain link still resolves — see normalizeCityId.
    city: normalizeCityId(str("city")),
    category: str("category"),
    // An unknown type is dropped rather than matching nothing: a mistyped ad
    // URL should show the whole catalogue, not an empty page.
    type: getListingType(str("type"))?.id,
    maxPrice: num("maxPrice"),
    minCapacity: num("capacity"),
    amenities: (str("amenities") ?? "").split(",").filter(Boolean),
    sort: isSortId(sort) ? sort : "reco",
    q: str("q"),
    // Only honour a date range if BOTH ends are valid dates in order.
    availableFrom: range ? from : undefined,
    availableTo: range ? to : undefined,
  };
}

/* -------------------------------------------------------------------------- */
/* The hero search bar                                                        */
/* -------------------------------------------------------------------------- */

/**
 * What the hero bar holds. Strings throughout, because "" is a real answer
 * for every field: no emirate, no dates, any number of guests.
 */
export type HeroSearchState = {
  city: string;
  checkIn: string;
  checkOut: string;
  guests: string;
};

/**
 * The bar's starting state: no restriction at all.
 *
 * It used to open on dates three and five days out and 30 guests, and submit
 * all three. So a visitor who pressed «ابحث» without touching anything was
 * searching "a 30-person venue, free on those two nights" — 12 of 37 listings
 * on the day it was measured, with nothing on the screen saying why the rest
 * were missing. Paid traffic lands here, and most of it never edits a field.
 */
export const EMPTY_HERO_SEARCH: HeroSearchState = {
  city: "all",
  checkIn: "",
  checkOut: "",
  guests: "",
};

/**
 * The results URL for a hero search. Only what the visitor actually chose
 * goes into it, so the default search is plain `/listings`.
 *
 * Dates travel as a pair or not at all — the results page ignores half a
 * range, so sending one would put a date in the URL that filters nothing.
 */
export function heroSearchHref(state: HeroSearchState): string {
  const params = new URLSearchParams();
  if (state.city && state.city !== "all") params.set("city", state.city);
  if (isISODate(state.checkIn) && isISODate(state.checkOut) && state.checkIn < state.checkOut) {
    params.set("from", state.checkIn);
    params.set("to", state.checkOut);
  }
  const guests = Math.floor(Number(state.guests));
  if (state.guests.trim() !== "" && Number.isFinite(guests) && guests > 0) {
    params.set("capacity", String(guests));
  }
  const query = params.toString();
  return query ? `/listings?${query}` : "/listings";
}

/**
 * The part of a search that follows the guest onto a rest house's page: the
 * dates they picked and how many they are. Appended to every card link on a
 * results page, so a guest who searched for the 12th to the 14th does not have
 * to pick those nights again on the calendar.
 *
 * Returns "" (not "?") when there is nothing to carry.
 */
export function stayQuery(filters: ListingFilters): string {
  const params = new URLSearchParams();
  if (filters.availableFrom && filters.availableTo) {
    params.set("from", filters.availableFrom);
    params.set("to", filters.availableTo);
  }
  if (filters.minCapacity) params.set("guests", String(filters.minCapacity));
  const query = params.toString();
  return query ? `?${query}` : "";
}
