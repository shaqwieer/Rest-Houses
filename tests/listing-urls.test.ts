import { beforeAll, beforeEach, afterAll, describe, expect, it, vi } from "vitest";
import {
  createListing,
  createOwner,
  daysFromNow,
  ensureSchema,
  prisma,
  resetDatabase,
  seedSettings,
} from "./db";

/**
 * Listing URLs: the redirect a rename leaves behind, and the short share link.
 *
 * ─── What is actually at stake ───────────────────────────────────────────────
 * A listing's canonical URL is its Arabic slug, derived from its name. Renaming
 * a rest house therefore changes its URL — and before ListingSlug that silently
 * threw the old one away. The page Google had indexed became a 404, which a
 * crawler reads as "deleted" rather than "moved", so the listing lost whatever
 * ranking it had earned; and every link already sitting in a WhatsApp thread
 * broke.
 *
 * These run the real save actions against a real database, because what is under
 * test is a transaction and a set of WHERE clauses. A mocked Prisma client would
 * only prove the code passes the arguments the test also wrote.
 *
 * The session is faked exactly as in tests/owner-workflow.test.ts — only
 * `auth()` is mocked, so the guards themselves still run and still re-read the
 * owner's status from the database.
 */

const sessionUser = vi.hoisted(() => ({ current: null as { id: string } | null }));

vi.mock("next-auth", async () => {
  return {
    default: () => ({
      handlers: {},
      signIn: vi.fn(),
      signOut: vi.fn(),
      auth: async () => (sessionUser.current ? { user: { id: sessionUser.current.id } } : null),
    }),
    AuthError: class AuthError extends Error {},
  };
});

vi.mock("next-auth/providers/credentials", () => ({ default: () => ({}) }));

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
  revalidateTag: vi.fn(),
}));

vi.mock("@/lib/i18n/server", async () => {
  const { ar } = await import("@/lib/i18n/ar");
  return {
    getLocale: async () => "ar",
    getT: async () => ar,
    getDir: async () => "rtl",
    getI18n: async () => ({ locale: "ar", t: ar, dir: "rtl" }),
  };
});

function signInAs(userId: string | null) {
  sessionUser.current = userId ? { id: userId } : null;
}

beforeAll(() => {
  ensureSchema();
});

afterAll(async () => {
  await prisma.$disconnect();
});

beforeEach(async () => {
  await resetDatabase();
  await seedSettings();
  signInAs(null);
});

/** The owner listing form, carrying only the fields the action requires. */
function listingForm(overrides: Record<string, string> = {}) {
  const fd = new FormData();
  const base: Record<string, string> = {
    name: "استراحة الرمال الذهبية",
    description: "وصف الاستراحة.",
    city: "dubai",
    area: "لهباب",
    pricePerNight: "1500",
    weekendPrice: "0",
    capacity: "50",
    lat: "24.7",
    lng: "55.5",
    depositPercent: "25",
    published: "on",
    ...overrides,
  };
  for (const [k, v] of Object.entries(base)) fd.set(k, v);
  return fd;
}

/** An approved owner, signed in, with one listing created through the action. */
async function ownerWithListing(name = "استراحة الرمال الذهبية") {
  const { user, owner } = await createOwner({ email: "o@test.ae", status: "APPROVED" });
  signInAs(user.id);

  const { saveOwnerListing } = await import("@/app/actions/listings");
  const created = await saveOwnerListing(listingForm({ name }));
  expect(created.ok).toBe(true);
  if (!created.ok) throw new Error(created.error);

  return { user, owner, id: created.id!, slug: created.slug! };
}

async function rename(id: string, name: string) {
  const { saveOwnerListing } = await import("@/app/actions/listings");
  const result = await saveOwnerListing(listingForm({ id, name }));
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(result.error);
  return result.slug!;
}

/* -------------------------------------------------------------------------- */
/* the rename redirect                                                        */
/* -------------------------------------------------------------------------- */

