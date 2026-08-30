import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createListing, ensureSchema, prisma, resetDatabase, seedSettings } from "./db";
import {
  assertChargeable,
  recordManualPayment,
  refreshBookingPaymentRollup,
  resolvePayable,
  settlePayment,
} from "@/lib/payments/service";
import {
  issuePaymentLink,
  markLinkUsed,
  releasePaymentLink,
  resolvePaymentLink,
} from "@/lib/payments/links";
import { eventKey } from "@/lib/payments/status";
import { startPayment } from "@/lib/payments/service";
import {
  availableProviders,
  isDepositPaymentEnabled,
  isModeAvailable,
  platformPaymentModes,
} from "@/lib/payments";
import {
  advanceRequestStage,
  confirmBookingForPayment,
} from "@/app/actions/requests";

/**
 * The payment layer against a real database.
 *
 * What is asserted here is specifically the part that cannot be checked with
 * pure functions: that the idempotency guarantee is enforced by the SCHEMA
 * rather than by a code path a concurrent retry could slip past, that a payment
 * cannot be applied to a booking it does not belong to, and that the
 * payment-link token behaves like the bearer credential it is.
 *
 * No gateway is contacted anywhere in this file — no credentials exist, and
 * `startPayment` refuses before it would reach one. What is exercised is
 * everything on this side of that boundary.
 */

/**
 * Only auth() is mocked — the guards themselves run for real, including their
 * database reads. Same arrangement as tests/owner-workflow.test.ts, and for the
 * same reason: what is worth testing is that the guard re-reads the account
 * from the database, and mocking the guard would test nothing.
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

vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }));

function signInAs(userId: string | null) {
  sessionUser.current = userId ? { id: userId } : null;
}

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
  // No test starts with a configured gateway. enablePaymentLinks() stubs one in
  // for the two cases that need the credential gate open; everything else must
  // see the unconfigured environment every real deployment has today.
  vi.unstubAllEnvs();
  signInAs(null);
});

let referenceCounter = 0;

async function createBooking(
  opts: { total?: number; depositDue?: number; status?: string } = {},
) {
  const listing = await createListing({ pricePerNight: 1000 });
  referenceCounter += 1;

  return prisma.bookingRequest.create({
    data: {
      reference: `RQ-TEST-${referenceCounter}`,
      listingId: listing.id,
      customerName: "ضيف تجريبي",
      customerPhone: "971500000999",
      checkIn: "2026-12-01",
      checkOut: "2026-12-03",
      nights: 2,
      guests: 4,
      subtotal: opts.total ?? 2000,
      serviceFee: 0,
      total: opts.total ?? 2000,
      depositDue: opts.depositDue ?? 600,
      status: opts.status ?? "NEW",
    },
  });
}

describe("server-side amount validation", () => {
  it("accepts a whole-dirham amount in AED", () => {
    expect(assertChargeable(600, "AED")).toEqual({ ok: true });
    expect(assertChargeable(1, "AED")).toEqual({ ok: true });
  });

  /**
   * Every one of these is a figure that must never reach a gateway. Fractional
   * dirhams do not exist in this schema; zero and negatives are not payments;
   * and the ceiling is the last line against a corrupted booking row.
   */
  it("refuses anything that is not a positive whole amount", () => {
    for (const bad of [0, -1, -600, 12.5, Number.NaN, Infinity, 250_001]) {
      expect(assertChargeable(bad, "AED").ok).toBe(false);
    }
  });

  it("refuses any currency but AED", () => {
    for (const bad of ["USD", "aed", "", "SAR"]) {
      const result = assertChargeable(600, bad);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.reason).toBe("INVALID_CURRENCY");
    }
  });
});

