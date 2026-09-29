import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  createListing,
  createOwner,
  daysFromNow,
  ensureSchema,
  prisma,
  resetDatabase,
  seedSettings,
} from "./db";
import { findListings } from "@/lib/listings";
import {
  getPopularSearches,
  matchesFilters,
  POPULAR_SEARCHES,
  popularSearchHref,
} from "@/lib/popular-searches";
import { addDays, todayISO } from "@/lib/dates";
import { EMPTY_HERO_SEARCH, heroSearchHref, parseListingFilters } from "@/lib/search";

/**
 * The searches a Google Ads ad group lands on, against a real database.
 *
 * The catalogue below is a small copy of the live one's shape: farms named as
 * farms in two languages, rest houses in Hatta found by their area, a pool
 * that only some have — and one farm in Ajman whose owner's membership has
 * lapsed, which must never be counted or shown.
 */

beforeAll(() => {
  ensureSchema();
});

afterAll(async () => {
  await prisma.$disconnect();
});

beforeEach(async () => {
  await resetDatabase();
  await seedSettings();
});

async function listing(
  opts: Parameters<typeof createListing>[0] & {
    area?: string;
    nameEn?: string;
    amenities?: string[];
  },
) {
  const { area, nameEn, amenities, ...rest } = opts;
  const row = await createListing(rest);
  return prisma.listing.update({
    where: { id: row.id },
    data: {
      area: area ?? "",
      nameEn: nameEn ?? null,
      amenities: JSON.stringify(amenities ?? []),
    },
  });
}

/** Search a results URL exactly as the page does. */
function search(params: Record<string, string>) {
  return findListings(parseListingFilters(params));
}

async function seedCatalogue() {
  const { owner: lapsed } = await createOwner({
    email: "lapsed@example.ae",
    membershipExpiresAt: daysFromNow(-1),
  });

  return {
    ribbon: await listing({ name: "مزرعة الريف الأخضر", city: "rak", capacity: 40, amenities: ["pool"] }),
    falaj: await listing({ name: "استراحة فلج فارم", city: "uaq", capacity: 40 }),
    dunes: await listing({ name: "Golden Dunes Farm", city: "abudhabi", capacity: 10 }),
    jasmin: await listing({ name: "Jasmin", area: "حتا", city: "dubai", capacity: 4, amenities: ["pool"] }),
    rif: await listing({ name: "استراحة ريف حتا", area: "مصفوت", city: "ajman", capacity: 12 }),
    // Near farms, but not one — an area line describes the neighbourhood.
    nearFarms: await listing({ name: "استراحة الواحة", area: "قرب المزارع", city: "abudhabi", capacity: 30 }),
    hiddenAjmanFarm: await listing({
      name: "مزرعة عجمان",
      city: "ajman",
      capacity: 50,
      ownerId: lapsed.id,
    }),
  };
}

describe("the default hero search", () => {
  it("returns every public listing — the old 30-guest, dated default did not", async () => {
    const c = await seedCatalogue();
    const from = addDays(todayISO(), 3);
    const to = addDays(todayISO(), 5);
    // One listing is booked on the old default's dates.
    await prisma.availability.create({
      data: { listingId: c.nearFarms.id, date: from, status: "BOOKED", sourceKey: "LOCAL" },
    });

    const href = heroSearchHref(EMPTY_HERO_SEARCH);
    const results = await search(Object.fromEntries(new URL(href, "http://x").searchParams));
    expect(results).toHaveLength(6); // all seven but the lapsed owner's

    // What the bar used to submit without the visitor touching it.
    const old = await search({ from, to, capacity: "30" });
    expect(old.map((l) => l.name).sort()).toEqual(["استراحة فلج فارم", "مزرعة الريف الأخضر"]);
  });
});

describe("type=farm", () => {
  it("finds listings their owners named as farms, in either language, and nothing else", async () => {
    await seedCatalogue();
    const names = (await search({ type: "farm" })).map((l) => l.name).sort();
    expect(names).toEqual(["Golden Dunes Farm", "استراحة فلج فارم", "مزرعة الريف الأخضر"]);
  });

  it("combines with q, a city and an amenity without widening either text match", async () => {
    await seedCatalogue();
    // Both text conditions must hold: a farm AND in Hatta. Neither alone.
    expect(await search({ type: "farm", q: "حتا" })).toHaveLength(0);
    expect((await search({ type: "farm", amenities: "pool" })).map((l) => l.name)).toEqual([
      "مزرعة الريف الأخضر",
    ]);
    expect((await search({ type: "farm", city: "abudhabi" })).map((l) => l.name)).toEqual([
      "Golden Dunes Farm",
    ]);
  });

  it("never shows a hidden owner's farm, whatever else is searched", async () => {
    await seedCatalogue();
    expect(await search({ type: "farm", city: "ajman" })).toHaveLength(0);
    expect(await search({ q: "عجمان" })).toHaveLength(0);
  });
});

describe("popular searches", () => {
  it("counts exactly what each link's results page shows", async () => {
    await seedCatalogue();
    const links = await getPopularSearches("ar");
    for (const entry of POPULAR_SEARCHES) {
      const shown = await search(entry.params);
      const link = links.find((l) => l.id === entry.id);
      // In-memory matcher and the SQL search agree, entry by entry.
      expect(link?.count ?? 0, entry.id).toBe(shown.length);
      if (link) expect(link.href).toBe(popularSearchHref(entry));
    }
  });

  it("hides a search with nothing live behind it", async () => {
    await seedCatalogue();
    const ids = (await getPopularSearches("ar")).map((l) => l.id);

    // The only Ajman farm belongs to a lapsed owner.
    expect(ids).not.toContain("ajman-farms");
    expect(ids).toEqual(expect.arrayContaining(["hatta", "farms", "abudhabi", "pool", "ajman", "rak"]));
  });

  it("offers «مزارع عجمان» the moment a live farm in Ajman exists", async () => {
    await seedCatalogue();
    await listing({ name: "مزرعة مصفوت", city: "ajman" });
    const link = (await getPopularSearches("ar")).find((l) => l.id === "ajman-farms");
    expect(link).toMatchObject({ count: 1, href: "/listings?type=farm&city=ajman" });
  });

  it("matches text the way Postgres ILIKE does", () => {
    const row = {
      city: "abudhabi",
      name: "Golden Dunes FARM",
      nameEn: null,
      area: "",
      areaEn: null,
      capacity: 10,
      pricePerNight: 1000,
      amenities: "[]",
      categories: "[]",
    };
    expect(matchesFilters(row, { type: "farm" })).toBe(true);
    expect(matchesFilters(row, { q: "dunes" })).toBe(true);
    expect(matchesFilters(row, { q: "hatta" })).toBe(false);
  });
});