describe("a renamed listing keeps its old URL working", () => {
  it("retires the old slug and points it at the new one", async () => {
    const { findListingSlugMove, getListingBySlug } = await import("@/lib/listings");
    const { id, slug: before } = await ownerWithListing();

    const after = await rename(id, "استراحة الكثبان");
    expect(after).not.toBe(before);

    // The old URL is no longer a listing…
    expect(await getListingBySlug(before)).toBeNull();
    // …but it is a move, not a deletion.
    expect(await findListingSlugMove(before)).toBe(after);
  });

  it("chains: two renames both lead to the current URL, not to each other", async () => {
    const { findListingSlugMove } = await import("@/lib/listings");
    const { id, slug: first } = await ownerWithListing();

    const second = await rename(id, "استراحة الكثبان");
    const third = await rename(id, "استراحة النخيل");

    // The point of resolving through the listing rather than following rows:
    // the oldest link reaches the newest URL in one hop, with no redirect chain
    // for a crawler to give up on.
    expect(await findListingSlugMove(first)).toBe(third);
    expect(await findListingSlugMove(second)).toBe(third);
  });

  it("an edit that is not a rename leaves no redirect behind", async () => {
    const { id, slug } = await ownerWithListing();

    const { saveOwnerListing } = await import("@/app/actions/listings");
    await saveOwnerListing(listingForm({ id, pricePerNight: "2200" }));

    expect(await prisma.listingSlug.count()).toBe(0);
    const listing = await prisma.listing.findUnique({ where: { id } });
    expect(listing!.slug).toBe(slug);
  });

  it("renaming back restores the original URL rather than appending -2", async () => {
    const { findListingSlugMove } = await import("@/lib/listings");
    const { id, slug: original } = await ownerWithListing();

    await rename(id, "استراحة الكثبان");
    const restored = await rename(id, "استراحة الرمال الذهبية");

    // A listing's own retired slug must not block it from taking that slug back:
    // "-2" here would mean a rename could never be undone.
    expect(restored).toBe(original);
    // And the stale row is gone — a live URL redirecting to itself is a loop.
    expect(await findListingSlugMove(original)).toBeNull();
  });

  it("never hands a retired slug to a different listing", async () => {
    const { user } = await createOwner({ email: "o@test.ae", status: "APPROVED" });
    signInAs(user.id);

    const { saveOwnerListing } = await import("@/app/actions/listings");
    const first = await saveOwnerListing(listingForm({ name: "استراحة الرمال" }));
    expect(first.ok).toBe(true);
    if (!first.ok) throw new Error(first.error);

    await rename(first.id!, "استراحة الكثبان");

    // A second listing now asks for the name the first one released.
    const second = await saveOwnerListing(listingForm({ name: "استراحة الرمال" }));
    expect(second.ok).toBe(true);
    if (!second.ok) throw new Error(second.error);

    // Were it given the retired slug, the live route would shadow the redirect
    // and everyone holding the first listing's old link would land on the second
    // listing's page.
    expect(second.slug).not.toBe(first.slug);
  });
});

/* -------------------------------------------------------------------------- */
/* the redirect obeys the public predicate                                    */
/* -------------------------------------------------------------------------- */

describe("a redirect never reveals a hidden listing", () => {
  it("stays silent when the destination is unpublished", async () => {
    const { findListingSlugMove } = await import("@/lib/listings");
    const { id, slug: before } = await ownerWithListing();

    await rename(id, "استراحة الكثبان");
    await prisma.listing.update({ where: { id }, data: { published: false } });

    // Redirecting here would send the guest to a page that 404s — a worse answer
    // than the 404 it replaced.
    expect(await findListingSlugMove(before)).toBeNull();
  });

  it("stays silent when the owner's membership has lapsed", async () => {
    const { findListingSlugMove } = await import("@/lib/listings");
    const { owner, id, slug: before } = await ownerWithListing();

    await rename(id, "استراحة الكثبان");
    await prisma.ownerProfile.update({
      where: { id: owner.id },
      data: { membershipExpiresAt: daysFromNow(-1) },
    });

    expect(await findListingSlugMove(before)).toBeNull();
  });
});

/* -------------------------------------------------------------------------- */
/* the short share link                                                       */
/* -------------------------------------------------------------------------- */

describe("the /r/<shortId> share link", () => {
  it("gives every listing a distinct code without the application asking", async () => {
    const a = await createListing({ name: "A" });
    const b = await createListing({ name: "B" });

    // The default is PostgreSQL's, so a create path that never sets one — the
    // seed script, a fixture, either save action — still gets a code.
    expect(a.shortId).toMatch(/^[0-9a-f]{10}$/);
    expect(b.shortId).toMatch(/^[0-9a-f]{10}$/);
    expect(a.shortId).not.toBe(b.shortId);
  });

  it("resolves to the listing's current canonical slug", async () => {
    const { getPublicSlugByShortId } = await import("@/lib/listings");
    const { id } = await ownerWithListing();

    const listing = await prisma.listing.findUnique({ where: { id } });
    expect(await getPublicSlugByShortId(listing!.shortId)).toBe(listing!.slug);

    // A share link survives a rename — it points at the listing, not at a URL.
    const after = await rename(id, "استراحة الكثبان");
    expect(await getPublicSlugByShortId(listing!.shortId)).toBe(after);
  });

  it("is not a side door into a hidden listing", async () => {
    const { getPublicSlugByShortId } = await import("@/lib/listings");
    const { owner } = await createOwner({ email: "lapsed@test.ae", status: "APPROVED" });
    const hidden = await createListing({ ownerId: owner.id });

    await prisma.ownerProfile.update({
      where: { id: owner.id },
      data: { status: "SUSPENDED" },
    });

    expect(await getPublicSlugByShortId(hidden.shortId)).toBeNull();
  });

  it("returns nothing for a code that was never issued", async () => {
    const { getPublicSlugByShortId } = await import("@/lib/listings");
    expect(await getPublicSlugByShortId("deadbeef00")).toBeNull();
  });
});
