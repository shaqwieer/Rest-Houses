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
 * Requirement 2 & 3: the owner registration → review → approval lifecycle, and
 * the authorisation rules around it.
 *
 * ─── How the session is faked ────────────────────────────────────────────────
 * `src/lib/auth.ts` reads the session through NextAuth's `auth()`, which needs a
 * request context these tests do not have. Only `auth()` is mocked — the guards
 * themselves (`requireAdmin`, `requireApprovedOwner`) run for real, including
 * their database reads. That is deliberate: the thing worth testing is that the
 * guard re-reads status from the database rather than trusting the token, and
 * mocking the guard would test nothing at all.
 */

const sessionUser = vi.hoisted(() => ({ current: null as { id: string } | null }));

vi.mock("next-auth", async () => {
  return {
    default: () => ({
      handlers: {},
      signIn: vi.fn(),
      signOut: vi.fn(),
      auth: async () =>
        sessionUser.current ? { user: { id: sessionUser.current.id } } : null,
    }),
    AuthError: class AuthError extends Error {},
  };
});

vi.mock("next-auth/providers/credentials", () => ({ default: () => ({}) }));

// Server actions call `revalidatePath`, which needs a request scope.
vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
  revalidateTag: vi.fn(),
}));

// `getI18n` reads the locale cookie; outside a request there is none.
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

async function createAdmin(email = "admin@test.ae") {
  return prisma.user.create({
    data: {
      email,
      name: "Admin",
      passwordHash: "$2a$10$testtesttesttesttesttesttesttesttesttesttesttesttestte",
      role: "ADMIN",
    },
  });
}

/* -------------------------------------------------------------------------- */
/* registration                                                               */
/* -------------------------------------------------------------------------- */

describe("owner registration", () => {
  function form(overrides: Record<string, string> = {}) {
    const fd = new FormData();
    const base: Record<string, string> = {
      fullName: "Salem Al Mansouri",
      email: "new.owner@test.ae",
      phone: "+971501234567",
      whatsapp: "+971501234567",
      password: "StrongPass123",
      confirmPassword: "StrongPass123",
      businessName: "Mansouri Rest Houses",
      idNumber: "784-1990-1234567-1",
      city: "dubai",
      about: "Family rest houses in Lahbab.",
      ...overrides,
    };
    for (const [k, v] of Object.entries(base)) fd.set(k, v);
    return fd;
  }

  it("creates an inert PENDING owner, never an active one", async () => {
    const { registerOwner } = await import("@/app/actions/owners");
    const result = await registerOwner(form());
    expect(result.ok).toBe(true);

    const owner = await prisma.ownerProfile.findFirst({
      where: { user: { email: "new.owner@test.ae" } },
      include: { user: true },
    });

    expect(owner).not.toBeNull();
    // The invariant the whole workflow rests on.
    expect(owner!.status).toBe("PENDING");
    expect(owner!.membershipExpiresAt).toBeNull();
    expect(owner!.user.role).toBe("OWNER");
  });

  it("stores the WhatsApp number normalised, ready for a wa.me link", async () => {
    const { registerOwner } = await import("@/app/actions/owners");
    await registerOwner(form({ whatsapp: "050 123 4567" }));

    const owner = await prisma.ownerProfile.findFirst({
      where: { user: { email: "new.owner@test.ae" } },
    });
    expect(owner!.whatsapp).toBe("971501234567");
  });

  it("hashes the password rather than storing it", async () => {
    const { registerOwner } = await import("@/app/actions/owners");
    await registerOwner(form());

    const user = await prisma.user.findUnique({ where: { email: "new.owner@test.ae" } });
    expect(user!.passwordHash).not.toContain("StrongPass123");
    expect(user!.passwordHash.startsWith("$2")).toBe(true);
  });

  it("writes an audit entry naming the new owner as the actor", async () => {
    const { registerOwner } = await import("@/app/actions/owners");
    await registerOwner(form());

    const log = await prisma.auditLog.findFirst({ where: { action: "OWNER_REGISTERED" } });
    expect(log).not.toBeNull();
    expect(log!.actorEmail).toBe("new.owner@test.ae");
  });

  it("rejects a duplicate email without creating a second account", async () => {
    const { registerOwner } = await import("@/app/actions/owners");
    await registerOwner(form());
    const second = await registerOwner(form());

    expect(second.ok).toBe(false);
    expect(await prisma.user.count({ where: { email: "new.owner@test.ae" } })).toBe(1);
  });

  it("rejects mismatched passwords, a short password and a bad WhatsApp number", async () => {
    const { registerOwner } = await import("@/app/actions/owners");

    const mismatch = await registerOwner(form({ confirmPassword: "Different123" }));
    expect(mismatch.ok).toBe(false);

    const short = await registerOwner(
      form({ email: "b@test.ae", password: "abc", confirmPassword: "abc" }),
    );
    expect(short.ok).toBe(false);

    const badWhatsapp = await registerOwner(form({ email: "c@test.ae", whatsapp: "12" }));
    expect(badWhatsapp.ok).toBe(false);

    expect(await prisma.ownerProfile.count()).toBe(0);
  });

  it("does not let a registration set its own status or membership", async () => {
    const { registerOwner } = await import("@/app/actions/owners");
    const fd = form();
    // Mass-assignment attempt.
    fd.set("status", "APPROVED");
    fd.set("membershipExpiresAt", "2099-01-01");

    await registerOwner(fd);

    const owner = await prisma.ownerProfile.findFirst({
      where: { user: { email: "new.owner@test.ae" } },
    });
    expect(owner!.status).toBe("PENDING");
    expect(owner!.membershipExpiresAt).toBeNull();
  });
});

