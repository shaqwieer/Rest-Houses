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
 * The seven-step booking handover, driven through the real server actions.
 *
 * These run against PostgreSQL with the guards live — only NextAuth's `auth()`
 * is faked, exactly as in tests/owner-workflow.test.ts, so `requireAdmin` and
 * `requireApprovedOwner` do their real database reads. The point of the file is
 * the transitions themselves: what each step writes, what it refuses, and the
 * states a booking must never be able to reach.
 */

const sessionUser = vi.hoisted(() => ({ current: null as { id: string } | null }));

vi.mock("next-auth", async () => ({
  default: () => ({
    handlers: {},
    signIn: vi.fn(),
    signOut: vi.fn(),
    auth: async () => (sessionUser.current ? { user: { id: sessionUser.current.id } } : null),
  }),
  AuthError: class AuthError extends Error {},
}));

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

async function createAdmin(email = "admin@stages.ae") {
  return prisma.user.create({
    data: {
      email,
      name: "Admin",
      passwordHash: "$2a$10$testtesttesttesttesttesttesttesttesttesttesttesttestte",
      role: "ADMIN",
    },
  });
}

/** `days` from today, as a YYYY-MM-DD calendar day. */
function day(days: number): string {
  return daysFromNow(days).toISOString().slice(0, 10);
}

async function createBooking(
  listingId: string,
  overrides: Record<string, unknown> = {},
) {
  return prisma.bookingRequest.create({
    data: {
      reference: `RQ-${Math.floor(Math.random() * 1_000_000)}`,
      listingId,
      customerName: "ضيف",
      customerPhone: "971500000000",
      checkIn: day(5),
      checkOut: day(7),
      nights: 2,
      guests: 4,
      subtotal: 3000,
      serviceFee: 0,
      total: 3000,
      depositDue: 900,
      depositPercent: 30,
      securityDeposit: 500,
      commissionPercent: 5,
      commissionDue: 150,
      ...overrides,
    },
  });
}

async function stageOf(id: string) {
  const row = await prisma.bookingRequest.findUniqueOrThrow({
    where: { id },
    select: { stage: true, status: true },
  });
  return row;
}

describe("step 1 — the deposit is the confirmation", () => {
  it("records what was collected, closes the calendar and moves to step 2", async () => {
    const { advanceRequestStage } = await import("@/app/actions/requests");
    const admin = await createAdmin();
    signInAs(admin.id);

    const listing = await createListing();
    const booking = await createBooking(listing.id);

    const result = await advanceRequestStage(booking.id, {
      step: "DEPOSIT",
      depositCollected: 1000,
      securityCollected: 400,
    });
    expect(result.ok).toBe(true);

    const after = await prisma.bookingRequest.findUniqueOrThrow({
      where: { id: booking.id },
    });
    expect(after.status).toBe("CONFIRMED");
    expect(after.stage).toBe("BALANCE");
    // What was AGREED, not what was quoted — the two differ whenever the owner
    // and guest settled on something else, which is the normal case.
    expect(after.depositCollected).toBe(1000);
    expect(after.securityCollected).toBe(400);
    expect(after.depositConfirmedAt).not.toBeNull();

    // Both nights are now closed to everyone else.
    const booked = await prisma.availability.count({
      where: { listingId: listing.id, status: "BOOKED" },
    });
    expect(booked).toBe(2);
  });

  it("refuses a step that is no longer current", async () => {
    const { advanceRequestStage } = await import("@/app/actions/requests");
    const admin = await createAdmin();
    signInAs(admin.id);

    const listing = await createListing();
    const booking = await createBooking(listing.id);

    await advanceRequestStage(booking.id, { step: "DEPOSIT" });
    // A second tab, still showing step 1.
    const replay = await advanceRequestStage(booking.id, { step: "DEPOSIT" });

    expect(replay.ok).toBe(false);
    // And the calendar was not written a second time.
    expect(
      await prisma.availability.count({ where: { listingId: listing.id } }),
    ).toBe(2);
  });

  it("stops an owner confirming a stay that has already begun", async () => {
    const { advanceOwnerRequestStage } = await import("@/app/actions/requests");
    const { user, owner } = await createOwner({ email: "owner@stages.ae" });
    const listing = await createListing({ ownerId: owner.id });
    // Check-in was three days ago.
    const booking = await createBooking(listing.id, {
      checkIn: day(-3),
      checkOut: day(-1),
    });

    signInAs(user.id);
    const result = await advanceOwnerRequestStage(booking.id, { step: "DEPOSIT" });

    expect(result.ok).toBe(false);
    expect((await stageOf(booking.id)).status).toBe("NEW");
    // Nothing was written into a calendar that is already in the past.
    expect(await prisma.availability.count({ where: { listingId: listing.id } })).toBe(0);
  });

  it("still lets an operator confirm a past booking", async () => {
    // Reconstructing a booking that was taken over WhatsApp and never entered
    // is the operator's job, and the audit log records that it was them.
    const { advanceRequestStage } = await import("@/app/actions/requests");
    const admin = await createAdmin();
    const listing = await createListing();
    const booking = await createBooking(listing.id, {
      checkIn: day(-3),
      checkOut: day(-1),
    });

    signInAs(admin.id);
    const result = await advanceRequestStage(booking.id, { step: "DEPOSIT" });

    expect(result.ok).toBe(true);
    expect((await stageOf(booking.id)).status).toBe("CONFIRMED");
  });

  it("scopes an owner to their own rest houses", async () => {
    const { advanceOwnerRequestStage } = await import("@/app/actions/requests");
    const mine = await createOwner({ email: "mine@stages.ae" });
    const theirs = await createOwner({ email: "theirs@stages.ae" });
    const otherListing = await createListing({ ownerId: theirs.owner.id });
    const booking = await createBooking(otherListing.id);

    signInAs(mine.user.id);
    const result = await advanceOwnerRequestStage(booking.id, { step: "DEPOSIT" });

    // "Not found" rather than "forbidden" — the same answer as for an id that
    // does not exist, so nothing is confirmed about another owner's bookings.
    expect(result.ok).toBe(false);
    expect((await stageOf(booking.id)).status).toBe("NEW");
  });
});

