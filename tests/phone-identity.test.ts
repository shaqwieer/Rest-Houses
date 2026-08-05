import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  formatPhoneDisplay,
  isValidPhone,
  normalizePhone,
  phoneProblem,
  PHONE_EXAMPLE,
} from "@/lib/phone";
import { createOwner, ensureSchema, prisma, resetDatabase } from "./db";

// `@/lib/auth` calls NextAuth at module scope, and the real module reaches for
// `next/server`, which does not resolve outside a Next runtime. Only the
// construction is stubbed — `mayUseIdentifier` itself is the real function.
vi.mock("next-auth", () => ({
  default: () => ({ handlers: {}, signIn: vi.fn(), signOut: vi.fn(), auth: vi.fn() }),
  AuthError: class AuthError extends Error {},
}));
vi.mock("next-auth/providers/credentials", () => ({ default: () => ({}) }));

const { mayUseIdentifier } = await import("@/lib/auth");

/**
 * Requirements 1 & 2: an owner's username is their phone number, and every
 * phone field on the site accepts and stores that number in one shape.
 *
 * ─── What is actually being defended ─────────────────────────────────────────
 * The failure mode this guards against is silent and total: an owner registers
 * with "+971 50 332 2119", the number is stored in one shape and their username
 * derived in another, and from then on no string they can type signs them in.
 * Nothing errors — the login form says "check your details", which is also what
 * it says for a wrong password. So the tests below assert the *identity* that
 * has to hold, not just that each function returns something plausible.
 */

describe("normalizePhone", () => {
  /**
   * Every shape a person might type for one Emirati mobile, all resolving to
   * the single stored form. This table IS the contract — the SQL backfill in
   * 20260805090000_owner_username_from_phone transcribes these same branches,
   * and if the two ever disagree, owners who registered before that migration
   * can no longer sign in.
   */
  it.each([
    ["+971 50 332 2119", "971503322119", "international, spaced"],
    ["+971503322119", "971503322119", "international, tight"],
    ["00971503322119", "971503322119", "00 access prefix"],
    ["0503322119", "971503322119", "national trunk 0"],
    ["503322119", "971503322119", "bare national"],
    ["971503322119", "971503322119", "already canonical"],
    ["٠٥٠٣٣٢٢١١٩", "971503322119", "Arabic-Indic digits"],
    ["971-50-332-2119", "971503322119", "dashed"],
  ])("%s → %s (%s)", (input, expected) => {
    expect(normalizePhone(input)).toBe(expected);
  });

  /** The documented example must be its own canonical form, or every hint lies. */
  it("leaves the example shown in every placeholder untouched", () => {
    expect(normalizePhone(PHONE_EXAMPLE)).toBe(PHONE_EXAMPLE);
  });

  /**
   * A foreign number keeps its own country code. The platform is Emirati, but
   * silently rewriting a Saudi owner's number to +971 would point every guest
   * at a different person's phone.
   */
  it("leaves a non-UAE country code alone", () => {
    expect(normalizePhone("+966501234567")).toBe("966501234567");
  });

  /** "" is the documented "no number" answer; callers branch on it. */
  it.each([[""], ["   "], ["abc"], [null], [undefined]])(
    "returns an empty string for %p",
    (input) => {
      expect(normalizePhone(input as string | null | undefined)).toBe("");
    },
  );

  /** Normalising an already-normalised value must not change it. */
  it("is idempotent", () => {
    for (const raw of ["+971 50 332 2119", "0503322119", "00966501234567"]) {
      const once = normalizePhone(raw);
      expect(normalizePhone(once)).toBe(once);
    }
  });
});

describe("isValidPhone / phoneProblem", () => {
  it("accepts the shapes a real owner types", () => {
    expect(isValidPhone("+971 50 332 2119")).toBe(true);
    expect(isValidPhone("0503322119")).toBe(true);
    expect(isValidPhone("971503322119")).toBe(true);
  });

  it("rejects something too short to be a number", () => {
    expect(isValidPhone("12345")).toBe(false);
    expect(phoneProblem("12345")).toBe("incomplete");
  });

  it("rejects something too long to be a number", () => {
    expect(isValidPhone("9715033221199999")).toBe(false);
    expect(phoneProblem("9715033221199999")).toBe("invalid");
  });

  /** An empty field is a missing answer, not a wrong one. */
  it("calls an empty field incomplete rather than invalid", () => {
    expect(phoneProblem("")).toBe("incomplete");
  });

  it("reports no problem for a good number", () => {
    expect(phoneProblem("971503322119")).toBeNull();
  });
});

