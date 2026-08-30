import { beforeAll, beforeEach, afterAll, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createListing, ensureSchema, prisma, resetDatabase, seedSettings } from "./db";
import {
  BookingWorkflow,
  nextActionTitle,
  type WorkflowBooking,
} from "@/components/admin/booking-workflow";
import {
  ACTIVE_BOOKINGS_WHERE,
  ARCHIVED_BOOKINGS_WHERE,
  BOOKING_ORDER,
  bookingFilterCounts,
  bookingFilterWhere,
  isActiveFilter,
} from "@/lib/booking-view";
import {
  BOOKING_FILTERS,
  BOOKING_STATUSES,
  bookingDisplayStatus,
  isBookingFilter,
  isBookingStatus,
} from "@/lib/constants";
import { ar } from "@/lib/i18n/ar";
import { en } from "@/lib/i18n/en";

/**
 * "مكتمل" as a filter, and the order the two booking lists read in.
 *
 * Three things are being protected here, each of which broke something real
 * when it was got wrong during the change:
 *
 *   1. COMPLETED must be a *filter* and never a *status*. It is derived from
 *      `status = CONFIRMED` + `stage = DONE`; letting it into `BOOKING_STATUSES`
 *      would make it writable by `setRequestStatus` and every
 *      `status: "CONFIRMED"` query in the app would start missing bookings.
 *   2. The two buckets must be exact complements. If a booking can fall into
 *      neither, it disappears from the page; if it can fall into both, the
 *      "page N of M" figure stops matching what is on screen.
 *   3. The stepper must be *hidden*, never unmounted, when folded — it holds
 *      half-typed amounts in local state.
 */

// `BookingWorkflow` is a client component: it calls `useRouter` at render time,
// which throws outside an app-router tree. Nothing here exercises navigation —
// the questions are about markup — so a stub is enough. `vi.mock` is hoisted
// above the imports below it.
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: () => undefined, push: () => undefined }),
}));

// The stepper's buttons import the server actions, which drag in next-auth and
// with it `next/server` — unresolvable in a plain node environment. Nothing is
// pressed here, so stubs keep the module graph loadable without pretending to
// test the actions themselves; those have their own suite.
vi.mock("@/app/actions/requests", () => ({
  advanceRequestStage: async () => ({ ok: true }),
  advanceOwnerRequestStage: async () => ({ ok: true }),
  confirmCommissionTransfer: async () => ({ ok: true }),
  revertRequestStage: async () => ({ ok: true }),
  confirmBookingForPayment: async () => ({ ok: true, confirmed: true }),
}));

// Step 2's payment-link button, for the same reason as the block above: it
// imports a server action, which reaches next-auth. The button renders only when
// the platform can actually issue a link — false in this suite — but the module
// graph is loaded either way.
vi.mock("@/app/actions/payments", () => ({
  issueBookingPayLink: async () => ({ ok: true }),
}));

/* -------------------------------------------------------------------------- */
/* 1 — the two vocabularies                                                   */
/* -------------------------------------------------------------------------- */

describe("COMPLETED is a filter, not a storable status", () => {
  it("is offered as a chip", () => {
    expect(BOOKING_FILTERS).toContain("COMPLETED");
    expect(isBookingFilter("COMPLETED")).toBe(true);
  });

  it("is rejected by the guard that decides what may be written to the column", () => {
    // This is the guard `setRequestStatus` uses. If it ever accepts COMPLETED,
    // a button on the card can write a status no query in the app looks for.
    expect(isBookingStatus("COMPLETED")).toBe(false);
    expect(BOOKING_STATUSES).not.toContain("COMPLETED");
  });

  it("still offers every stored status as a chip", () => {
    for (const status of BOOKING_STATUSES) expect(BOOKING_FILTERS).toContain(status);
  });

  it("is what the badge shows once the handover runs out of steps", () => {
    expect(bookingDisplayStatus("CONFIRMED", "DONE")).toBe("COMPLETED");
    expect(bookingDisplayStatus("CONFIRMED", "COMMISSION")).toBe("CONFIRMED");
    expect(bookingDisplayStatus("NEW", "DEPOSIT")).toBe("NEW");
    // A cancelled booking that had finished its steps is still cancelled.
    expect(bookingDisplayStatus("CANCELLED", "DONE")).toBe("CANCELLED");
    // No stage to read (the read-only surfaces) must not read as finished.
    expect(bookingDisplayStatus("CONFIRMED", undefined)).toBe("CONFIRMED");
    expect(bookingDisplayStatus("CONFIRMED", null)).toBe("CONFIRMED");
  });

  it("has a label in both dictionaries", () => {
    expect(ar.status.COMPLETED).toBeTruthy();
    expect(en.status.COMPLETED).toBeTruthy();
    expect(ar.status.COMPLETED).not.toBe(ar.status.CONFIRMED);
  });

  it("splits the work queue from the archive", () => {
    expect(isActiveFilter("NEW")).toBe(true);
    expect(isActiveFilter("CONFIRMED")).toBe(true);
    expect(isActiveFilter("COMPLETED")).toBe(false);
    expect(isActiveFilter("REJECTED")).toBe(false);
    expect(isActiveFilter("CANCELLED")).toBe(false);
  });
});

