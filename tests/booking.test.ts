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
import { humanCheckFields } from "./human-check";
import { resetRateLimits, resetSpentChallenges } from "@/lib/security";
import { addDays, todayISO } from "@/lib/dates";

/**
 * Requirement 5: the deposit is computed on the **server** from the listing's
 * own rate, and snapshotted onto the booking so a later change to that rate
 * cannot rewrite what an old customer was quoted.
 */

vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }));

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
  await seedSettings({ serviceFeePercent: 5, depositPercent: 30 });
  // The anti-abuse counters live in module memory, not in the database, so
  // `resetDatabase()` does not clear them. Without this, the phone-number budget
  // (five booking requests an hour) would be exhausted by the fixtures partway
  // down the file and later cases would fail for the wrong reason.
  resetRateLimits();
  resetSpentChallenges();
});

/** A stay starting a week out, so it is always in the future. */
function futureStay(nights = 2) {
  const checkIn = addDays(todayISO(), 7);
  return { checkIn, checkOut: addDays(checkIn, nights) };
}

function bookingForm(listingId: string, opts: { checkIn: string; checkOut: string } & Record<string, string>) {
  const fd = new FormData();
  fd.set("listingId", listingId);
  fd.set("checkIn", opts.checkIn);
  fd.set("checkOut", opts.checkOut);
  fd.set("guests", opts.guests ?? "10");
  fd.set("customerName", opts.customerName ?? "Khalid Al Mansouri");
  fd.set("customerPhone", opts.customerPhone ?? "+971502148890");
  fd.set("customerEmail", opts.customerEmail ?? "");
  fd.set("notes", opts.notes ?? "");
  // Every request carries a freshly minted, freshly solved challenge — exactly
  // what the widget on the booking form attaches. See tests/human-check.ts.
  for (const [k, v] of Object.entries(humanCheckFields("booking"))) fd.set(k, v);
  return fd;
}