describe("steps 2 to 7", () => {
  async function confirmedBooking() {
    const { advanceRequestStage } = await import("@/app/actions/requests");
    const admin = await createAdmin();
    signInAs(admin.id);
    const listing = await createListing();
    const booking = await createBooking(listing.id);
    await advanceRequestStage(booking.id, {
      step: "DEPOSIT",
      depositCollected: 900,
      securityCollected: 500,
    });
    return { booking, listing, admin };
  }

  it("walks the whole sequence to DONE and issues a review link", async () => {
    const { advanceRequestStage } = await import("@/app/actions/requests");
    const { booking } = await confirmedBooking();

    await advanceRequestStage(booking.id, { step: "BALANCE", balanceCollected: 2100 });
    expect((await stageOf(booking.id)).stage).toBe("CHECKOUT");

    await advanceRequestStage(booking.id, { step: "CHECKOUT" });
    expect((await stageOf(booking.id)).stage).toBe("INSPECTION");

    await advanceRequestStage(booking.id, {
      step: "INSPECTION",
      inspectionNotes: "الاستراحة سليمة",
    });
    expect((await stageOf(booking.id)).stage).toBe("SECURITY");

    await advanceRequestStage(booking.id, { step: "SECURITY", damageDeduction: 150 });
    expect((await stageOf(booking.id)).stage).toBe("COMMISSION");

    const settled = await prisma.bookingRequest.findUniqueOrThrow({
      where: { id: booking.id },
    });
    // Derived server-side from what was HELD, never taken from the form.
    expect(settled.damageDeduction).toBe(150);
    expect(settled.securityReturned).toBe(350);

    // An operator recording the transfer has already seen the money, so both
    // halves of step 6 happen at once for them.
    await advanceRequestStage(booking.id, {
      step: "COMMISSION",
      commissionReference: "TRX-1",
    });
    expect((await stageOf(booking.id)).stage).toBe("REVIEW");

    const result = await advanceRequestStage(booking.id, { step: "REVIEW" });
    expect(result.ok).toBe(true);
    expect(result.ok && result.reviewUrl).toContain("/review/");
    expect((await stageOf(booking.id)).stage).toBe("DONE");

    const invite = await prisma.reviewInvite.findUniqueOrThrow({
      where: { bookingId: booking.id },
    });
    // 32 random bytes, hex encoded — not derivable from the booking reference.
    expect(invite.token).toHaveLength(64);
    expect(invite.expiresAt.getTime()).toBeGreaterThan(Date.now());
    expect(invite.usedAt).toBeNull();
  });

  it("will not deduct more damage than the security deposit taken", async () => {
    const { advanceRequestStage } = await import("@/app/actions/requests");
    const { booking } = await confirmedBooking();

    await advanceRequestStage(booking.id, { step: "BALANCE" });
    await advanceRequestStage(booking.id, { step: "CHECKOUT" });
    await advanceRequestStage(booking.id, { step: "INSPECTION" });

    const result = await advanceRequestStage(booking.id, {
      step: "SECURITY",
      damageDeduction: 900, // only 500 was collected
    });

    expect(result.ok).toBe(false);
    expect((await stageOf(booking.id)).stage).toBe("SECURITY");
  });

  it("holds the commission at step 6 until an operator confirms it", async () => {
    const { advanceOwnerRequestStage, confirmCommissionTransfer } = await import(
      "@/app/actions/requests"
    );
    const admin = await createAdmin();
    const { user, owner } = await createOwner({ email: "owner6@stages.ae" });
    const listing = await createListing({ ownerId: owner.id });
    const booking = await createBooking(listing.id, { stage: "COMMISSION", status: "CONFIRMED" });

    signInAs(user.id);
    const sent = await advanceOwnerRequestStage(booking.id, {
      step: "COMMISSION",
      commissionReference: "TRX-77",
    });
    expect(sent.ok).toBe(true);

    // The owner saying "I sent it" must not be the platform's only record of
    // its own revenue.
    const afterOwner = await prisma.bookingRequest.findUniqueOrThrow({
      where: { id: booking.id },
    });
    expect(afterOwner.stage).toBe("COMMISSION");
    expect(afterOwner.commissionSentAt).not.toBeNull();
    expect(afterOwner.commissionConfirmedAt).toBeNull();

    // An owner cannot confirm their own transfer.
    const selfConfirm = await confirmCommissionTransfer(booking.id);
    expect(selfConfirm.ok).toBe(false);

    signInAs(admin.id);
    const confirmed = await confirmCommissionTransfer(booking.id);
    expect(confirmed.ok).toBe(true);

    const afterAdmin = await stageOf(booking.id);
    expect(afterAdmin.stage).toBe("REVIEW");
  });

  it("refuses to confirm a commission the owner never sent", async () => {
    const { confirmCommissionTransfer } = await import("@/app/actions/requests");
    const admin = await createAdmin();
    signInAs(admin.id);
    const listing = await createListing();
    const booking = await createBooking(listing.id, {
      stage: "COMMISSION",
      status: "CONFIRMED",
    });

    const result = await confirmCommissionTransfer(booking.id);
    expect(result.ok).toBe(false);
    expect((await stageOf(booking.id)).stage).toBe("COMMISSION");
  });

  it("issues a review link only once", async () => {
    const { advanceRequestStage } = await import("@/app/actions/requests");
    const admin = await createAdmin();
    signInAs(admin.id);
    const listing = await createListing();
    const booking = await createBooking(listing.id, { stage: "REVIEW", status: "CONFIRMED" });

    await advanceRequestStage(booking.id, { step: "REVIEW" });
    // Back at REVIEW somehow — the invite must not be re-minted, or the guest
    // ends up with two live links to the same stay.
    await prisma.bookingRequest.update({
      where: { id: booking.id },
      data: { stage: "REVIEW" },
    });
    const again = await advanceRequestStage(booking.id, { step: "REVIEW" });

    expect(again.ok).toBe(false);
    expect(await prisma.reviewInvite.count({ where: { bookingId: booking.id } })).toBe(1);
  });
});