/* -------------------------------------------------------------------------- */
/* 2 — the buckets, against a real database                                   */
/* -------------------------------------------------------------------------- */

beforeAll(() => {
  ensureSchema();
});

afterAll(async () => {
  await prisma.$disconnect();
});

beforeEach(async () => {
  await resetDatabase();
  await seedSettings({});
});

let ref = 0;

/** One booking, with only the columns these rules read. */
async function booking(opts: {
  listingId: string;
  status: string;
  stage?: string;
  checkIn: string;
  createdAt?: Date;
}) {
  ref += 1;
  return prisma.bookingRequest.create({
    data: {
      reference: `RQ-T${ref}`,
      listingId: opts.listingId,
      customerName: "ضيف",
      customerPhone: `97150000${String(ref).padStart(4, "0")}`,
      checkIn: opts.checkIn,
      checkOut: opts.checkIn,
      dayUse: true,
      nights: 0,
      guests: 2,
      subtotal: 1000,
      serviceFee: 0,
      total: 1000,
      status: opts.status,
      stage: opts.stage ?? "DEPOSIT",
      ...(opts.createdAt ? { createdAt: opts.createdAt } : {}),
    },
  });
}

/** One of every kind, so both bucket predicates are exercised. */
async function seedOneOfEach(listingId: string) {
  await booking({ listingId, status: "NEW", checkIn: "2026-09-20" });
  await booking({ listingId, status: "CONFIRMED", stage: "BALANCE", checkIn: "2026-09-05" });
  await booking({ listingId, status: "CONFIRMED", stage: "DONE", checkIn: "2026-08-01" });
  await booking({ listingId, status: "REJECTED", checkIn: "2026-08-02" });
  await booking({ listingId, status: "CANCELLED", stage: "DONE", checkIn: "2026-08-03" });
}

