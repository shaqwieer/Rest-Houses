import { beforeAll, beforeEach, afterAll, describe, expect, it } from "vitest";
import {
  createListing,
  createOwner,
  daysFromNow,
  ensureSchema,
  prisma,
  resetDatabase,
  seedSettings,
} from "./db";
import {
  findListings,
  getFeaturedListings,
  getListingBySlug,
  getPublicListingSlugs,
  getPublicListingStats,
  getPublicListingsByIds,
  publicListingWhere,
  withPublicListingWhere,
} from "@/lib/listings";
import { isOwnerActive, ownerAccessState } from "@/lib/owners";

/**
 * Requirement 3: an expired, suspended, rejected or pending owner's listings
 * must be invisible on every public surface — and must come back, unchanged,
 * when the owner is reactivated.
 *
 * These run against a real SQLite database. A mocked Prisma client would only
 * prove the code passes the arguments the test also wrote; running the SQL is
 * what makes the assertion mean something.
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

describe("ownerAccessState", () => {
  it("reports the stored status when it isn't APPROVED", () => {
    expect(ownerAccessState({ status: "PENDING", membershipExpiresAt: null })).toBe("PENDING");
    expect(ownerAccessState({ status: "REJECTED", membershipExpiresAt: null })).toBe("REJECTED");
    expect(ownerAccessState({ status: "SUSPENDED", membershipExpiresAt: null })).toBe("SUSPENDED");
  });

  it("derives EXPIRED from the membership date rather than storing it", () => {
    expect(
      ownerAccessState({ status: "APPROVED", membershipExpiresAt: daysFromNow(-1) }),
    ).toBe("EXPIRED");
    expect(
      ownerAccessState({ status: "APPROVED", membershipExpiresAt: daysFromNow(1) }),
    ).toBe("APPROVED");
  });

  it("treats a null expiry as open-ended, not expired", () => {
    expect(ownerAccessState({ status: "APPROVED", membershipExpiresAt: null })).toBe("APPROVED");
    expect(isOwnerActive({ status: "APPROVED", membershipExpiresAt: null })).toBe(true);
  });

  it("shows SUSPENDED ahead of EXPIRED when both apply", () => {
    // The fact an admin needs to act on first.
    expect(
      ownerAccessState({ status: "SUSPENDED", membershipExpiresAt: daysFromNow(-5) }),
    ).toBe("SUSPENDED");
  });

  it("only an approved, in-membership owner is active", () => {
    expect(isOwnerActive({ status: "APPROVED", membershipExpiresAt: daysFromNow(10) })).toBe(true);
    expect(isOwnerActive({ status: "APPROVED", membershipExpiresAt: daysFromNow(-1) })).toBe(false);
    expect(isOwnerActive({ status: "PENDING", membershipExpiresAt: null })).toBe(false);
    expect(isOwnerActive({ status: "SUSPENDED", membershipExpiresAt: null })).toBe(false);
    expect(isOwnerActive({ status: "REJECTED", membershipExpiresAt: null })).toBe(false);
    expect(isOwnerActive(null)).toBe(false);
  });
});

describe("public listing visibility", () => {
  async function buildCatalogue() {
    const active = await createOwner({ email: "a@x.ae", status: "APPROVED" });
    const pending = await createOwner({ email: "p@x.ae", status: "PENDING", membershipExpiresAt: null });
    const rejected = await createOwner({ email: "r@x.ae", status: "REJECTED", membershipExpiresAt: null });
    const suspended = await createOwner({ email: "s@x.ae", status: "SUSPENDED" });
    const expired = await createOwner({
      email: "e@x.ae",
      status: "APPROVED",
      membershipExpiresAt: daysFromNow(-1),
    });

    return {
      owners: { active, pending, rejected, suspended, expired },
      listings: {
        platform: await createListing({ name: "Platform owned", ownerId: null }),
        active: await createListing({ name: "Active owner", ownerId: active.owner.id }),
        pending: await createListing({ name: "Pending owner", ownerId: pending.owner.id }),
        rejected: await createListing({ name: "Rejected owner", ownerId: rejected.owner.id }),
        suspended: await createListing({ name: "Suspended owner", ownerId: suspended.owner.id }),
        expired: await createListing({ name: "Expired owner", ownerId: expired.owner.id }),
        unpublished: await createListing({
          name: "Draft",
          ownerId: active.owner.id,
          published: false,
        }),
      },
    };
  }

  it("shows only platform-owned and active-owner listings", async () => {
    await buildCatalogue();
    const names = (await findListings()).map((l) => l.name).sort();
    expect(names).toEqual(["Active owner", "Platform owned"]);
  });

  it("hides a listing whose owner's membership expired", async () => {
    const { listings } = await buildCatalogue();
    const names = (await findListings()).map((l) => l.name);
    expect(names).not.toContain("Expired owner");

    // …and it is still `published`. Nothing unpublished it; it is filtered at
    // query time, which is what makes renewal a single date change.
    const row = await prisma.listing.findUnique({ where: { id: listings.expired.id } });
    expect(row?.published).toBe(true);
  });

  it("hides suspended, rejected and pending owners' listings", async () => {
    await buildCatalogue();
    const names = (await findListings()).map((l) => l.name);
    for (const hidden of ["Suspended owner", "Rejected owner", "Pending owner"]) {
      expect(names).not.toContain(hidden);
    }
  });

  it("keeps platform-owned listings visible — they have no owner to gate on", async () => {
    await buildCatalogue();
    const names = (await findListings()).map((l) => l.name);
    expect(names).toContain("Platform owned");
  });

  it("still respects the owner's own unpublish choice", async () => {
    await buildCatalogue();
    expect((await findListings()).map((l) => l.name)).not.toContain("Draft");
  });

  /** Requirement: renewing restores eligible listings at their original status. */
  it("restores listings when the membership is renewed, and only the eligible ones", async () => {
    const { owners } = await buildCatalogue();

    expect((await findListings()).map((l) => l.name)).not.toContain("Expired owner");

    await prisma.ownerProfile.update({
      where: { id: owners.expired.owner.id },
      data: { membershipExpiresAt: daysFromNow(365) },
    });

    const after = (await findListings()).map((l) => l.name);
    expect(after).toContain("Expired owner");
    // The active owner's draft was never published, and renewal must not
    // publish anything — it only lifts the gate.
    expect(after).not.toContain("Draft");
  });

  it("restores listings when a suspended owner is reactivated", async () => {
    const { owners } = await buildCatalogue();
    expect((await findListings()).map((l) => l.name)).not.toContain("Suspended owner");

    await prisma.ownerProfile.update({
      where: { id: owners.suspended.owner.id },
      data: { status: "APPROVED" },
    });

    expect((await findListings()).map((l) => l.name)).toContain("Suspended owner");
  });

  /**
   * Every public read path, enumerated. A path that builds its own
   * `{ published: true }` is a hole — this is the test that finds one.
   */
  describe("every public read path applies the predicate", () => {
    it("the featured row", async () => {
      const { owners } = await buildCatalogue();
      await prisma.listing.updateMany({ data: { featured: true } });

      const names = (await getFeaturedListings(20)).map((l) => l.name);
      expect(names).toContain("Active owner");
      expect(names).not.toContain("Expired owner");
      expect(names).not.toContain("Suspended owner");
      expect(owners.expired.owner.id).toBeTruthy();
    });

    it("the detail page by slug", async () => {
      const { listings } = await buildCatalogue();
      expect(await getListingBySlug(listings.active.slug)).not.toBeNull();
      // A direct URL must 404 too, not just drop out of the grid.
      expect(await getListingBySlug(listings.expired.slug)).toBeNull();
      expect(await getListingBySlug(listings.suspended.slug)).toBeNull();
    });

    it("the home page counts", async () => {
      await buildCatalogue();
      const stats = await getPublicListingStats();
      expect(stats.total).toBe(2); // platform + active owner
      expect(stats.perCategory.get("family")).toBe(2);
    });

    it("the sitemap", async () => {
      const { listings } = await buildCatalogue();
      const slugs = (await getPublicListingSlugs()).map((r) => r.slug);
      expect(slugs).toContain(listings.active.slug);
      expect(slugs).not.toContain(listings.expired.slug);
    });

    it("favourites, which look listings up by id", async () => {
      const { listings } = await buildCatalogue();
      const found = await getPublicListingsByIds([
        listings.active.id,
        listings.expired.id,
        listings.suspended.id,
      ]);
      expect(found.map((l) => l.name)).toEqual(["Active owner"]);
    });

    it("a direct id lookup, as the booking action performs", async () => {
      const { listings } = await buildCatalogue();

      const bookable = await prisma.listing.findFirst({
        where: withPublicListingWhere({ id: listings.active.id }),
      });
      expect(bookable).not.toBeNull();

      // The important one: knowing the id of a hidden listing must not make it
      // bookable.
      const notBookable = await prisma.listing.findFirst({
        where: withPublicListingWhere({ id: listings.expired.id }),
      });
      expect(notBookable).toBeNull();
    });

    it("free-text search cannot surface a hidden listing", async () => {
      await buildCatalogue();
      // "owner" appears in every seeded name. If the search's `OR` overwrote
      // the visibility `OR`, this would return the hidden ones too.
      const names = (await findListings({ q: "owner" })).map((l) => l.name);
      expect(names).toEqual(["Active owner"]);
    });

    it("filters combine with the predicate rather than replacing it", async () => {
      await buildCatalogue();
      const names = (await findListings({ city: "dubai", maxPrice: 5000 })).map((l) => l.name);
      expect(names.sort()).toEqual(["Active owner", "Platform owned"]);
    });
  });

  it("the raw predicate matches what the helpers return", async () => {
    await buildCatalogue();
    const count = await prisma.listing.count({ where: publicListingWhere() });
    expect(count).toBe(2);
  });
});
