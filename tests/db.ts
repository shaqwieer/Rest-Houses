import { PrismaClient } from "@prisma/client";

/**
 * A real SQLite database for the tests that need one.
 *
 * ─── Why a real database rather than a mocked Prisma client ─────────────────
 * The rules under test are *queries*: "an expired owner's listings do not come
 * back from this WHERE clause", "an owner cannot read a listing scoped to
 * another ownerId". A mocked client would only prove the code calls Prisma with
 * the arguments the test also wrote — it would pass just as happily if the
 * predicate were wrong. Running the actual SQL is the only way these assertions
 * mean anything.
 *
 * SQLite makes that cheap: the file is created once per run, truncated between
 * tests, and deleted with the working directory.
 */

const prisma = new PrismaClient();

/**
 * Present for symmetry with the test files that call it.
 *
 * The schema is actually created by `tests/global-setup.ts`, which runs once
 * before any worker starts. Doing it per test file would have the second file
 * try to delete a database the first still holds open (EBUSY on Windows).
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
}

/** The settings row most tests assume exists. */
export async function seedSettings(
  overrides: Partial<{ serviceFeePercent: number; depositPercent: number }> = {},
) {
  return prisma.siteSettings.create({
    data: {
      id: 1,
      serviceFeePercent: overrides.serviceFeePercent ?? 5,
      depositPercent: overrides.depositPercent ?? 30,
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

/** An owner account + profile in one call. */
export async function createOwner(opts: OwnerOptions) {
  const user = await prisma.user.create({
    data: {
      email: opts.email,
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
      phone: opts.whatsapp ?? "971500000000",
      whatsapp: opts.whatsapp ?? "971500000000",
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
      categories: JSON.stringify(["family"]),
      amenities: JSON.stringify(["pool"]),
    },
  });
}

export { prisma };