describe("formatPhoneDisplay", () => {
  /**
   * The displayed number must be the stored number with spaces and nothing
   * else — no "+". An owner reading their number off a screen has to be able to
   * type it back in as their username.
   */
  it("shows the stored digits, grouped, with no plus", () => {
    expect(formatPhoneDisplay("971503322119")).toBe("971 50 332 2119");
    expect(formatPhoneDisplay("971503322119").replace(/ /g, "")).toBe("971503322119");
  });

  it("renders nothing for an unusable number, so callers can hide the field", () => {
    expect(formatPhoneDisplay("")).toBe("");
    expect(formatPhoneDisplay("abc")).toBe("");
  });
});

/* -------------------------------------------------------------------------- */
/* Which identifier signs in which role                                       */
/* -------------------------------------------------------------------------- */

/**
 * An owner signs in with their phone number and ONLY their phone number.
 *
 * Their email address is still stored and still shown to the operator — it is
 * how they get in touch — but it stopped being a credential. Two ways into an
 * account when the interface tells you about one is a way in that nobody
 * audits, and it is not what was asked for.
 */
describe("mayUseIdentifier", () => {
  it("lets an owner sign in with their phone number", () => {
    expect(mayUseIdentifier("username", "OWNER")).toBe(true);
  });

  it("refuses an owner signing in with an email address", () => {
    expect(mayUseIdentifier("email", "OWNER")).toBe(false);
  });

  it("lets an operator sign in with an email address", () => {
    expect(mayUseIdentifier("email", "ADMIN")).toBe(true);
  });

  /**
   * Not a case the interface offers — the operator has no phone number to
   * derive a username from — but the rule must not depend on that staying true.
   */
  it("would let an operator sign in with a username if they had one", () => {
    expect(mayUseIdentifier("username", "ADMIN")).toBe(true);
  });

  /**
   * `undefined` is what a lookup that found nothing yields. It must never open
   * the email path, or a missing account would be treated as an operator.
   */
  it("refuses an email address for an account that does not exist", () => {
    expect(mayUseIdentifier("email", undefined)).toBe(false);
  });

  /** Any role nobody has taught this rule about is refused on the email path. */
  it("refuses an email address for an unknown role", () => {
    expect(mayUseIdentifier("email", "SOMETHING_ELSE")).toBe(false);
  });
});

/* -------------------------------------------------------------------------- */
/* The identity that has to hold in the database                              */
/* -------------------------------------------------------------------------- */

describe("owner account identity", () => {
  beforeAll(async () => {
    await ensureSchema();
  });

  beforeEach(async () => {
    await resetDatabase();
  });

  /**
   * The core invariant: an owner's username IS their stored phone number. If
   * these two columns can differ, an owner can be locked out of their own
   * account with nothing on any screen explaining why.
   */
  it("stores the username and the profile phone as the same string", async () => {
    const { user, owner } = await createOwner({
      email: "identity@example.ae",
      whatsapp: "971503322119",
    });

    expect(user.username).toBe("971503322119");
    expect(owner.phone).toBe(user.username);
  });

  /**
   * Whatever an owner types at the login form is normalised before the lookup,
   * so all of these have to find the one account. This is the exact resolution
   * `authorize()` performs — a phone identifier becomes
   * `{ username: normalizePhone(input) }`.
   */
  it("finds the account from any shape the owner might type", async () => {
    await createOwner({ email: "lookup@example.ae", whatsapp: "971503322119" });

    for (const typed of [
      "971503322119",
      "+971 50 332 2119",
      "0503322119",
      "00971503322119",
      "٠٥٠٣٣٢٢١١٩",
    ]) {
      const found = await prisma.user.findUnique({
        where: { username: normalizePhone(typed) },
      });
      expect(found?.email, `login as "${typed}"`).toBe("lookup@example.ae");
    }
  });

  /**
   * The username is unique, which is what makes it usable as a login at all.
   * Registration checks for this and reports it on the field; this asserts the
   * database would refuse it even if that check were bypassed.
   */
  it("refuses a second account on the same number", async () => {
    await createOwner({ email: "first@example.ae", whatsapp: "971503322119" });

    await expect(
      createOwner({ email: "second@example.ae", whatsapp: "971503322119" }),
    ).rejects.toThrow();
  });

  /**
   * The operator's account has no phone number and signs in with an email, so
   * the column has to tolerate NULL — and more than one of them, which is why
   * this is a nullable unique column rather than a defaulted one.
   */
  it("allows several accounts with no username at all", async () => {
    await prisma.user.create({
      data: {
        email: "admin.one@example.ae",
        passwordHash: "x",
        role: "ADMIN",
      },
    });
    await prisma.user.create({
      data: {
        email: "admin.two@example.ae",
        passwordHash: "x",
        role: "ADMIN",
      },
    });

    const admins = await prisma.user.findMany({ where: { role: "ADMIN" } });
    expect(admins).toHaveLength(2);
    expect(admins.every((a) => a.username === null)).toBe(true);
  });
});
