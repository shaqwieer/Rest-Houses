import { describe, expect, it } from "vitest";
import {
  EMPTY_HERO_SEARCH,
  heroSearchHref,
  parseListingFilters,
  stayQuery,
} from "@/lib/search";

/**
 * The hero search bar's URL contract.
 *
 * The bar used to open on dates three and five days out and 30 guests, and
 * submit all three. An untouched search — which is what most paid visitors
 * send — therefore asked for "a 30-person venue free on those two nights" and
 * showed 12 of 37 listings. These pin the replacement: nothing restricts the
 * results unless the visitor chose it, and what they did choose survives into
 * the URL they can share.
 */
describe("heroSearchHref", () => {
  it("sends an untouched search to the whole catalogue", () => {
    expect(heroSearchHref(EMPTY_HERO_SEARCH)).toBe("/listings");

    // …and that URL parses back to no restriction at all.
    const filters = parseListingFilters({});
    expect(filters.minCapacity).toBeUndefined();
    expect(filters.availableFrom).toBeUndefined();
    expect(filters.availableTo).toBeUndefined();
  });

  it("starts with no dates and any number of guests", () => {
    expect(EMPTY_HERO_SEARCH).toEqual({ city: "all", checkIn: "", checkOut: "", guests: "" });
  });

  it("keeps every filter the visitor actually chose", () => {
    const href = heroSearchHref({
      city: "ajman",
      checkIn: "2030-03-12",
      checkOut: "2030-03-14",
      guests: "25",
    });
    expect(href).toBe("/listings?city=ajman&from=2030-03-12&to=2030-03-14&capacity=25");

    // The results page reads back exactly what was sent.
    const filters = parseListingFilters(Object.fromEntries(new URL(href, "http://x").searchParams));
    expect(filters).toMatchObject({
      city: "ajman",
      availableFrom: "2030-03-12",
      availableTo: "2030-03-14",
      minCapacity: 25,
    });
  });

  it("keeps one choice without inventing the others", () => {
    expect(heroSearchHref({ ...EMPTY_HERO_SEARCH, guests: "12" })).toBe("/listings?capacity=12");
    expect(heroSearchHref({ ...EMPTY_HERO_SEARCH, city: "dubai" })).toBe("/listings?city=dubai");
  });

  it("drops half a date range rather than sending a date that filters nothing", () => {
    expect(heroSearchHref({ ...EMPTY_HERO_SEARCH, checkIn: "2030-03-12" })).toBe("/listings");
    expect(
      heroSearchHref({ ...EMPTY_HERO_SEARCH, checkIn: "2030-03-14", checkOut: "2030-03-12" }),
    ).toBe("/listings");
  });

  it("treats an empty or nonsense guest count as any number", () => {
    expect(heroSearchHref({ ...EMPTY_HERO_SEARCH, guests: "" })).toBe("/listings");
    expect(heroSearchHref({ ...EMPTY_HERO_SEARCH, guests: "0" })).toBe("/listings");
    expect(heroSearchHref({ ...EMPTY_HERO_SEARCH, guests: "abc" })).toBe("/listings");
  });
});

describe("parseListingFilters", () => {
  it("accepts a known property type and drops an unknown one", () => {
    expect(parseListingFilters({ type: "farm" }).type).toBe("farm");
    // A mistyped ad URL shows the catalogue, not an empty page.
    expect(parseListingFilters({ type: "castle" }).type).toBeUndefined();
  });
});

describe("stayQuery", () => {
  it("carries a searched stay onto the rest house's page", () => {
    expect(
      stayQuery({ availableFrom: "2030-03-12", availableTo: "2030-03-14", minCapacity: 25 }),
    ).toBe("?from=2030-03-12&to=2030-03-14&guests=25");
  });

  it("carries nothing when nothing was searched", () => {
    expect(stayQuery({})).toBe("");
  });
});