describe("what is owed", () => {
  it("charges the stored deposit snapshot, not a recomputed one", async () => {
    const booking = await createBooking({ total: 2000, depositDue: 600 });
    const loaded = await loadPayable(booking.id);

    expect(resolvePayable(loaded, "DEPOSIT")).toEqual({ ok: true, amount: 600 });
  });

  it("nets a balance against what has already settled", async () => {
    const booking = await createBooking({ total: 2000, depositDue: 600 });
    await recordManualPayment({ bookingId: booking.id, amount: 600, actor: {} });

    const loaded = await loadPayable(booking.id);
    expect(resolvePayable(loaded, "BALANCE")).toEqual({ ok: true, amount: 1400 });
  });

  it("refuses to charge again once the total has been settled", async () => {
    const booking = await createBooking({ total: 2000, depositDue: 600 });
    await recordManualPayment({ bookingId: booking.id, amount: 2000, actor: {} });

    const loaded = await loadPayable(booking.id);
    const result = resolvePayable(loaded, "FULL");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("ALREADY_PAID");
  });

  it("refuses a deposit of zero rather than opening a checkout for nothing", async () => {
    const booking = await createBooking({ depositDue: 0 });
    const loaded = await loadPayable(booking.id);

    const result = resolvePayable(loaded, "DEPOSIT");
    expect(result.ok).toBe(false);
  });
});

describe("callback idempotency", () => {
  /**
   * The core guarantee, asserted where it actually lives.
   *
   * The second insert fails on the unique index — in the DATABASE — rather than
   * being filtered out by a "have I seen this?" read, which two concurrent
   * webhook retries would both answer "no" to.
   */
  it("refuses a second event with the same provider and event id", async () => {
    const key = eventKey("TELR", "order-1", "3", "WEBHOOK");

    await prisma.paymentEvent.create({
      data: { provider: "TELR", eventId: key, kind: "WEBHOOK", payload: "{}" },
    });

    await expect(
      prisma.paymentEvent.create({
        data: { provider: "TELR", eventId: key, kind: "WEBHOOK", payload: "{}" },
      }),
    ).rejects.toMatchObject({ code: "P2002" });

    expect(await prisma.paymentEvent.count()).toBe(1);
  });

  it("lets two providers use the same event id", async () => {
    for (const provider of ["TELR", "TABBY"]) {
      await prisma.paymentEvent.create({
        data: { provider, eventId: "shared-id", kind: "WEBHOOK", payload: "{}" },
      });
    }
    expect(await prisma.paymentEvent.count()).toBe(2);
  });

  /**
   * Concurrent retries, run together rather than in sequence, because that is
   * the case a read-then-write check gets wrong. Exactly one insert survives.
   */
  it("survives five simultaneous deliveries of one event", async () => {
    const key = eventKey("TELR", "order-race", "3", "WEBHOOK");

    const results = await Promise.allSettled(
      Array.from({ length: 5 }, () =>
        prisma.paymentEvent.create({
          data: { provider: "TELR", eventId: key, kind: "WEBHOOK", payload: "{}" },
        }),
      ),
    );

    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(await prisma.paymentEvent.count()).toBe(1);
  });

  it("refuses two payments claiming one provider reference", async () => {
    const a = await createBooking();
    const b = await createBooking();

    await prisma.payment.create({
      data: {
        bookingId: a.id,
        provider: "TELR",
        amount: 600,
        providerRef: "order-9",
        status: "AWAITING_PAYMENT",
      },
    });

    await expect(
      prisma.payment.create({
        data: {
          bookingId: b.id,
          provider: "TELR",
          amount: 600,
          providerRef: "order-9",
          status: "AWAITING_PAYMENT",
        },
      }),
    ).rejects.toMatchObject({ code: "P2002" });
  });

  /**
   * NULLs are distinct in PostgreSQL, which is what lets many
   * not-yet-initiated attempts coexist under that same unique index.
   */
  it("allows any number of attempts that have no reference yet", async () => {
    const booking = await createBooking();

    for (let i = 0; i < 3; i += 1) {
      await prisma.payment.create({
        data: { bookingId: booking.id, provider: "TELR", amount: 600, status: "PENDING" },
      });
    }
    expect(await prisma.payment.count()).toBe(3);
  });
});