describe("createBookingRequest", () => {
  it("uses the listing's own deposit rate, not the platform default", async () => {
    const listing = await createListing({ pricePerNight: 1000, depositPercent: 50 });
    const stay = futureStay(2);

    const { createBookingRequest } = await import("@/app/actions/booking");
    const result = await createBookingRequest(bookingForm(listing.id, stay));
    expect(result.ok).toBe(true);

    const booking = await prisma.bookingRequest.findFirst();
    // 2 × 1000 = 2000 subtotal, +5% fee = 2100 total, 50% deposit = 1050.
    expect(booking!.subtotal).toBe(2000);
    expect(booking!.serviceFee).toBe(100);
    expect(booking!.total).toBe(2100);
    expect(booking!.depositPercent).toBe(50);
    expect(booking!.depositDue).toBe(1050);
  });

  it("falls back to the platform default when the listing has no rate", async () => {
    const listing = await createListing({ pricePerNight: 1000, depositPercent: null });
    const stay = futureStay(2);

    const { createBookingRequest } = await import("@/app/actions/booking");
    await createBookingRequest(bookingForm(listing.id, stay));

    const booking = await prisma.bookingRequest.findFirst();
    expect(booking!.depositPercent).toBe(30);
    expect(booking!.depositDue).toBe(630); // 30% of 2100
  });

  it("honours a 0% deposit rather than substituting the default", async () => {
    const listing = await createListing({ pricePerNight: 1000, depositPercent: 0 });
    const stay = futureStay(2);

    const { createBookingRequest } = await import("@/app/actions/booking");
    await createBookingRequest(bookingForm(listing.id, stay));

    const booking = await prisma.bookingRequest.findFirst();
    expect(booking!.depositPercent).toBe(0);
    expect(booking!.depositDue).toBe(0);
  });

  /**
   * The amounts must come from the database, never from the submitted form.
   * A total in a hidden field is trivially editable.
   */
  it("ignores prices and deposit percentages posted by the browser", async () => {
    const listing = await createListing({ pricePerNight: 1000, depositPercent: 50 });
    const stay = futureStay(2);

    const fd = bookingForm(listing.id, stay);
    fd.set("total", "1");
    fd.set("subtotal", "1");
    fd.set("serviceFee", "0");
    fd.set("depositDue", "0");
    fd.set("depositPercent", "0");
    fd.set("pricePerNight", "1");

    const { createBookingRequest } = await import("@/app/actions/booking");
    await createBookingRequest(fd);

    const booking = await prisma.bookingRequest.findFirst();
    expect(booking!.total).toBe(2100);
    expect(booking!.depositDue).toBe(1050);
    expect(booking!.depositPercent).toBe(50);
  });

  /** Requirement: old bookings keep their original deposit values. */
  it("keeps the snapshot when the listing's deposit rate later changes", async () => {
    const listing = await createListing({ pricePerNight: 1000, depositPercent: 25 });
    const stay = futureStay(2);

    const { createBookingRequest } = await import("@/app/actions/booking");
    await createBookingRequest(bookingForm(listing.id, stay));

    const before = await prisma.bookingRequest.findFirst();
    expect(before!.depositPercent).toBe(25);
    expect(before!.depositDue).toBe(525); // 25% of 2100

    // The owner doubles their deposit, and raises the nightly rate too.
    await prisma.listing.update({
      where: { id: listing.id },
      data: { depositPercent: 50, pricePerNight: 4000 },
    });

    const after = await prisma.bookingRequest.findUnique({ where: { id: before!.id } });
    expect(after!.depositPercent).toBe(25);
    expect(after!.depositDue).toBe(525);
    expect(after!.total).toBe(2100);
  });

  it("is not bookable when the owner's membership has expired", async () => {
    const { owner } = await createOwner({
      email: "expired@test.ae",
      status: "APPROVED",
      membershipExpiresAt: daysFromNow(-1),
    });
    const listing = await createListing({ ownerId: owner.id, published: true });
    const stay = futureStay(2);

    const { createBookingRequest } = await import("@/app/actions/booking");
    const result = await createBookingRequest(bookingForm(listing.id, stay));

    expect(result.ok).toBe(false);
    expect(await prisma.bookingRequest.count()).toBe(0);
  });

  it("is not bookable when the owner is suspended, even with the listing id in hand", async () => {
    const { owner } = await createOwner({ email: "s@test.ae", status: "SUSPENDED" });
    const listing = await createListing({ ownerId: owner.id, published: true });
    const stay = futureStay(2);

    const { createBookingRequest } = await import("@/app/actions/booking");
    expect((await createBookingRequest(bookingForm(listing.id, stay))).ok).toBe(false);
    expect(await prisma.bookingRequest.count()).toBe(0);
  });

  it("becomes bookable again once the membership is renewed", async () => {
    const { owner } = await createOwner({
      email: "e@test.ae",
      status: "APPROVED",
      membershipExpiresAt: daysFromNow(-1),
    });
    const listing = await createListing({ ownerId: owner.id });
    const stay = futureStay(2);

    const { createBookingRequest } = await import("@/app/actions/booking");
    expect((await createBookingRequest(bookingForm(listing.id, stay))).ok).toBe(false);

    await prisma.ownerProfile.update({
      where: { id: owner.id },
      data: { membershipExpiresAt: daysFromNow(365) },
    });

    expect((await createBookingRequest(bookingForm(listing.id, stay))).ok).toBe(true);
  });

  it("refuses a stay over capacity, a past date and an inverted range", async () => {
    const listing = await createListing({ capacity: 20 });
    const stay = futureStay(2);
    const { createBookingRequest } = await import("@/app/actions/booking");

    expect((await createBookingRequest(bookingForm(listing.id, { ...stay, guests: "500" }))).ok).toBe(
      false,
    );

    const past = { checkIn: addDays(todayISO(), -5), checkOut: addDays(todayISO(), -3) };
    expect((await createBookingRequest(bookingForm(listing.id, past))).ok).toBe(false);

    const inverted = { checkIn: stay.checkOut, checkOut: stay.checkIn };
    expect((await createBookingRequest(bookingForm(listing.id, inverted))).ok).toBe(false);

    expect(await prisma.bookingRequest.count()).toBe(0);
  });

  it("refuses dates already blocked in the calendar", async () => {
    const listing = await createListing();
    const stay = futureStay(2);
    await prisma.availability.create({
      data: { listingId: listing.id, date: stay.checkIn, status: "BOOKED" },
    });

    const { createBookingRequest } = await import("@/app/actions/booking");
    expect((await createBookingRequest(bookingForm(listing.id, stay))).ok).toBe(false);
  });

  it("gives each booking a unique reference", async () => {
    const listing = await createListing();
    const { createBookingRequest } = await import("@/app/actions/booking");

    const first = addDays(todayISO(), 20);
    const second = addDays(todayISO(), 40);

    const a = await createBookingRequest(
      bookingForm(listing.id, { checkIn: first, checkOut: addDays(first, 2) }),
    );
    const b = await createBookingRequest(
      bookingForm(listing.id, { checkIn: second, checkOut: addDays(second, 2) }),
    );

    expect(a.ok && b.ok).toBe(true);
    if (a.ok && b.ok) expect(a.reference).not.toBe(b.reference);
  });

  it("does not block the calendar — a request is not a reservation", async () => {
    const listing = await createListing();
    const stay = futureStay(2);

    const { createBookingRequest } = await import("@/app/actions/booking");
    await createBookingRequest(bookingForm(listing.id, stay));

    // Nothing written to Availability: only an admin confirmation does that,
    // otherwise anyone could close a calendar by spamming the form.
    expect(await prisma.availability.count()).toBe(0);
  });
});
