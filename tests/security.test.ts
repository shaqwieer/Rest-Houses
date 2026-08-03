import { createHash } from "node:crypto";
import { beforeAll, beforeEach, afterAll, describe, expect, it, vi } from "vitest";
import { createListing, ensureSchema, prisma, resetDatabase, seedSettings } from "./db";
import { humanCheckFields } from "./human-check";
import { sha256Hex, leadingZeroBits } from "@/lib/security/sha256";
import {
  consume,
  mintChallenge,
  resetRateLimits,
  resetSpentChallenges,
  solveChallenge,
} from "@/lib/security";
import { verifyChallenge } from "@/lib/security/challenge";
import { addDays, todayISO } from "@/lib/dates";

/**
 * Requirement 8: the booking form and the owner registration form are protected
 * against automated submission.
 *
 * These drive the real server actions with the real gate — there is no test
 * bypass to switch off — so a regression that disables any layer shows up as a
 * failure here rather than as spam in production.
 */

vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }));

// `registerOwner` lives in a module that also exports the admin actions, so
// importing it pulls in @/lib/auth → NextAuth, which needs a request context
// these tests do not have. Only the library is stubbed; the gate under test runs
// for real. Mirrors the mock in tests/owner-workflow.test.ts.
vi.mock("next-auth", () => ({
  default: () => ({ handlers: {}, signIn: vi.fn(), signOut: vi.fn(), auth: async () => null }),
  AuthError: class AuthError extends Error {},
}));
vi.mock("next-auth/providers/credentials", () => ({ default: () => ({}) }));

vi.mock("@/lib/i18n/server", async () => {
  const { ar } = await import("@/lib/i18n/ar");
  return {
    getLocale: async () => "ar",
    getT: async () => ar,
    getDir: async () => "rtl",
    getI18n: async () => ({ locale: "ar", t: ar, dir: "rtl" }),
  };
});

beforeAll(() => {
  ensureSchema();
});

afterAll(async () => {
  await prisma.$disconnect();
});

beforeEach(async () => {
  await resetDatabase();
  await seedSettings({ depositPercent: 30 });
  resetRateLimits();
  resetSpentChallenges();
});

function stay(offset = 7, nights = 2) {
  const checkIn = addDays(todayISO(), offset);
  return { checkIn, checkOut: addDays(checkIn, nights) };
}

function bookingForm(
  listingId: string,
  opts: { checkIn: string; checkOut: string } & Record<string, string>,
) {
  const fd = new FormData();
  fd.set("listingId", listingId);
  fd.set("checkIn", opts.checkIn);
  fd.set("checkOut", opts.checkOut);
  fd.set("guests", opts.guests ?? "10");
  fd.set("customerName", opts.customerName ?? "Khalid Al Mansouri");
  fd.set("customerPhone", opts.customerPhone ?? "+971502148890");
  fd.set("customerEmail", "");
  fd.set("notes", "");
  for (const [k, v] of Object.entries(humanCheckFields("booking"))) fd.set(k, v);
  return fd;
}

/* -------------------------------------------------------------------------- */

describe("SHA-256 used by the human check", () => {
  /**
   * The browser searches for a solution with our own implementation; the server
   * verifies it with Node's. If the two ever disagreed, every submission from a
   * real visitor would be rejected — so this is the assertion the whole built-in
   * check rests on.
   */
  it("agrees with node:crypto, including on non-ASCII input", () => {
    for (const input of ["", "a", "abc", "0".repeat(55), "0".repeat(56), "0".repeat(64), "استراحة"]) {
      expect(sha256Hex(input)).toBe(createHash("sha256").update(input).digest("hex"));
    }
  });

  it("counts leading zero bits, not characters", () => {
    expect(leadingZeroBits("f000")).toBe(0);
    expect(leadingZeroBits("8000")).toBe(0);
    expect(leadingZeroBits("7fff")).toBe(1);
    expect(leadingZeroBits("0fff")).toBe(4);
    expect(leadingZeroBits("00ff")).toBe(8);
    expect(leadingZeroBits("000f")).toBe(12);
  });
});