/* -------------------------------------------------------------------------- */
/* admin review                                                               */
/* -------------------------------------------------------------------------- */

describe("admin approval workflow", () => {
  it("approves an owner and sets a membership window", async () => {
    const admin = await createAdmin();
    const { owner } = await createOwner({
      email: "pending@test.ae",
      status: "PENDING",
      membershipExpiresAt: null,
    });

    signInAs(admin.id);
    const { approveOwner } = await import("@/app/actions/owners");
    const result = await approveOwner(owner.id, 12);
    expect(result.ok).toBe(true);

    const after = await prisma.ownerProfile.findUnique({ where: { id: owner.id } });
    expect(after!.status).toBe("APPROVED");
    expect(after!.membershipExpiresAt).not.toBeNull();
    expect(after!.membershipExpiresAt!.getTime()).toBeGreaterThan(Date.now());
    expect(after!.reviewedById).toBe(admin.id);
  });

  it("rejects an owner with a reason, and the reason is stored", async () => {
    const admin = await createAdmin();
    const { owner } = await createOwner({
      email: "pending@test.ae",
      status: "PENDING",
      membershipExpiresAt: null,
    });

    signInAs(admin.id);
    const { rejectOwner } = await import("@/app/actions/owners");
    const result = await rejectOwner(owner.id, "Documents incomplete");
    expect(result.ok).toBe(true);

    const after = await prisma.ownerProfile.findUnique({ where: { id: owner.id } });
    expect(after!.status).toBe("REJECTED");
    expect(after!.rejectionReason).toBe("Documents incomplete");
  });

  it("allows a rejection with no reason", async () => {
    const admin = await createAdmin();
    const { owner } = await createOwner({ email: "p@test.ae", status: "PENDING" });

    signInAs(admin.id);
    const { rejectOwner } = await import("@/app/actions/owners");
    expect((await rejectOwner(owner.id)).ok).toBe(true);

    const after = await prisma.ownerProfile.findUnique({ where: { id: owner.id } });
    expect(after!.status).toBe("REJECTED");
    expect(after!.rejectionReason).toBeNull();
  });

  it("clears a stale rejection reason when the owner is later approved", async () => {
    const admin = await createAdmin();
    const { owner } = await createOwner({ email: "p@test.ae", status: "PENDING" });
    signInAs(admin.id);

    const { rejectOwner, approveOwner } = await import("@/app/actions/owners");
    await rejectOwner(owner.id, "Missing licence");
    await approveOwner(owner.id);

    const after = await prisma.ownerProfile.findUnique({ where: { id: owner.id } });
    expect(after!.status).toBe("APPROVED");
    expect(after!.rejectionReason).toBeNull();
  });

  it("suspends and reactivates without touching Listing.published", async () => {
    const admin = await createAdmin();
    const { owner } = await createOwner({ email: "o@test.ae", status: "APPROVED" });
    const live = await createListing({ ownerId: owner.id, published: true });
    const draft = await createListing({ ownerId: owner.id, published: false });

    signInAs(admin.id);
    const { setOwnerSuspended } = await import("@/app/actions/owners");

    await setOwnerSuspended(owner.id, true);
    expect((await prisma.ownerProfile.findUnique({ where: { id: owner.id } }))!.status).toBe(
      "SUSPENDED",
    );
    // The owner's own publish intent survives suspension untouched.
    expect((await prisma.listing.findUnique({ where: { id: live.id } }))!.published).toBe(true);
    expect((await prisma.listing.findUnique({ where: { id: draft.id } }))!.published).toBe(false);

    await setOwnerSuspended(owner.id, false);
    expect((await prisma.ownerProfile.findUnique({ where: { id: owner.id } }))!.status).toBe(
      "APPROVED",
    );
    expect((await prisma.listing.findUnique({ where: { id: draft.id } }))!.published).toBe(false);
  });

  it("sets and clears the membership expiry", async () => {
    const admin = await createAdmin();
    const { owner } = await createOwner({ email: "o@test.ae" });
    signInAs(admin.id);

    const { setOwnerMembershipExpiry } = await import("@/app/actions/owners");

    expect((await setOwnerMembershipExpiry(owner.id, "2030-06-30")).ok).toBe(true);
    const set = await prisma.ownerProfile.findUnique({ where: { id: owner.id } });
    // Parsed as UTC midnight, so the stored day is the day that was typed.
    expect(set!.membershipExpiresAt!.toISOString().slice(0, 10)).toBe("2030-06-30");

    expect((await setOwnerMembershipExpiry(owner.id, "")).ok).toBe(true);
    const cleared = await prisma.ownerProfile.findUnique({ where: { id: owner.id } });
    expect(cleared!.membershipExpiresAt).toBeNull();
  });

  it("refuses an unparseable expiry date", async () => {
    const admin = await createAdmin();
    const { owner } = await createOwner({ email: "o@test.ae" });
    signInAs(admin.id);

    const { setOwnerMembershipExpiry } = await import("@/app/actions/owners");
    expect((await setOwnerMembershipExpiry(owner.id, "not-a-date")).ok).toBe(false);
  });

  it("writes an audit row inside the same transaction as each change", async () => {
    const admin = await createAdmin();
    const { owner } = await createOwner({ email: "o@test.ae", status: "PENDING" });
    signInAs(admin.id);

    const { approveOwner, setOwnerSuspended, setOwnerMembershipExpiry, rejectOwner } =
      await import("@/app/actions/owners");

    await approveOwner(owner.id);
    await setOwnerSuspended(owner.id, true);
    await setOwnerSuspended(owner.id, false);
    await setOwnerMembershipExpiry(owner.id, "2031-01-01");
    await rejectOwner(owner.id, "later rejected");

    const actions = (
      await prisma.auditLog.findMany({ orderBy: { createdAt: "asc" } })
    ).map((r) => r.action);

    expect(actions).toContain("OWNER_APPROVED");
    expect(actions).toContain("OWNER_SUSPENDED");
    expect(actions).toContain("OWNER_ACTIVATED");
    expect(actions).toContain("MEMBERSHIP_UPDATED");
    expect(actions).toContain("OWNER_REJECTED");

    const entry = await prisma.auditLog.findFirst({ where: { action: "OWNER_APPROVED" } });
    expect(entry!.actorEmail).toBe("admin@test.ae");
    expect(entry!.entityId).toBe(owner.id);
  });
});