describe("the queue and the archive are exact complements", () => {
  it("puts every booking in exactly one of them", async () => {
    const listing = await createListing();
    await seedOneOfEach(listing.id);

    const total = await prisma.bookingRequest.count();
    const active = await prisma.bookingRequest.count({ where: ACTIVE_BOOKINGS_WHERE });
    const archived = await prisma.bookingRequest.count({ where: ARCHIVED_BOOKINGS_WHERE });

    expect(total).toBe(5);
    expect(active + archived).toBe(total);

    // Belt and braces: no row satisfies both predicates at once.
    const both = await prisma.bookingRequest.count({
      where: { AND: [ACTIVE_BOOKINGS_WHERE, ARCHIVED_BOOKINGS_WHERE] },
    });
    expect(both).toBe(0);
  });

  it("keeps a completed booking in the archive rather than losing it", async () => {
    const listing = await createListing();
    await seedOneOfEach(listing.id);

    // The bug this guards: `status: { notIn: ["NEW", "CONFIRMED"] }` reads as a
    // sensible archive predicate and silently drops every COMPLETED booking,
    // because a completed booking IS confirmed.
    const archived = await prisma.bookingRequest.findMany({
      where: ARCHIVED_BOOKINGS_WHERE,
      select: { status: true, stage: true },
    });
    expect(archived).toContainEqual({ status: "CONFIRMED", stage: "DONE" });
    expect(archived).toHaveLength(3);
  });

  it("counts each chip once, and the chips sum to the total", async () => {
    const listing = await createListing();
    await seedOneOfEach(listing.id);
    // A second in-progress booking, so "مؤكد" is not accidentally equal to
    // "مكتمل" and a swapped predicate would show up.
    await booking({
      listingId: listing.id,
      status: "CONFIRMED",
      stage: "INSPECTION",
      checkIn: "2026-09-09",
    });

    const counts = await bookingFilterCounts();

    expect(counts.NEW).toBe(1);
    expect(counts.CONFIRMED).toBe(2); // in progress only
    expect(counts.COMPLETED).toBe(1);
    expect(counts.REJECTED).toBe(1);
    expect(counts.CANCELLED).toBe(1);
    expect(counts.total).toBe(6);

    const chipSum = BOOKING_FILTERS.reduce((sum, f) => sum + counts[f], 0);
    expect(chipSum).toBe(counts.total);
  });

  it("scopes the counts to one owner's listings", async () => {
    const mine = await createListing();
    const theirs = await createListing();
    await booking({ listingId: mine.id, status: "NEW", checkIn: "2026-09-01" });
    await booking({ listingId: theirs.id, status: "NEW", checkIn: "2026-09-02" });

    const counts = await bookingFilterCounts({ listingId: mine.id });
    expect(counts.NEW).toBe(1);
    expect(counts.total).toBe(1);
  });

  it("gives each chip the rows it names", async () => {
    const listing = await createListing();
    await seedOneOfEach(listing.id);

    const rowsFor = (filter: (typeof BOOKING_FILTERS)[number]) =>
      prisma.bookingRequest.findMany({
        where: bookingFilterWhere(filter),
        select: { status: true, stage: true },
      });

    expect(await rowsFor("CONFIRMED")).toEqual([{ status: "CONFIRMED", stage: "BALANCE" }]);
    expect(await rowsFor("COMPLETED")).toEqual([{ status: "CONFIRMED", stage: "DONE" }]);
    // A cancelled booking whose steps happened to finish is cancelled, not
    // completed — "مكتمل" is only ever a confirmed booking.
    expect(await rowsFor("CANCELLED")).toEqual([{ status: "CANCELLED", stage: "DONE" }]);
  });
});

describe("reading order", () => {
  it("answers the oldest unanswered request first", async () => {
    const listing = await createListing();
    const old = await booking({
      listingId: listing.id,
      status: "NEW",
      checkIn: "2026-12-01",
      createdAt: new Date("2026-01-01T00:00:00Z"),
    });
    const recent = await booking({
      listingId: listing.id,
      status: "NEW",
      checkIn: "2026-09-01",
      createdAt: new Date("2026-06-01T00:00:00Z"),
    });

    const rows = await prisma.bookingRequest.findMany({
      where: bookingFilterWhere("NEW"),
      orderBy: BOOKING_ORDER.pending,
    });
    // Oldest first, and NOT by check-in date — a request that has waited five
    // months needs a reply before one that arrived last week.
    expect(rows.map((r) => r.id)).toEqual([old.id, recent.id]);
  });

  it("puts the soonest check-in at the top of the confirmed queue", async () => {
    const listing = await createListing();
    const soon = await booking({
      listingId: listing.id,
      status: "CONFIRMED",
      stage: "BALANCE",
      checkIn: "2026-09-02",
      createdAt: new Date("2026-06-01T00:00:00Z"),
    });
    const later = await booking({
      listingId: listing.id,
      status: "CONFIRMED",
      stage: "BALANCE",
      checkIn: "2026-11-20",
      createdAt: new Date("2026-01-01T00:00:00Z"),
    });
    const overdue = await booking({
      listingId: listing.id,
      status: "CONFIRMED",
      stage: "COMMISSION",
      checkIn: "2026-02-10",
      createdAt: new Date("2026-02-01T00:00:00Z"),
    });

    const rows = await prisma.bookingRequest.findMany({
      where: bookingFilterWhere("CONFIRMED"),
      orderBy: BOOKING_ORDER.active,
    });
    // A stay that already happened and is still mid-handover sorts ABOVE one
    // arriving next month — it is the most overdue work on the page.
    expect(rows.map((r) => r.id)).toEqual([overdue.id, soon.id, later.id]);
  });
});