describe("challenge tokens", () => {
  it("accepts a token this server signed, with a correct solution", () => {
    const { token } = mintChallenge("booking", Date.now() - 5_000);
    const result = verifyChallenge(token, solveChallenge(token), "booking");
    expect(result.ok).toBe(true);
  });

  it("refuses a token minted for a different form", () => {
    const { token } = mintChallenge("owner-register", Date.now() - 5_000);
    const result = verifyChallenge(token, solveChallenge(token), "booking");
    expect(result.ok).toBe(false);
  });

  it("refuses a tampered signature", () => {
    const { token } = mintChallenge("booking", Date.now() - 5_000);
    const solution = solveChallenge(token);
    // Move the difficulty down; the signature no longer covers what is claimed.
    const parts = token.split(".");
    parts[4] = "1";
    expect(verifyChallenge(parts.join("."), solution, "booking").ok).toBe(false);
  });

  it("refuses a wrong or absent proof of work", () => {
    const { token } = mintChallenge("booking", Date.now() - 5_000);
    expect(verifyChallenge(token, "", "booking")).toEqual({ ok: false, reason: "unsolved" });
    expect(verifyChallenge(token, "1", "booking")).toEqual({ ok: false, reason: "unsolved" });
  });

  it("refuses a submission that arrives too fast to be human", () => {
    const { token } = mintChallenge("booking");
    expect(verifyChallenge(token, solveChallenge(token), "booking")).toEqual({
      ok: false,
      reason: "too-fast",
    });
  });

  it("refuses a token minted hours ago", () => {
    const { token } = mintChallenge("booking", Date.now() - 4 * 60 * 60 * 1000);
    expect(verifyChallenge(token, solveChallenge(token), "booking")).toEqual({
      ok: false,
      reason: "expired",
    });
  });
});

describe("rate limiting", () => {
  it("allows up to the limit and then refuses, with a retry hint", () => {
    const rule = { name: "test", limit: 3, windowMs: 60_000 };
    expect(consume(rule, "1.2.3.4").allowed).toBe(true);
    expect(consume(rule, "1.2.3.4").allowed).toBe(true);
    expect(consume(rule, "1.2.3.4").allowed).toBe(true);

    const blocked = consume(rule, "1.2.3.4");
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfter).toBeGreaterThan(0);

    // A different caller has their own budget.
    expect(consume(rule, "5.6.7.8").allowed).toBe(true);
  });

  it("fails open when the caller cannot be identified", () => {
    const rule = { name: "test-open", limit: 1, windowMs: 60_000 };
    // A missing x-forwarded-for must never lock the site — see the note in
    // src/lib/security/rate-limit.ts.
    for (let i = 0; i < 10; i++) {
      expect(consume(rule, null).allowed).toBe(true);
    }
  });

  it("starts a fresh window once the old one has passed", () => {
    const rule = { name: "test-window", limit: 1, windowMs: 1_000 };
    const t0 = 1_000_000;
    expect(consume(rule, "9.9.9.9", t0).allowed).toBe(true);
    expect(consume(rule, "9.9.9.9", t0 + 500).allowed).toBe(false);
    expect(consume(rule, "9.9.9.9", t0 + 1_500).allowed).toBe(true);
  });
});