/* -------------------------------------------------------------------------- */
/* authorisation                                                              */
/* -------------------------------------------------------------------------- */

describe("authorisation", () => {
  it("a signed-out visitor cannot approve, suspend or set membership", async () => {
    const { owner } = await createOwner({ email: "o@test.ae", status: "PENDING" });
    signInAs(null);

    const { approveOwner, rejectOwner, setOwnerSuspended, setOwnerMembershipExpiry } =
      await import("@/app/actions/owners");

    expect((await approveOwner(owner.id)).ok).toBe(false);
    expect((await rejectOwner(owner.id, "no")).ok).toBe(false);
    expect((await setOwnerSuspended(owner.id, true)).ok).toBe(false);
    expect((await setOwnerMembershipExpiry(owner.id, "2030-01-01")).ok).toBe(false);

    // Nothing changed.
    expect((await prisma.ownerProfile.findUnique({ where: { id: owner.id } }))!.status).toBe(
      "PENDING",
    );
  });

  /**
   * The highest-severity case. Before this change `requireAdmin()` checked only
   * that *a* session existed — so any signed-in owner would have passed it.
   */
  it("an OWNER cannot use the admin actions, even while signed in", async () => {
    const attacker = await createOwner({ email: "attacker@test.ae", status: "APPROVED" });
    const victim = await createOwner({ email: "victim@test.ae", status: "PENDING" });

    signInAs(attacker.user.id);
    const { approveOwner, setOwnerSuspended, setOwnerMembershipExpiry } = await import(
      "@/app/actions/owners"
    );

    expect((await approveOwner(victim.owner.id)).ok).toBe(false);
    expect((await setOwnerSuspended(victim.owner.id, true)).ok).toBe(false);
    expect((await setOwnerMembershipExpiry(victim.owner.id, "2030-01-01")).ok).toBe(false);

    // Nor can they approve themselves.
    expect((await approveOwner(attacker.owner.id)).ok).toBe(false);

    expect((await prisma.ownerProfile.findUnique({ where: { id: victim.owner.id } }))!.status).toBe(
      "PENDING",
    );
  });

  it("a suspension takes effect immediately, without waiting for the token to expire", async () => {
    const admin = await createAdmin();
    const { user, owner } = await createOwner({ email: "o@test.ae", status: "APPROVED" });

    // The owner can act.
    signInAs(user.id);
    const { requireApprovedOwner } = await import("@/lib/auth");
    await expect(requireApprovedOwner()).resolves.toBeTruthy();

    // An admin suspends them.
    signInAs(admin.id);
    const { setOwnerSuspended } = await import("@/app/actions/owners");
    await setOwnerSuspended(owner.id, true);

    // The same session — the same "token" — is now refused, because the guard
    // re-reads the database rather than trusting the session.
    signInAs(user.id);
    await expect(requireApprovedOwner()).rejects.toThrow();
  });

  it("an expired membership blocks the owner guard", async () => {
    const { user } = await createOwner({
      email: "expired@test.ae",
      status: "APPROVED",
      membershipExpiresAt: daysFromNow(-1),
    });
    signInAs(user.id);

    const { requireApprovedOwner } = await import("@/lib/auth");
    await expect(requireApprovedOwner()).rejects.toThrow();
  });

  it("a PENDING owner cannot reach protected owner features", async () => {
    const { user } = await createOwner({
      email: "pending@test.ae",
      status: "PENDING",
      membershipExpiresAt: null,
    });
    signInAs(user.id);

    const { requireApprovedOwner } = await import("@/lib/auth");
    await expect(requireApprovedOwner()).rejects.toThrow();
  });

  it("an ADMIN is not an owner and vice versa", async () => {
    const admin = await createAdmin();
    const { user } = await createOwner({ email: "o@test.ae", status: "APPROVED" });

    const { requireAdmin, requireApprovedOwner } = await import("@/lib/auth");

    signInAs(admin.id);
    await expect(requireAdmin()).resolves.toBeTruthy();
    await expect(requireApprovedOwner()).rejects.toThrow();

    signInAs(user.id);
    await expect(requireAdmin()).rejects.toThrow();
    await expect(requireApprovedOwner()).resolves.toBeTruthy();
  });
});

