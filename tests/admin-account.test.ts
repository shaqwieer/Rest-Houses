import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import bcrypt from "bcryptjs";
import { ensureSchema, prisma, resetDatabase } from "./db";

/**
 * Requirement 6: the operator can edit their own account and password.
 *
 * ─── The rule these tests exist for ──────────────────────────────────────────
 * A password change requires the CURRENT password, verified against the stored
 * hash. The admin-facing `setOwnerPassword` deliberately does not ask for one —
 * an operator resetting a locked-out owner's password cannot possibly supply
 * it — and copying that shape onto self-service would turn any borrowed session
 * into permanent account takeover: set a new password, and the real operator is
 * locked out of the platform entirely.
 *
 * So the negative cases below matter more than the positive one, and each
 * asserts the same two things: the call was refused, AND the stored hash did
 * not move. A "returns an error" test that never checks the database would pass
 * against an implementation that wrote first and complained afterwards.
 */

/**
 * Only `auth()` is faked — the guards themselves (`requireAdmin`) run for real,
 * including their database reads. That is the point: what is worth testing is
 * that the guard re-reads the role from the database rather than trusting the
 * token, and mocking the guard would test nothing. Same shape as
 * tests/owner-workflow.test.ts; next-auth is replaced outright rather than
 * spread over, because importing the real module pulls in `next/server`.
 */
const sessionUser = vi.hoisted(() => ({ current: null as { id: string } | null }));

vi.mock("next-auth", () => ({
  default: () => ({
    handlers: {},
    signIn: vi.fn(),
    signOut: vi.fn(),
    auth: async () =>
      sessionUser.current ? { user: { id: sessionUser.current.id } } : null,
  }),
  AuthError: class AuthError extends Error {},
}));

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

const { changeAdminPassword, updateAdminProfile } = await import(
  "@/app/actions/admin-account"
);

const CURRENT = "AdminPass123!";

async function createAdmin(email = "boss@example.ae", name = "أبو سلطان") {
  const user = await prisma.user.create({
    data: {
      email,
      name,
      passwordHash: await bcrypt.hash(CURRENT, 10),
      role: "ADMIN",
    },
  });
  sessionUser.current = { id: user.id };
  return user;
}

/** The stored hash right now — the thing every negative case must find unchanged. */
async function hashOf(id: string) {
  const row = await prisma.user.findUnique({ where: { id }, select: { passwordHash: true } });
  return row!.passwordHash;
}

function formData(fields: Record<string, string>) {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fd;
}

beforeAll(async () => {
  await ensureSchema();
});

beforeEach(async () => {
  await resetDatabase();
  sessionUser.current = null;
});

describe("updateAdminProfile", () => {
  it("saves the operator's name and sign-in email", async () => {
    const admin = await createAdmin();

    const result = await updateAdminProfile(
      formData({ name: "أبو سلطان المنصوري", email: "newboss@example.ae" }),
    );

    expect(result.ok).toBe(true);
    const after = await prisma.user.findUnique({ where: { id: admin.id } });
    expect(after?.name).toBe("أبو سلطان المنصوري");
    expect(after?.email).toBe("newboss@example.ae");
  });

  /** Addresses are case-insensitive in practice; two casings must not be two accounts. */
  it("lower-cases the email so it can't shadow an existing account", async () => {
    const admin = await createAdmin();

    await updateAdminProfile(formData({ name: "Boss", email: "Mixed.Case@Example.AE" }));

    const after = await prisma.user.findUnique({ where: { id: admin.id } });
    expect(after?.email).toBe("mixed.case@example.ae");
  });

  /**
   * Reported on the field rather than raised as a P2002, which would reach the
   * operator as "couldn't save" with nothing saying which input was wrong.
   */
  it("refuses an email that belongs to someone else, as a field error", async () => {
    await prisma.user.create({
      data: { email: "taken@example.ae", passwordHash: "x", role: "OWNER" },
    });
    const admin = await createAdmin();

    const result = await updateAdminProfile(
      formData({ name: "Boss", email: "taken@example.ae" }),
    );

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.fieldErrors?.email).toBeTruthy();

    const after = await prisma.user.findUnique({ where: { id: admin.id } });
    expect(after?.email).toBe("boss@example.ae");
  });

  /** Saving the form untouched must not report your own address as taken. */
  it("allows saving without changing the email", async () => {
    const admin = await createAdmin();

    const result = await updateAdminProfile(
      formData({ name: "Renamed", email: "boss@example.ae" }),
    );

    expect(result.ok).toBe(true);
    const after = await prisma.user.findUnique({ where: { id: admin.id } });
    expect(after?.name).toBe("Renamed");
  });

  it("refuses to act with no session at all", async () => {
    const admin = await createAdmin();
    sessionUser.current = null;

    const result = await updateAdminProfile(
      formData({ name: "Attacker", email: "attacker@example.ae" }),
    );

    expect(result.ok).toBe(false);
    const after = await prisma.user.findUnique({ where: { id: admin.id } });
    expect(after?.email).toBe("boss@example.ae");
  });

  /**
   * An owner's session must not reach an admin action. `requireAdmin` re-reads
   * the role from the database precisely so a 30-day token cannot assert one it
   * no longer has.
   */
  it("refuses an owner's session", async () => {
    const admin = await createAdmin();
    const owner = await prisma.user.create({
      data: { email: "owner@example.ae", passwordHash: "x", role: "OWNER" },
    });
    sessionUser.current = { id: owner.id };

    const result = await updateAdminProfile(
      formData({ name: "Sneaky", email: "sneaky@example.ae" }),
    );

    expect(result.ok).toBe(false);
    const after = await prisma.user.findUnique({ where: { id: admin.id } });
    expect(after?.email).toBe("boss@example.ae");
  });
});