describe("the booking form's gate", () => {
  it("refuses a submission with no challenge at all", async () => {
    const listing = await createListing();
    const fd = bookingForm(listing.id, stay());
    fd.delete("securityToken");
    fd.delete("humanProof");

    const { createBookingRequest } = await import("@/app/actions/booking");
    const result = await createBookingRequest(fd);

    expect(result.ok).toBe(false);
    expect(await prisma.bookingRequest.count()).toBe(0);
  });

  it("refuses a submission whose honeypot was filled in", async () => {
    const listing = await createListing();
    const fd = bookingForm(listing.id, stay());
    // No human can reach this field — it is off-screen and out of the tab order.
    fd.set("websiteUrl", "http://spam.example");

    const { createBookingRequest } = await import("@/app/actions/booking");
    expect((await createBookingRequest(fd)).ok).toBe(false);
    expect(await prisma.bookingRequest.count()).toBe(0);
  });

  it("refuses a challenge that has already been spent", async () => {
    const listing = await createListing();
    const { createBookingRequest } = await import("@/app/actions/booking");

    const first = bookingForm(listing.id, stay(7));
    expect((await createBookingRequest(first)).ok).toBe(true);

    // Same token, different dates: the replay is what is being refused, not the
    // duplicate booking.
    const replay = bookingForm(listing.id, stay(40));
    replay.set("securityToken", first.get("securityToken") as string);
    replay.set("humanProof", first.get("humanProof") as string);

    expect((await createBookingRequest(replay)).ok).toBe(false);
    expect(await prisma.bookingRequest.count()).toBe(1);
  });

  it("caps how many requests one phone number can send in an hour", async () => {
    const listing = await createListing();
    const { createBookingRequest } = await import("@/app/actions/booking");

    // Five is the budget in RATE_RULES.booking.identity; each uses different
    // dates so nothing is refused as a duplicate instead.
    for (let i = 0; i < 5; i++) {
      const result = await createBookingRequest(bookingForm(listing.id, stay(7 + i * 3)));
      expect(result.ok).toBe(true);
    }

    const sixth = await createBookingRequest(bookingForm(listing.id, stay(60)));
    expect(sixth.ok).toBe(false);
    expect(await prisma.bookingRequest.count()).toBe(5);

    // A different guest on the same connection is unaffected — the budget is per
    // phone number, and the IP budget fails open when there is no proxy header.
    const other = await createBookingRequest(
      bookingForm(listing.id, { ...stay(70), customerPhone: "+971509999888" }),
    );
    expect(other.ok).toBe(true);
  });

  it("refuses a second identical request while the first is still NEW", async () => {
    const listing = await createListing();
    const { createBookingRequest } = await import("@/app/actions/booking");
    const dates = stay(9);

    expect((await createBookingRequest(bookingForm(listing.id, dates))).ok).toBe(true);
    // A fresh challenge, so this is the duplicate guard talking, not the replay
    // check.
    expect((await createBookingRequest(bookingForm(listing.id, dates))).ok).toBe(false);
    expect(await prisma.bookingRequest.count()).toBe(1);
  });

  it("lets the guest ask again once the owner has rejected the first request", async () => {
    const listing = await createListing();
    const { createBookingRequest } = await import("@/app/actions/booking");
    const dates = stay(11);

    await createBookingRequest(bookingForm(listing.id, dates));
    await prisma.bookingRequest.updateMany({ data: { status: "REJECTED" } });

    expect((await createBookingRequest(bookingForm(listing.id, dates))).ok).toBe(true);
    expect(await prisma.bookingRequest.count()).toBe(2);
  });
});

describe("the registration form's gate", () => {
  function registrationForm(overrides: Record<string, string> = {}) {
    const fd = new FormData();
    const base: Record<string, string> = {
      fullName: "Salem Al Mansouri",
      email: "gate@test.ae",
      phone: "+971501234567",
      whatsapp: "+971501234567",
      password: "StrongPass123",
      confirmPassword: "StrongPass123",
      ...overrides,
    };
    for (const [k, v] of Object.entries(base)) fd.set(k, v);
    for (const [k, v] of Object.entries(humanCheckFields("owner-register"))) fd.set(k, v);
    return fd;
  }

  it("creates no account when the challenge is missing", async () => {
    const fd = registrationForm();
    fd.delete("securityToken");

    const { registerOwner } = await import("@/app/actions/owners");
    expect((await registerOwner(fd)).ok).toBe(false);
    expect(await prisma.user.count()).toBe(0);
  });

  it("creates no account when the honeypot was filled in", async () => {
    const fd = registrationForm();
    fd.set("websiteUrl", "spam");

    const { registerOwner } = await import("@/app/actions/owners");
    expect((await registerOwner(fd)).ok).toBe(false);
    expect(await prisma.user.count()).toBe(0);
  });

  it("refuses a booking token presented to the registration form", async () => {
    const fd = registrationForm();
    const { token } = mintChallenge("booking", Date.now() - 5_000);
    fd.set("securityToken", token);
    fd.set("humanProof", solveChallenge(token));

    const { registerOwner } = await import("@/app/actions/owners");
    expect((await registerOwner(fd)).ok).toBe(false);
    expect(await prisma.user.count()).toBe(0);
  });

  it("still lets a genuine registration through", async () => {
    const { registerOwner } = await import("@/app/actions/owners");
    expect((await registerOwner(registrationForm())).ok).toBe(true);
    expect(await prisma.user.count()).toBe(1);
  });
});