describe("cancelling and re-opening a booking", () => {
  it("returns a cancelled booking to step 1, not to a dead end", async () => {
    /*
     * The bug this exists to prevent: cancelling left `stage` wherever the
     * workflow had reached, so a booking sent back to the queue was NEW at
     * stage COMMISSION. Step 1 was not its current stage, and the later steps
     * only run on a CONFIRMED booking — so no step was actionable and the
     * booking could never be confirmed again by anybody.
     */
    const { advanceRequestStage, setRequestStatus } = await import(
      "@/app/actions/requests"
    );
    const admin = await createAdmin();
    signInAs(admin.id);
    const listing = await createListing();
    const booking = await createBooking(listing.id);

    await advanceRequestStage(booking.id, { step: "DEPOSIT" });
    await advanceRequestStage(booking.id, { step: "BALANCE" });
    await advanceRequestStage(booking.id, { step: "CHECKOUT" });
    expect((await stageOf(booking.id)).stage).toBe("INSPECTION");

    await setRequestStatus(booking.id, "CANCELLED");
    expect(await stageOf(booking.id)).toEqual({ status: "CANCELLED", stage: "DEPOSIT" });

    await setRequestStatus(booking.id, "NEW");
    expect(await stageOf(booking.id)).toEqual({ status: "NEW", stage: "DEPOSIT" });

    // And step 1 genuinely works again.
    const reconfirm = await advanceRequestStage(booking.id, {
      step: "DEPOSIT",
      depositCollected: 700,
    });
    expect(reconfirm.ok).toBe(true);
    expect(await stageOf(booking.id)).toEqual({ status: "CONFIRMED", stage: "BALANCE" });
  });

  it("frees the nights when a confirmed booking is cancelled", async () => {
    const { advanceRequestStage, setRequestStatus } = await import(
      "@/app/actions/requests"
    );
    const admin = await createAdmin();
    signInAs(admin.id);
    const listing = await createListing();
    const booking = await createBooking(listing.id);

    await advanceRequestStage(booking.id, { step: "DEPOSIT" });
    expect(await prisma.availability.count({ where: { listingId: listing.id } })).toBe(2);

    await setRequestStatus(booking.id, "CANCELLED");
    expect(await prisma.availability.count({ where: { listingId: listing.id } })).toBe(0);
  });

  it("stops an owner cancelling a stay that has already started", async () => {
    const { setOwnerRequestStatus } = await import("@/app/actions/requests");
    const { user, owner } = await createOwner({ email: "owner-cancel@stages.ae" });
    const listing = await createListing({ ownerId: owner.id });
    const booking = await createBooking(listing.id, {
      checkIn: day(-2),
      checkOut: day(1),
      status: "CONFIRMED",
      stage: "BALANCE",
    });

    signInAs(user.id);
    const result = await setOwnerRequestStatus(booking.id, "CANCELLED");

    // Cancelling would delete BOOKED nights that have already happened.
    expect(result.ok).toBe(false);
    expect((await stageOf(booking.id)).status).toBe("CONFIRMED");
  });
});