describe("settlement", () => {
  it("marks a payment paid and rolls it up onto the booking", async () => {
    const booking = await createBooking();
    const payment = await prisma.payment.create({
      data: {
        bookingId: booking.id,
        provider: "TELR",
        amount: 600,
        providerRef: "order-ok",
        status: "AWAITING_PAYMENT",
      },
    });

    const result = await settlePayment({
      paymentId: payment.id,
      status: "PAID",
      providerStatus: "3",
      paidAmount: 600,
      paidCurrency: "AED",
    });

    expect(result).toEqual({ ok: true, status: "PAID" });

    const after = await prisma.bookingRequest.findUnique({ where: { id: booking.id } });
    expect(after?.paymentStatus).toBe("PAID");
    expect(after?.paymentReference).toBe("order-ok");
  });

  /**
   * A provider reporting less than was owed does not settle the booking. It is
   * recorded — status and figure both — and left for a human, because a partial
   * payment is a commercial conversation, not something a callback can decide.
   */
  it("does NOT confirm a payment for the wrong amount", async () => {
    const booking = await createBooking();
    const payment = await prisma.payment.create({
      data: {
        bookingId: booking.id,
        provider: "TELR",
        amount: 600,
        providerRef: "order-short",
        status: "AWAITING_PAYMENT",
      },
    });

    const result = await settlePayment({
      paymentId: payment.id,
      status: "PAID",
      providerStatus: "3",
      paidAmount: 1, // one dirham for a six-hundred dirham deposit
      paidCurrency: "AED",
    });

    expect(result).toEqual({ ok: true, status: "PROCESSING" });

    const stored = await prisma.payment.findUnique({ where: { id: payment.id } });
    expect(stored?.status).toBe("PROCESSING");
    expect(stored?.paidAt).toBeNull();
    expect(stored?.failureReason).toContain("expected 600");

    const after = await prisma.bookingRequest.findUnique({ where: { id: booking.id } });
    expect(after?.paymentStatus).toBe("PENDING");
  });

  it("does NOT confirm a payment reported in another currency", async () => {
    const booking = await createBooking();
    const payment = await prisma.payment.create({
      data: {
        bookingId: booking.id,
        provider: "TELR",
        amount: 600,
        providerRef: "order-usd",
        status: "AWAITING_PAYMENT",
      },
    });

    const result = await settlePayment({
      paymentId: payment.id,
      status: "PAID",
      providerStatus: "3",
      paidAmount: 600,
      paidCurrency: "USD",
    });

    expect(result).toEqual({ ok: true, status: "PROCESSING" });
  });

  /**
   * A late "expired" notification arriving after a successful capture. Ordinary
   * gateway retry behaviour, and applying it would cancel a booking the guest
   * has paid for and re-open the rest house.
   */
  it("ignores a delivery that would undo a settled payment", async () => {
    const booking = await createBooking();
    const payment = await prisma.payment.create({
      data: {
        bookingId: booking.id,
        provider: "TELR",
        amount: 600,
        providerRef: "order-late",
        status: "PAID",
        paidAt: new Date(),
      },
    });

    const result = await settlePayment({
      paymentId: payment.id,
      status: "CANCELLED",
      providerStatus: "-3",
    });

    expect(result).toEqual({ ok: true, status: "PAID" });
    const stored = await prisma.payment.findUnique({ where: { id: payment.id } });
    expect(stored?.status).toBe("PAID");
    // The provider's word is still written down, even when it changes nothing.
    expect(stored?.providerStatus).toBe("-3");
  });

  it("keeps a booking's payments off every other booking", async () => {
    const a = await createBooking();
    const b = await createBooking();

    await recordManualPayment({ bookingId: a.id, amount: 600, actor: {} });
    await refreshBookingPaymentRollup(b.id);

    const bookingA = await prisma.bookingRequest.findUnique({ where: { id: a.id } });
    const bookingB = await prisma.bookingRequest.findUnique({ where: { id: b.id } });

    expect(bookingA?.paymentStatus).toBe("PAID");
    expect(bookingB?.paymentStatus).toBe("NONE");
  });
});

describe("the manual path", () => {
  it("records the owner's collection as a PAID ledger entry", async () => {
    const booking = await createBooking();

    const result = await recordManualPayment({
      bookingId: booking.id,
      amount: 600,
      reference: "IBAN-TRANSFER-123",
      actor: { email: "owner@example.ae", role: "OWNER" },
    });

    expect(result.ok).toBe(true);

    const payment = await prisma.payment.findFirst({ where: { bookingId: booking.id } });
    expect(payment?.provider).toBe("MANUAL");
    expect(payment?.method).toBe("BANK_TRANSFER");
    expect(payment?.status).toBe("PAID");
    expect(payment?.providerRef).toBe("IBAN-TRANSFER-123");

    // Who recorded it is answerable after the fact.
    const audit = await prisma.auditLog.findFirst({ where: { entityId: payment!.id } });
    expect(audit?.action).toBe("PAYMENT_SETTLED");
    expect(audit?.actorEmail).toBe("owner@example.ae");
  });

  it("refuses to record an impossible amount", async () => {
    const booking = await createBooking();
    const result = await recordManualPayment({ bookingId: booking.id, amount: 0, actor: {} });

    expect(result.ok).toBe(false);
    expect(await prisma.payment.count()).toBe(0);
  });
});