describe("changeAdminPassword", () => {
  it("changes the password when the current one is right", async () => {
    const admin = await createAdmin();
    const before = await hashOf(admin.id);

    const result = await changeAdminPassword(CURRENT, "BrandNewPass1!", "BrandNewPass1!");

    expect(result.ok).toBe(true);

    const after = await hashOf(admin.id);
    expect(after).not.toBe(before);
    // The new password must actually verify — a hash that merely *changed*
    // could be a hash of the wrong string.
    expect(await bcrypt.compare("BrandNewPass1!", after)).toBe(true);
    expect(await bcrypt.compare(CURRENT, after)).toBe(false);
  });

  /** The whole point of the action. */
  it("refuses a wrong current password and leaves the hash alone", async () => {
    const admin = await createAdmin();
    const before = await hashOf(admin.id);

    const result = await changeAdminPassword(
      "NotThePassword!",
      "BrandNewPass1!",
      "BrandNewPass1!",
    );

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.fieldErrors?.currentPassword).toBeTruthy();
    expect(await hashOf(admin.id)).toBe(before);
  });

  it("refuses an empty current password", async () => {
    const admin = await createAdmin();
    const before = await hashOf(admin.id);

    const result = await changeAdminPassword("", "BrandNewPass1!", "BrandNewPass1!");

    expect(result.ok).toBe(false);
    expect(await hashOf(admin.id)).toBe(before);
  });

  it("refuses when the confirmation does not match", async () => {
    const admin = await createAdmin();
    const before = await hashOf(admin.id);

    const result = await changeAdminPassword(CURRENT, "BrandNewPass1!", "Different1!");

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.fieldErrors?.confirmPassword).toBeTruthy();
    expect(await hashOf(admin.id)).toBe(before);
  });

  /** Matches the bound every other password field on the platform enforces. */
  it("refuses a password shorter than eight characters", async () => {
    const admin = await createAdmin();
    const before = await hashOf(admin.id);

    const result = await changeAdminPassword(CURRENT, "short1!", "short1!");

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.fieldErrors?.password).toBeTruthy();
    expect(await hashOf(admin.id)).toBe(before);
  });

  it("refuses a new password identical to the current one", async () => {
    const admin = await createAdmin();
    const before = await hashOf(admin.id);

    const result = await changeAdminPassword(CURRENT, CURRENT, CURRENT);

    expect(result.ok).toBe(false);
    expect(await hashOf(admin.id)).toBe(before);
  });

  it("refuses with no session, however correct the passwords are", async () => {
    const admin = await createAdmin();
    const before = await hashOf(admin.id);
    sessionUser.current = null;

    const result = await changeAdminPassword(CURRENT, "BrandNewPass1!", "BrandNewPass1!");

    expect(result.ok).toBe(false);
    expect(await hashOf(admin.id)).toBe(before);
  });

  /** The log records that it happened, and never what was set. */
  it("writes an audit entry that does not contain the password", async () => {
    const admin = await createAdmin();

    await changeAdminPassword(CURRENT, "BrandNewPass1!", "BrandNewPass1!");

    const entries = await prisma.auditLog.findMany({
      where: { action: "ADMIN_PASSWORD_CHANGED" },
    });
    expect(entries).toHaveLength(1);
    expect(entries[0].actorId).toBe(admin.id);

    const serialised = JSON.stringify(entries[0]);
    expect(serialised).not.toContain("BrandNewPass1!");
    expect(serialised).not.toContain(CURRENT);
  });

  it("records a details edit separately from a password change", async () => {
    await createAdmin();

    await updateAdminProfile(formData({ name: "Boss", email: "moved@example.ae" }));

    const entries = await prisma.auditLog.findMany({
      where: { action: "ADMIN_ACCOUNT_UPDATED" },
    });
    expect(entries).toHaveLength(1);
    expect(entries[0].metadata).toContain("moved@example.ae");
  });
});