/* -------------------------------------------------------------------------- */
/* owner listing actions                                                      */
/* -------------------------------------------------------------------------- */

describe("owner listing publishing", () => {
  function listingForm(overrides: Record<string, string> = {}) {
    const fd = new FormData();
    const base: Record<string, string> = {
      name: "New Rest House",
      description: "A description.",
      city: "dubai",
      area: "Lahbab",
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

  it("an approved owner can create a listing, owned by them", async () => {
    const { user, owner } = await createOwner({ email: "o@test.ae", status: "APPROVED" });
    signInAs(user.id);

    const { saveOwnerListing } = await import("@/app/actions/listings");
    const result = await saveOwnerListing(listingForm());
    expect(result.ok).toBe(true);

    const listing = await prisma.listing.findFirst({ where: { name: "New Rest House" } });
    expect(listing!.ownerId).toBe(owner.id);
    expect(listing!.depositPercent).toBe(25);
  });

  it("a PENDING owner cannot publish a listing", async () => {
    const { user } = await createOwner({
      email: "pending@test.ae",
      status: "PENDING",
      membershipExpiresAt: null,
    });
    signInAs(user.id);

    const { saveOwnerListing } = await import("@/app/actions/listings");
    const result = await saveOwnerListing(listingForm());

    expect(result.ok).toBe(false);
    expect(await prisma.listing.count()).toBe(0);
  });

  it("a REJECTED, SUSPENDED or EXPIRED owner cannot publish a listing", async () => {
    const { saveOwnerListing } = await import("@/app/actions/listings");

    for (const [email, status, expiry] of [
      ["rejected@test.ae", "REJECTED", null],
      ["suspended@test.ae", "SUSPENDED", undefined],
      ["expired@test.ae", "APPROVED", daysFromNow(-1)],
    ] as const) {
      const { user } = await createOwner({
        email,
        status,
        ...(expiry === undefined ? {} : { membershipExpiresAt: expiry }),
      });
      signInAs(user.id);
      expect((await saveOwnerListing(listingForm({ name: `L-${email}` }))).ok).toBe(false);
    }

    expect(await prisma.listing.count()).toBe(0);
  });

  /** IDOR: an owner must not be able to edit or delete another owner's listing. */
  it("an owner cannot edit or delete a listing that isn't theirs", async () => {
    const a = await createOwner({ email: "a@test.ae", status: "APPROVED" });
    const b = await createOwner({ email: "b@test.ae", status: "APPROVED" });
    const victim = await createListing({ name: "Owned by B", ownerId: b.owner.id });

    signInAs(a.user.id);
    const { saveOwnerListing, deleteOwnerListing, toggleOwnerListingPublished } = await import(
      "@/app/actions/listings"
    );

    const edit = await saveOwnerListing(listingForm({ id: victim.id, name: "Hijacked" }));
    expect(edit.ok).toBe(false);

    expect((await toggleOwnerListingPublished(victim.id)).ok).toBe(false);
    expect((await deleteOwnerListing(victim.id)).ok).toBe(false);

    const after = await prisma.listing.findUnique({ where: { id: victim.id } });
    expect(after).not.toBeNull();
    expect(after!.name).toBe("Owned by B");
  });

  /**
   * `verified` and `featured` are editorial badges the platform grants. An
   * owner self-featuring would put their own listing on the home page.
   */
  it("an owner cannot set the verified or featured badges on themselves", async () => {
    const { user } = await createOwner({ email: "o@test.ae", status: "APPROVED" });
    signInAs(user.id);

    const { saveOwnerListing } = await import("@/app/actions/listings");
    await saveOwnerListing(listingForm({ verified: "on", featured: "on" }));

    const listing = await prisma.listing.findFirst({ where: { name: "New Rest House" } });
    expect(listing!.verified).toBe(false);
    expect(listing!.featured).toBe(false);
  });

  it("rejects a deposit percentage outside 0–100", async () => {
    const { user } = await createOwner({ email: "o@test.ae", status: "APPROVED" });
    signInAs(user.id);

    const { saveOwnerListing } = await import("@/app/actions/listings");

    for (const bad of ["101", "-5", "1000", "abc", "12.5"]) {
      const result = await saveOwnerListing(
        listingForm({ depositPercent: bad, name: `Bad ${bad}` }),
      );
      expect(result.ok).toBe(false);
    }

    expect(await prisma.listing.count()).toBe(0);
  });

  it("accepts the boundary values and treats blank as 'use the default'", async () => {
    const { user } = await createOwner({ email: "o@test.ae", status: "APPROVED" });
    signInAs(user.id);
    const { saveOwnerListing } = await import("@/app/actions/listings");

    expect((await saveOwnerListing(listingForm({ name: "Zero", depositPercent: "0" }))).ok).toBe(
      true,
    );
    expect(
      (await saveOwnerListing(listingForm({ name: "Hundred", depositPercent: "100" }))).ok,
    ).toBe(true);
    expect((await saveOwnerListing(listingForm({ name: "Blank", depositPercent: "" }))).ok).toBe(
      true,
    );

    expect((await prisma.listing.findFirst({ where: { name: "Zero" } }))!.depositPercent).toBe(0);
    expect((await prisma.listing.findFirst({ where: { name: "Hundred" } }))!.depositPercent).toBe(
      100,
    );
    // Blank is null — "use the platform default" — NOT 0.
    expect((await prisma.listing.findFirst({ where: { name: "Blank" } }))!.depositPercent).toBeNull();
  });
});

/* -------------------------------------------------------------------------- */
/* dashboard routing — the /admin ⇄ /owner redirect loop                      */
/* -------------------------------------------------------------------------- */

/**
 * `/admin` and `/owner` each used to infer where a stranger belonged from the
 * other's absence — "not an ADMIN, so you must be an owner" and "no profile, so
 * you must be an admin". Both hold for every account anyone tests with, and
 * neither handles an account that is *neither*, which bounced between the two
 * dashboards until the browser gave up with ERR_TOO_MANY_REDIRECTS. /login was
 * pulled in too, because it forwarded any signed-in visitor to /admin.
 *
 * `dashboardForSession()` is now the single answer all three redirect on, and
 * returning null — "belongs to no dashboard, send them to the login form" — is
 * the case that breaks the cycle. These tests exist for the two null branches;
 * the others are here so a future "simplification" that drops them fails loudly.
 */
describe("dashboard routing", () => {
  it("sends an admin to /admin", async () => {
    const admin = await createAdmin();
    signInAs(admin.id);
    const { dashboardForSession } = await import("@/lib/auth");
    expect(await dashboardForSession()).toBe("/admin");
  });

  it("sends an owner to /owner in every account state, not just APPROVED", async () => {
    const { dashboardForSession } = await import("@/lib/auth");

    // A pending, rejected, suspended or expired owner still *belongs* on
    // /owner — the layout shows them the status panel there. Routing them
    // anywhere else is what the loop was made of.
    for (const status of ["APPROVED", "PENDING", "REJECTED", "SUSPENDED"]) {
      const { user } = await createOwner({ email: `${status.toLowerCase()}@test.ae`, status });
      signInAs(user.id);
      expect(await dashboardForSession()).toBe("/owner");
    }

    const { user: lapsed } = await createOwner({
      email: "lapsed@test.ae",
      status: "APPROVED",
      membershipExpiresAt: daysFromNow(-1),
    });
    signInAs(lapsed.id);
    expect(await dashboardForSession()).toBe("/owner");
  });

  it("sends a session whose user row is gone to neither dashboard", async () => {
    // A 30-day JWT outliving the row it names: the database was reset or
    // re-seeded (new cuids), or the account was deleted while signed in.
    const admin = await createAdmin();
    signInAs(admin.id);
    await prisma.user.delete({ where: { id: admin.id } });

    const { dashboardForSession } = await import("@/lib/auth");
    expect(await dashboardForSession()).toBeNull();
  });

  it("sends an OWNER with no profile to neither dashboard", async () => {
    const { user } = await createOwner({ email: "orphan@test.ae" });
    await prisma.ownerProfile.delete({ where: { userId: user.id } });
    signInAs(user.id);

    const { dashboardForSession } = await import("@/lib/auth");
    expect(await dashboardForSession()).toBeNull();
  });

  it("sends a signed-out visitor to neither dashboard", async () => {
    signInAs(null);
    const { dashboardForSession } = await import("@/lib/auth");
    expect(await dashboardForSession()).toBeNull();
  });

  it("never returns a dashboard that would redirect the account away again", async () => {
    // The invariant, stated directly: whatever `dashboardForAccount` names must
    // be somewhere that account is allowed to stay. Two destinations and a
    // null, so an exhaustive table is cheap — and any future role added without
    // a home defaults to null rather than to a redirect target.
    const { dashboardForAccount } = await import("@/lib/auth");
    const profile = { id: "profile-1" };

    expect(dashboardForAccount({ role: "ADMIN", ownerProfile: null })).toBe("/admin");
    expect(dashboardForAccount({ role: "ADMIN", ownerProfile: profile })).toBe("/admin");
    expect(dashboardForAccount({ role: "OWNER", ownerProfile: profile })).toBe("/owner");
    expect(dashboardForAccount({ role: "OWNER", ownerProfile: null })).toBeNull();
    expect(dashboardForAccount({ role: "SOMETHING_NEW", ownerProfile: null })).toBeNull();
    expect(dashboardForAccount(null)).toBeNull();
  });
});
