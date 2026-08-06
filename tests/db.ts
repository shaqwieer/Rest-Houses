import { PrismaClient } from "@prisma/client";

/**
 * A real PostgreSQL database for the tests that need one — the same engine as
 * production.
 *
 * ─── Why a real database rather than a mocked Prisma client ─────────────────
 * The rules under test are *queries*: "an expired owner's listings do not come
 * back from this WHERE clause", "an owner cannot read a listing scoped to
 * another ownerId". A mocked client would only prove the code calls Prisma with
 * the arguments the test also wrote — it would pass just as happily if the
 * predicate were wrong. Running the actual SQL is the only way these assertions
 * mean anything.
 *
 * The database is dropped and recreated once per run by tests/global-setup.ts,
 * then truncated between tests by `resetDatabase()` below. `deleteMany()` is
 * engine-agnostic, so nothing here depends on which database is underneath.
 */

const prisma = new PrismaClient();

/**
 * Present for symmetry with the test files that call it.
 *
 * The database is actually created and migrated by `tests/global-setup.ts`,
 * which runs once before any worker starts — doing it per test file would have
 * workers racing to drop a database the others are connected to.
 */
export function ensureSchema(): void {
  /* no-op — see tests/global-setup.ts */
}

/**
 * Empty every table.
 *
 * Deleted in dependency order rather than relying on cascades, so a test that
 * leaves a booking behind cannot make the next one fail on a foreign key. The
 * order is children-before-parents throughout.
 */
export async function resetDatabase(): Promise<void> {
  await prisma.auditLog.deleteMany();
  await prisma.bookingRequest.deleteMany();
  await prisma.availability.deleteMany();
  await prisma.review.deleteMany();
  await prisma.listingImage.deleteMany();
  await prisma.listing.deleteMany();
  await prisma.ownerProfile.deleteMany();
  await prisma.user.deleteMany();
  await prisma.siteSettings.deleteMany();
  // The rows those numbers were unique against are gone, so the sequence starts
  // over — otherwise a long suite would drift away from the readable
  // 97150000001, 97150000002 … that make a failure message easy to trace.
  resetOwnerPhoneCounter();
}

/** The settings row most tests assume exists. */
export async function seedSettings(
  overrides: Partial<{
    serviceFeePercent: number;
    depositPercent: number;
    /** The platform fallback a listing inherits when it sets none of its own. */
    freeCancelHours: number;
    checkInTime: string;
    checkOutTime: string;
  }> = {},
) {
  return prisma.siteSettings.create({
    data: {
      id: 1,
      serviceFeePercent: overrides.serviceFeePercent ?? 5,
      depositPercent: overrides.depositPercent ?? 30,
      ...(overrides.freeCancelHours === undefined
        ? {}
        : { freeCancelHours: overrides.freeCancelHours }),
      ...(overrides.checkInTime === undefined ? {} : { checkInTime: overrides.checkInTime }),
      ...(overrides.checkOutTime === undefined
        ? {}
        : { checkOutTime: overrides.checkOutTime }),
    },
  });
}

/** Days from now as a Date, for membership windows. */
export function daysFromNow(days: number): Date {
  return new Date(Date.now() + days * 86_400_000);
}

type OwnerOptions = {
  email: string;
  status?: string;
  membershipExpiresAt?: Date | null;
  whatsapp?: string;
  fullName?: string;
};

/**
 * Distinct default numbers, because an owner's number is now their username and
 * `User.username` is unique.
 *
 * Every owner used to default to the same "971500000000", which was harmless
 * when the column did not exist and is a unique-constraint violation now. A
 * counter rather than a random value so a failing test names the same owner on
 * every run. Reset with the database — see `resetDatabase` below.
 */
let ownerPhoneCounter = 0;

export function resetOwnerPhoneCounter() {
  ownerPhoneCounter = 0;
}

/** An owner account + profile in one call. */
export async function createOwner(opts: OwnerOptions) {
  const phone = opts.whatsapp ?? `9715000000${String(++ownerPhoneCounter).padStart(2, "0")}`;

  const user = await prisma.user.create({
    data: {
      email: opts.email,
      // Owners sign in with their number, so a test owner needs one — and it
      // must be the same string as `OwnerProfile.phone` below, which is exactly
      // the invariant the production code maintains.
      username: phone,
      name: opts.fullName ?? "Test Owner",
      // A fixed non-verifying hash: no test signs in with a password.
      passwordHash: "$2a$10$testtesttesttesttesttesttesttesttesttesttesttesttestte",
      role: "OWNER",
    },
  });

  const owner = await prisma.ownerProfile.create({
    data: {
      userId: user.id,
      fullName: opts.fullName ?? "Test Owner",
      phone,
      whatsapp: phone,
      status: opts.status ?? "APPROVED",
      membershipExpiresAt:
        opts.membershipExpiresAt === undefined ? daysFromNow(365) : opts.membershipExpiresAt,
    },
  });

  return { user, owner };
}

let listingCounter = 0;

/** A published listing, optionally owned. */
export async function createListing(
  opts: {
    name?: string;
    ownerId?: string | null;
    published?: boolean;
    pricePerNight?: number;
    depositPercent?: number | null;
    capacity?: number;
    city?: string;
    /** 0 (the default) means this listing does not offer day bookings. */
    dayUsePrice?: number;
    dayUseWeekendPrice?: number;
    weekendPrice?: number;
    /** "short" (Sat+Sun, the default) or "long" (Fri+Sat+Sun, Sharjah's). */
    weekendMode?: "short" | "long";
    /** null (the default) inherits the platform's window; 0 means none at all. */
    freeCancelHours?: number | null;
    checkInTime?: string;
    checkOutTime?: string;
  } = {},
) {
  listingCounter += 1;
  const name = opts.name ?? `Listing ${listingCounter}`;

  return prisma.listing.create({
    data: {
      slug: `listing-${listingCounter}-${Date.now()}`,
      name,
      city: opts.city ?? "dubai",
      pricePerNight: opts.pricePerNight ?? 1000,
      capacity: opts.capacity ?? 40,
      published: opts.published ?? true,
      ownerId: opts.ownerId ?? null,
      depositPercent: opts.depositPercent ?? null,
      // Defaults to 0 — "not offered" — so every existing fixture keeps
      // describing an overnight-only rest house, which is what they all were.
      dayUsePrice: opts.dayUsePrice ?? 0,
      dayUseWeekendPrice: opts.dayUseWeekendPrice ?? 0,
      weekendPrice: opts.weekendPrice ?? 0,
      // The UAE weekend unless a fixture asks for Sharjah's, matching the
      // column default every existing row carries.
      weekendMode: opts.weekendMode ?? "short",
      // null, not 0 — 0 would make every fixture a listing that refuses free
      // cancellation, which is the exact confusion the column exists to avoid.
      freeCancelHours: opts.freeCancelHours ?? null,
      checkInTime: opts.checkInTime ?? "",
      checkOutTime: opts.checkOutTime ?? "",
      categories: JSON.stringify(["family"]),
      amenities: JSON.stringify(["pool"]),
    },
  });
}

export { prisma };