describe("reverting a step", () => {
  it("clears what the step recorded rather than merely stepping back", async () => {
    const { advanceRequestStage, revertRequestStage } = await import(
      "@/app/actions/requests"
    );
    const admin = await createAdmin();
    signInAs(admin.id);
    const listing = await createListing();
    const booking = await createBooking(listing.id);

    await advanceRequestStage(booking.id, { step: "DEPOSIT" });
    await advanceRequestStage(booking.id, { step: "BALANCE", balanceCollected: 2100 });
    expect((await stageOf(booking.id)).stage).toBe("CHECKOUT");

    const result = await revertRequestStage(booking.id);
    expect(result.ok).toBe(true);

    const after = await prisma.bookingRequest.findUniqueOrThrow({
      where: { id: booking.id },
    });
    expect(after.stage).toBe("BALANCE");
    // Not left behind: the next attempt must not be shown an amount somebody
    // has already been told was received.
    expect(after.balanceCollected).toBeNull();
    expect(after.balancePaidAt).toBeNull();
  });

  it("takes the review invite with it when stepping back from DONE", async () => {
    const { advanceRequestStage, revertRequestStage } = await import(
      "@/app/actions/requests"
    );
    const admin = await createAdmin();
    signInAs(admin.id);
    const listing = await createListing();
    const booking = await createBooking(listing.id, {
      stage: "REVIEW",
      status: "CONFIRMED",
    });

    await advanceRequestStage(booking.id, { step: "REVIEW" });
    expect(await prisma.reviewInvite.count({ where: { bookingId: booking.id } })).toBe(1);

    await revertRequestStage(booking.id);

    const after = await prisma.bookingRequest.findUniqueOrThrow({
      where: { id: booking.id },
    });
    expect(after.stage).toBe("REVIEW");
    // Both, or step 7 comes back as a button that can only ever fail.
    expect(after.reviewInvitedAt).toBeNull();
    expect(await prisma.reviewInvite.count({ where: { bookingId: booking.id } })).toBe(0);
  });

  it("will not revert the confirmation itself", async () => {
    const { advanceRequestStage, revertRequestStage } = await import(
      "@/app/actions/requests"
    );
    const admin = await createAdmin();
    signInAs(admin.id);
    const listing = await createListing();
    const booking = await createBooking(listing.id);

    await advanceRequestStage(booking.id, { step: "DEPOSIT" });
    // Undoing a confirmation is "cancel the booking" — it has to release the
    // calendar, and two ways to do that is how the two drift apart.
    const result = await revertRequestStage(booking.id);

    expect(result.ok).toBe(false);
    expect((await stageOf(booking.id)).stage).toBe("BALANCE");
  });

  it("is closed to owners", async () => {
    const { revertRequestStage } = await import("@/app/actions/requests");
    const { user, owner } = await createOwner({ email: "owner-revert@stages.ae" });
    const listing = await createListing({ ownerId: owner.id });
    const booking = await createBooking(listing.id, {
      status: "CONFIRMED",
      stage: "CHECKOUT",
    });

    signInAs(user.id);
    const result = await revertRequestStage(booking.id);

    expect(result.ok).toBe(false);
    expect((await stageOf(booking.id)).stage).toBe("CHECKOUT");
  });
});