/* -------------------------------------------------------------------------- */
/* 3 — the folding stepper                                                    */
/* -------------------------------------------------------------------------- */

const workflowBooking = (over: Partial<WorkflowBooking> = {}): WorkflowBooking => ({
  id: "b1",
  reference: "RQ-2431",
  status: "CONFIRMED",
  stage: "BALANCE",
  checkIn: "2026-09-05",
  checkOut: "2026-09-06",
  customerName: "عياشه النقبي",
  customerPhone: "971504784710",
  listingName: "إستراحه بوراشد",
  total: 1000,
  depositDue: 500,
  securityDeposit: 500,
  commissionDue: 50,
  commissionPercent: 5,
  depositCollected: 500,
  securityCollected: 500,
  balanceCollected: null,
  damageDeduction: null,
  securityReturned: null,
  inspectionNotes: null,
  commissionReference: null,
  depositConfirmedAt: new Date("2026-08-01T00:00:00Z"),
  balancePaidAt: null,
  checkedOutAt: null,
  inspectedAt: null,
  securityReturnedAt: null,
  commissionSentAt: null,
  commissionConfirmedAt: null,
  reviewInvitedAt: null,
  reviewInviteUrl: null,
  reviewInviteExpiresAt: null,
  reviewStatus: null,
  ...over,
});

const render = (over: Partial<WorkflowBooking> = {}) =>
  renderToStaticMarkup(
    <BookingWorkflow booking={workflowBooking(over)} scope="admin" reviewInviteDays={15} />,
  );

describe("the stepper folds", () => {
  it("starts folded on a confirmed booking, and says what comes next", () => {
    const html = render();
    expect(html).toContain('aria-expanded="false"');
    // Folded is not silent: the header names the step, not just its number.
    expect(html).toContain(ar.workflow.nextStep(ar.workflow.balanceTitle));
    expect(html).toContain(ar.workflow.stepOf("٢", "٧"));
  });

  it("starts open on a request nobody has answered — its step 1 is the confirm button", () => {
    const html = render({ status: "NEW", stage: "DEPOSIT" });
    expect(html).toContain('aria-expanded="true"');
    expect(html).toContain(ar.workflow.depositAction);
  });

  it("names the confirm action, not step 1's title, for a folded NEW request", () => {
    // `stage` is "DEPOSIT" on an untouched request because that is the column's
    // default, not because anything has been received. Reading the step title
    // off it would tell the operator the next thing to do is "استلام العربون
    // والتأمين" when what that step's button does is confirm the booking.
    //
    // Asserted on the helper rather than the markup: a NEW request renders
    // unfolded, so this line only appears after a click that static rendering
    // cannot make.
    expect(nextActionTitle("NEW", "DEPOSIT", ar)).toBe(ar.workflow.depositAction);
    expect(nextActionTitle("CONFIRMED", "BALANCE", ar)).toBe(ar.workflow.balanceTitle);
    expect(nextActionTitle("CONFIRMED", "COMMISSION", ar)).toBe(ar.workflow.commissionTitle);
  });

  it("keeps the steps in the DOM when folded, so a half-typed amount survives", () => {
    const html = render();
    // Hidden by class, not removed: `StepPanel` holds the amounts in local
    // state, and unmounting it would discard whatever was typed the moment
    // somebody folded the card.
    expect(html).toContain(ar.workflow.balanceAction);
    expect(html).toContain('class="hidden"');
  });

  it("still shows the completed line on a finished booking", () => {
    const html = render({ stage: "DONE" });
    expect(html).toContain(ar.workflow.completed);
    expect(html).toContain('aria-expanded="false"');
    // Nothing is "next" once there is nothing left to do.
    expect(html).not.toContain("التالي:");
  });

  it("renders nothing at all for a rejected or cancelled request", () => {
    expect(render({ status: "REJECTED" })).toBe("");
    expect(render({ status: "CANCELLED" })).toBe("");
  });
});