describe("payment links", () => {
  /**
   * The link is only reachable once the OWNER has confirmed — that ordering is
   * the entire "semi-self" flow, and it is enforced here rather than by the
   * button that calls it.
   */
  it("refuses to issue one for a booking nobody has confirmed", async () => {
    await enablePaymentLinks();
    const booking = await createBooking({ status: "NEW" });

    const result = await issuePaymentLink({ where: { id: booking.id }, kind: "DEPOSIT" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("BOOKING_NOT_PAYABLE");
  });

  /**
   * The gate that keeps the whole flow inert today. No gateway has credentials,
   * so "LINK" is not a platform mode and no link can be minted at all.
   */
  it("refuses to issue one while no gateway is configured", async () => {
    const booking = await createBooking({ status: "CONFIRMED" });

    const result = await issuePaymentLink({ where: { id: booking.id }, kind: "DEPOSIT" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("PAYMENTS_DISABLED");
    expect(await prisma.paymentLink.count()).toBe(0);
  });

  it("scopes issuing to the booking's own owner", async () => {
    await enablePaymentLinks();
    const booking = await createBooking({ status: "CONFIRMED" });

    // Somebody else's ownerId in the WHERE clause resolves to nothing — the
    // same answer as an id that does not exist.
    const result = await issuePaymentLink({
      where: { id: booking.id, listing: { ownerId: "some-other-owner" } },
      kind: "DEPOSIT",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("BOOKING_NOT_FOUND");
  });

  describe("once one exists", () => {
    it("resolves a token to exactly one booking and one amount", async () => {
      const { token, booking } = await seedLink();

      const lookup = await resolvePaymentLink(token);
      expect(lookup.ok).toBe(true);
      if (!lookup.ok) return;

      expect(lookup.link.bookingId).toBe(booking.id);
      expect(lookup.link.amount).toBe(600);
      expect(lookup.link.currency).toBe("AED");
    });

    /**
     * The token is the whole authentication, so a near-miss must be worth
     * nothing. A wrong token and a non-existent one are the same answer.
     */
    it("refuses a token that is not exactly right", async () => {
      const { token } = await seedLink();

      for (const bad of [
        token.slice(0, -1) + (token.endsWith("a") ? "b" : "a"),
        token.slice(0, 63),
        token.toUpperCase(),
        "",
        "../../etc/passwd",
        "1".repeat(64),
      ]) {
        const lookup = await resolvePaymentLink(bad);
        expect(lookup.ok).toBe(false);
        if (!lookup.ok) expect(lookup.reason).toBe("LINK_INVALID");
      }
    });

    it("refuses an expired link", async () => {
      const { token, linkId } = await seedLink();
      await prisma.paymentLink.update({
        where: { id: linkId },
        data: { expiresAt: new Date(Date.now() - 1000) },
      });

      const lookup = await resolvePaymentLink(token);
      expect(lookup.ok).toBe(false);
      if (!lookup.ok) expect(lookup.reason).toBe("LINK_EXPIRED");
    });

    it("refuses a link that has already been spent", async () => {
      const { token, linkId } = await seedLink();
      expect(await markLinkUsed(linkId)).toBe(true);

      const lookup = await resolvePaymentLink(token);
      expect(lookup.ok).toBe(false);
      if (!lookup.ok) expect(lookup.reason).toBe("LINK_USED");
    });

    /**
     * Two simultaneous taps on one link. `markLinkUsed` is a compare-and-set,
     * so exactly one wins — which is what stops a guest opening two checkouts
     * against one booking.
     */
    it("can only be spent once, even under a race", async () => {
      const { linkId } = await seedLink();

      const results = await Promise.all([
        markLinkUsed(linkId),
        markLinkUsed(linkId),
        markLinkUsed(linkId),
      ]);

      expect(results.filter(Boolean)).toHaveLength(1);
    });

    it("stops working when the booking is cancelled underneath it", async () => {
      const { token, booking } = await seedLink();
      await prisma.bookingRequest.update({
        where: { id: booking.id },
        data: { status: "CANCELLED" },
      });

      const lookup = await resolvePaymentLink(token);
      expect(lookup.ok).toBe(false);
      if (!lookup.ok) expect(lookup.reason).toBe("BOOKING_NOT_PAYABLE");
    });

    it("stops working once the booking has been paid", async () => {
      const { token, booking } = await seedLink();
      await recordManualPayment({ bookingId: booking.id, amount: 600, actor: {} });

      const lookup = await resolvePaymentLink(token);
      expect(lookup.ok).toBe(false);
      if (!lookup.ok) expect(lookup.reason).toBe("ALREADY_PAID");
    });

    it("issues 64 hex characters of real randomness, never derived from the booking", async () => {
      const first = await seedLink();
      const second = await seedLink();

      expect(first.token).toMatch(/^[0-9a-f]{64}$/);
      expect(second.token).toMatch(/^[0-9a-f]{64}$/);
      expect(first.token).not.toBe(second.token);
      // Nothing about the booking leaks into it.
      expect(first.token).not.toContain(first.booking.id);
      expect(first.token.toUpperCase()).not.toContain(first.booking.reference);
    });
  });
});


describe("a fresh install is inert", () => {
  /**
   * The claim this whole subsystem ships on, asserted against a REAL settings
   * row rather than a hand-built object: with the defaults every deployment has
   * today, no gateway is reachable, no mode but manual is offered, and every
   * public entry point refuses.
   *
   * If this test ever fails, the platform has started offering guests a
   * checkout it cannot complete.
   */
  it("offers nothing but the manual path with the seeded defaults", async () => {
    const settings = await prisma.siteSettings.findUniqueOrThrow({ where: { id: 1 } });

    expect(settings.depositPaymentsEnabled).toBe(false);
    expect(settings.telrEnabled).toBe(false);
    expect(settings.tabbyEnabled).toBe(false);
    expect(settings.tamaraEnabled).toBe(false);
    expect(settings.paymentLinksEnabled).toBe(false);

    expect(availableProviders(settings)).toEqual([]);
    expect(isDepositPaymentEnabled(settings)).toBe(false);
    expect(platformPaymentModes(settings)).toEqual(["MANUAL"]);
    expect(isModeAvailable("ONLINE", null, settings)).toBe(false);
    expect(isModeAvailable("LINK", null, settings)).toBe(false);
    expect(isModeAvailable("MANUAL", null, settings)).toBe(true);
  });

  it("refuses to open a checkout at all", async () => {
    const booking = await createBooking();

    const result = await startPayment({
      bookingId: booking.id,
      provider: "TELR",
      kind: "DEPOSIT",
      locale: "ar",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("PAYMENTS_DISABLED");
    // Nothing was written on the way to refusing.
    expect(await prisma.payment.count()).toBe(0);
  });

  /**
   * A booking made on an unconfigured install looks exactly as it always has:
   * manual mode, no payment status, no ledger. This is the "nothing changed for
   * existing behaviour" assertion.
   */
  it("leaves a new booking looking exactly as it did before payments existed", async () => {
    const booking = await createBooking();

    expect(booking.paymentMode).toBe("MANUAL");
    expect(booking.paymentStatus).toBe("NONE");
    expect(booking.paymentReference).toBeNull();
    expect(await prisma.payment.count()).toBe(0);
  });
});

describe("the manual flow, end to end through the workflow", () => {
  /**
   * Step 1 of the handover is unchanged for the owner — the same button, the
   * same amounts, the same confirmation — and now also writes a ledger entry,
   * so `paymentStatus` finally answers a question it has always returned "NONE"
   * to.
   *
   * The booking must still end CONFIRMED with its nights blocked, because that
   * is what step 1 has always done and the ledger entry must not be able to
   * change it.
   */
  it("confirms the booking AND records what the owner collected", async () => {
    const admin = await prisma.user.create({
      data: {
        email: "operator@example.ae",
        name: "Operator",
        passwordHash: "$2a$10$testtesttesttesttesttesttesttesttesttesttesttesttestte",
        role: "ADMIN",
      },
    });
    signInAs(admin.id);

    const booking = await createBooking({ total: 2000, depositDue: 600 });

    const result = await advanceRequestStage(booking.id, {
      step: "DEPOSIT",
      depositCollected: 600,
      securityCollected: 0,
    });
    expect(result.ok).toBe(true);

    const after = await prisma.bookingRequest.findUniqueOrThrow({ where: { id: booking.id } });
    expect(after.status).toBe("CONFIRMED");
    expect(after.stage).toBe("BALANCE");
    expect(after.depositCollected).toBe(600);
    // The new part: the ledger, and the roll-up over it.
    expect(after.paymentStatus).toBe("PAID");

    const payment = await prisma.payment.findFirstOrThrow({ where: { bookingId: booking.id } });
    expect(payment.provider).toBe("MANUAL");
    expect(payment.amount).toBe(600);

    // And the calendar closed, exactly as before.
    const blocked = await prisma.availability.count({ where: { listingId: after.listingId } });
    expect(blocked).toBe(2);
  });

  /** A booking with no deposit writes no ledger entry — there is nothing to record. */
  it("records nothing when no deposit was collected", async () => {
    const admin = await prisma.user.create({
      data: {
        email: "operator2@example.ae",
        name: "Operator",
        passwordHash: "$2a$10$testtesttesttesttesttesttesttesttesttesttesttesttestte",
        role: "ADMIN",
      },
    });
    signInAs(admin.id);

    const booking = await createBooking({ total: 2000, depositDue: 0 });

    const result = await advanceRequestStage(booking.id, {
      step: "DEPOSIT",
      depositCollected: 0,
      securityCollected: 0,
    });
    expect(result.ok).toBe(true);

    expect(await prisma.payment.count()).toBe(0);
    const after = await prisma.bookingRequest.findUniqueOrThrow({ where: { id: booking.id } });
    expect(after.status).toBe("CONFIRMED");
    expect(after.paymentStatus).toBe("NONE");
  });
});

describe("confirmation is authorised by the payment itself", () => {
  /**
   * `confirmBookingForPayment` is exported from a "use server" module, which
   * makes it reachable as a POST by anyone who can reach the site. It must
   * therefore not be possible to confirm a booking — closing its calendar — by
   * naming one. The only authority it accepts is a payment row that has already
   * reached PAID, which only a server-side verification can produce.
   */
  it("refuses a payment id that does not exist", async () => {
    const result = await confirmBookingForPayment("no-such-payment");
    expect(result.ok).toBe(false);
  });

  it("refuses a payment that has not settled", async () => {
    const booking = await createBooking();
    const payment = await prisma.payment.create({
      data: {
        bookingId: booking.id,
        provider: "TELR",
        amount: 600,
        providerRef: "order-unsettled",
        // The state an attacker would want: an order exists, nobody has paid.
        status: "AWAITING_PAYMENT",
      },
    });

    const result = await confirmBookingForPayment(payment.id);
    expect(result.ok).toBe(false);

    const after = await prisma.bookingRequest.findUniqueOrThrow({ where: { id: booking.id } });
    expect(after.status).toBe("NEW");
    // And no nights were taken off the market.
    expect(await prisma.availability.count()).toBe(0);
  });

  it("confirms on a settled payment, using that payment's own amount", async () => {
    const booking = await createBooking({ total: 2000, depositDue: 600 });
    const payment = await prisma.payment.create({
      data: {
        bookingId: booking.id,
        provider: "TELR",
        amount: 600,
        providerRef: "order-settled",
        status: "PAID",
        paidAt: new Date(),
      },
    });

    const result = await confirmBookingForPayment(payment.id);
    expect(result).toEqual({ ok: true, confirmed: true });

    const after = await prisma.bookingRequest.findUniqueOrThrow({ where: { id: booking.id } });
    expect(after.status).toBe("CONFIRMED");
    expect(after.stage).toBe("BALANCE");
    expect(after.depositCollected).toBe(600);
    expect(await prisma.availability.count()).toBe(2);
  });

  /** A second webhook for the same payment must be a no-op, not an error. */
  it("is a no-op the second time, without reporting a failure", async () => {
    const booking = await createBooking();
    const payment = await prisma.payment.create({
      data: {
        bookingId: booking.id,
        provider: "TELR",
        amount: 600,
        providerRef: "order-twice",
        status: "PAID",
        paidAt: new Date(),
      },
    });

    expect(await confirmBookingForPayment(payment.id)).toEqual({ ok: true, confirmed: true });
    expect(await confirmBookingForPayment(payment.id)).toEqual({ ok: true, confirmed: false });

    // Confirmed once. The listing's booking counter did not move twice.
    const listing = await prisma.listing.findUniqueOrThrow({
      where: { id: booking.listingId },
    });
    expect(listing.bookingsCount).toBe(1);
  });
});

describe("a link is not burned by a gateway that never took an order", () => {
  /**
   * `markLinkUsed` runs before the gateway call, so two taps cannot produce two
   * orders. The cost is that a gateway refusing outright would have left the
   * guest holding a dead link under a "try again shortly" message that could
   * never work. `releasePaymentLink` is the way back, and it only applies while
   * no attempt is attached.
   */
  it("hands the link back when no payment was ever attached", async () => {
    const { token, linkId } = await seedLink();

    expect(await markLinkUsed(linkId)).toBe(true);
    expect((await resolvePaymentLink(token)).ok).toBe(false);

    expect(await releasePaymentLink(linkId)).toBe(true);
    expect((await resolvePaymentLink(token)).ok).toBe(true);
  });

  /** Once an attempt exists the link stays spent, whatever happened next. */
  it("refuses to release a link that produced a payment", async () => {
    const { linkId, booking } = await seedLink();

    const payment = await prisma.payment.create({
      data: {
        bookingId: booking.id,
        provider: "TELR",
        amount: 600,
        providerRef: "order-from-link",
        status: "AWAITING_PAYMENT",
      },
    });
    await prisma.paymentLink.update({
      where: { id: linkId },
      data: { paymentId: payment.id },
    });

    await markLinkUsed(linkId);
    expect(await releasePaymentLink(linkId)).toBe(false);
  });
});

/* -------------------------------------------------------------------------- */

/** The booking shape `resolvePayable` reads. */
async function loadPayable(id: string) {
  const booking = await prisma.bookingRequest.findUniqueOrThrow({
    where: { id },
    select: {
      id: true,
      reference: true,
      status: true,
      total: true,
      depositDue: true,
      paymentMode: true,
      customerName: true,
      customerPhone: true,
      customerEmail: true,
      listingId: true,
      listing: { select: { name: true, slug: true, paymentModes: true } },
      payments: { select: { id: true, status: true, amount: true, kind: true } },
    },
  });
  return booking;
}

/**
 * Open all three gates, so the checks BEHIND them can be exercised.
 *
 * The credentials are stubs and nothing is ever sent anywhere: `issuePaymentLink`
 * only reads the settings row and writes a token, and the gateway is not
 * contacted on that path at all. What the stub buys is reaching the
 * CONFIRMED-booking and owner-scope checks, which the credential gate would
 * otherwise short-circuit — as the test above it asserts that it does.
 *
 * Undone by `vi.unstubAllEnvs()` in `beforeEach`, so no other test in this file
 * or any other sees a configured gateway.
 */
async function enablePaymentLinks() {
  vi.stubEnv("TELR_STORE_ID", "test-store");
  vi.stubEnv("TELR_AUTH_KEY", "test-key");

  await prisma.siteSettings.update({
    where: { id: 1 },
    data: { depositPaymentsEnabled: true, telrEnabled: true, paymentLinksEnabled: true },
  });
}

/**
 * A link row, minted the way `issuePaymentLink` mints one.
 *
 * Created directly because issuing goes through the credential gate, and no
 * credentials exist in a test process — deliberately, since that gate is
 * itself under test above. What is being exercised here is everything the
 * token does once it exists.
 */
async function seedLink() {
  const { generatePaymentToken } = await import("@/lib/payments/links");
  const booking = await createBooking({ status: "CONFIRMED" });
  const token = generatePaymentToken();

  const link = await prisma.paymentLink.create({
    data: {
      token,
      bookingId: booking.id,
      amount: 600,
      currency: "AED",
      kind: "DEPOSIT",
      expiresAt: new Date(Date.now() + 7 * 86_400_000),
    },
  });

  return { token, linkId: link.id, booking };
}
