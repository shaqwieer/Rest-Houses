import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { auditData } from "@/lib/audit";
import {
  PAYMENT_CURRENCY,
  isPaymentKind,
  isPaymentMethod,
  isPaymentProvider,
  type PaymentKind,
  type PaymentLifecycle,
  type PaymentProviderId,
} from "@/lib/constants";
import { absoluteUrl, getSettings } from "@/lib/settings";
import type { Locale } from "@/lib/i18n/config";
import { getProvider } from "./providers";
import { availableProviders, providerState } from "./config";
import { isModeAvailable } from "./methods";
import {
  canTransition,
  rollUpPaymentReference,
  rollUpPaymentStatus,
} from "./status";
import type { CallbackRequest } from "./types";

/**
 * The payment service — the only module that writes to the payment tables.
 *
 * Everything in here is server-side and authoritative. The three rules it
 * exists to enforce, none of which any caller may bypass:
 *
 *   1. **The amount comes from the database.** Never from a form, never from a
 *      query string, never from a provider's response. `resolvePayable()` reads
 *      the booking and computes what is owed; a request that names a figure is
 *      ignored, because there is no parameter to name one through.
 *
 *   2. **Only a server-to-server verification may mark a payment PAID.** A
 *      browser arriving at the return URL is a hint. `applyCallback()` takes
 *      nothing but the *reference* from a delivery and then asks the provider
 *      directly.
 *
 *   3. **A delivery is applied at most once.** Enforced by the unique index on
 *      `PaymentEvent(provider, eventId)` — a database constraint, not a
 *      read-then-write check, because two concurrent webhook retries both pass
 *      the latter.
 *
 * A fourth property falls out of the schema rather than this file: a payment
 * belongs to exactly one booking through a foreign key that nothing updates, so
 * money taken for one booking can never be applied to another.
 */

/** A stable failure code. Resolved against the dictionary by the caller. */
export type PaymentFailure =
  | "PAYMENTS_DISABLED"
  | "PROVIDER_UNAVAILABLE"
  | "MODE_UNAVAILABLE"
  | "BOOKING_NOT_FOUND"
  | "BOOKING_NOT_PAYABLE"
  | "NOTHING_DUE"
  | "INVALID_AMOUNT"
  | "INVALID_CURRENCY"
  | "ALREADY_PAID"
  | "GATEWAY_ERROR"
  | "AMOUNT_MISMATCH"
  | "LINK_INVALID"
  | "LINK_EXPIRED"
  | "LINK_USED";

export type StartPaymentResult =
  | { ok: true; paymentId: string; checkoutUrl: string }
  | { ok: false; reason: PaymentFailure; detail?: string };

/**
 * The audit actor for anything a gateway caused.
 *
 * There is no signed-in user on the webhook path — the caller is another
 * company's server — so the actor is named rather than left blank. A blank
 * actor in the log is indistinguishable from a bug that forgot to record one,
 * and "who confirmed this booking" is a question the payment trail has to be
 * able to answer.
 */
const SYSTEM_ACTOR = { id: null, email: "system:payments", role: "SYSTEM" } as const;

/**
 * The columns every payment decision needs off a booking.
 *
 * A named selection rather than the whole row: this is money, and a function
 * that quietly gained access to `notes` or `customerEmail` because it selected
 * everything is how private data reaches a log line.
 */
const BOOKING_SELECT = {
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
} satisfies Prisma.BookingRequestSelect;

type PayableBooking = Prisma.BookingRequestGetPayload<{ select: typeof BOOKING_SELECT }>;

/**
 * Server-side amount validation.
 *
 * Whole dirhams, strictly positive, and below a ceiling. The ceiling is not
 * paranoia about arithmetic — it is the last line against a corrupted or
 * hand-edited booking row producing a charge nobody intended. The most
 * expensive rest house on this platform is a few thousand dirhams a night for a
 * stay capped at 60 nights, so a quarter of a million is far above anything
 * legitimate and far below anything catastrophic.
 */
const MAX_CHARGE_AED = 250_000;

export function assertChargeable(
  amount: number,
  currency: string,
): { ok: true } | { ok: false; reason: PaymentFailure } {
  if (!Number.isInteger(amount) || amount <= 0 || amount > MAX_CHARGE_AED) {
    return { ok: false, reason: "INVALID_AMOUNT" };
  }
  // One currency, checked rather than assumed. Every stored amount is whole
  // dirhams; a payment in anything else cannot be reconciled against a booking
  // total without a rate nobody has recorded.
  if (currency !== PAYMENT_CURRENCY) {
    return { ok: false, reason: "INVALID_CURRENCY" };
  }
  return { ok: true };
}

/** What has already settled against this booking. */
function paidSoFar(booking: PayableBooking): number {
  return booking.payments
    .filter((p) => p.status === "PAID")
    .reduce((sum, p) => sum + p.amount, 0);
}

/**
 * What is owed, for one kind of payment.
 *
 * Computed from the stored snapshot — `depositDue` and `total` are the figures
 * quoted at request time and never re-derived from the listing's current price,
 * which is the discipline every amount in this schema follows.
 *
 * BALANCE and FULL both net off what has already settled, so a guest who paid a
 * deposit online and then opens a payment link is asked for the remainder
 * rather than the whole total again.
 */
export function resolvePayable(
  booking: PayableBooking,
  kind: PaymentKind,
): { ok: true; amount: number } | { ok: false; reason: PaymentFailure } {
  const settled = paidSoFar(booking);

  const amount =
    kind === "DEPOSIT"
      ? booking.depositDue
      : Math.max(0, booking.total - settled);

  if (amount <= 0) {
    return { ok: false, reason: settled >= booking.total ? "ALREADY_PAID" : "NOTHING_DUE" };
  }

  const check = assertChargeable(amount, PAYMENT_CURRENCY);
  if (!check.ok) return check;

  return { ok: true, amount };
}

/**
 * Open a checkout for a booking.
 *
 * The gate order matters and is deliberate: the *global* switch first, then the
 * listing's own modes, then the provider, then the money. A caller that fails
 * the first check never reaches a database read, and a listing whose owner
 * switched online payment off between page load and submit is refused here
 * rather than on the provider's page.
 *
 * `amountOverride` exists for one caller only — a payment link, whose amount is
 * the snapshot stored on `PaymentLink` when the owner issued it. It is not a
 * way to name a price: `redeemPaymentLink()` reads it from the link row, and no
 * public entry point can reach this parameter.
 */
export async function startPayment(input: {
  bookingId: string;
  provider: PaymentProviderId;
  kind: PaymentKind;
  locale: Locale;
  amountOverride?: number;
  linkId?: string;
}): Promise<StartPaymentResult> {
  const settings = await getSettings();

  if (availableProviders(settings).length === 0) {
    return { ok: false, reason: "PAYMENTS_DISABLED" };
  }
  if (providerState(settings, input.provider) !== "ENABLED") {
    return { ok: false, reason: "PROVIDER_UNAVAILABLE" };
  }

  const booking = await prisma.bookingRequest.findUnique({
    where: { id: input.bookingId },
    select: BOOKING_SELECT,
  });
  if (!booking) return { ok: false, reason: "BOOKING_NOT_FOUND" };

  // A rejected or cancelled booking must not be payable. Without this a stale
  // checkout URL — or a payment link issued before the owner rejected the
  // request — would still take the guest's money for a stay that is not
  // happening.
  if (booking.status === "REJECTED" || booking.status === "CANCELLED") {
    return { ok: false, reason: "BOOKING_NOT_PAYABLE" };
  }

  // The mode the owner allows for this listing, re-checked server-side.
  const mode = input.linkId ? "LINK" : "ONLINE";
  if (!isModeAvailable(mode, booking.listing?.paymentModes, settings)) {
    return { ok: false, reason: "MODE_UNAVAILABLE" };
  }

  const payable = input.amountOverride
    ? { ok: true as const, amount: input.amountOverride }
    : resolvePayable(booking, input.kind);
  if (!payable.ok) return payable;

  // Even the link's stored snapshot is re-validated. A row edited by hand, or
  // written by a build with a different ceiling, must not become a charge.
  const chargeable = assertChargeable(payable.amount, PAYMENT_CURRENCY);
  if (!chargeable.ok) return chargeable;

  const adapter = getProvider(input.provider);
  if (!adapter) return { ok: false, reason: "PROVIDER_UNAVAILABLE" };

  // The row is created BEFORE the gateway is called, so its id can be the
  // merchant reference the provider echoes back. A row created afterwards would
  // need a second write to attach the reference, and a crash between the two
  // would leave a real charge this platform has no record of.
  const payment = await prisma.payment.create({
    data: {
      bookingId: booking.id,
      provider: input.provider,
      kind: input.kind,
      amount: payable.amount,
      currency: PAYMENT_CURRENCY,
      status: "PENDING",
    },
    select: { id: true },
  });

  const checkout = await adapter.createCheckout({
    paymentId: payment.id,
    amount: payable.amount,
    currency: PAYMENT_CURRENCY,
    kind: input.kind,
    bookingReference: booking.reference,
    listingName: booking.listing?.name ?? "",
    customerName: booking.customerName,
    customerPhone: booking.customerPhone,
    customerEmail: booking.customerEmail,
    returnUrl: absoluteUrl(`/api/payments/${input.provider.toLowerCase()}/return`),
    cancelUrl: absoluteUrl(`/booking/${encodeURIComponent(booking.reference)}`),
    webhookUrl: absoluteUrl(`/api/payments/${input.provider.toLowerCase()}/webhook`),
    locale: input.locale === "en" ? "en" : "ar",
  });

  if (!checkout.ok) {
    // The attempt is recorded as failed rather than deleted. A gateway that
    // refused us is exactly the thing an operator needs to see, and a row that
    // disappears on failure means the only evidence is a log line nobody reads.
    await prisma.payment.update({
      where: { id: payment.id },
      data: { status: "FAILED", failureReason: checkout.message.slice(0, 500) },
    });
    return { ok: false, reason: "GATEWAY_ERROR", detail: checkout.code };
  }

  await prisma.$transaction([
    prisma.payment.update({
      where: { id: payment.id },
      data: {
        status: "AWAITING_PAYMENT",
        providerRef: checkout.providerRef,
        providerStatus: checkout.providerStatus ?? null,
        metadata: safeJson(checkout.metadata),
      },
    }),
    ...(input.linkId
      ? [
          prisma.paymentLink.update({
            where: { id: input.linkId },
            data: { paymentId: payment.id },
          }),
        ]
      : []),
    prisma.bookingRequest.update({
      where: { id: booking.id },
      data: { paymentMode: input.linkId ? "LINK" : "ONLINE", paymentStatus: "PENDING" },
    }),
    prisma.auditLog.create({
      data: auditData({
        actor: SYSTEM_ACTOR,
        action: "PAYMENT_INITIATED",
        entityType: "Payment",
        entityId: payment.id,
        summary: `${input.provider} ${payable.amount} ${PAYMENT_CURRENCY} — ${booking.reference}`,
        // The reference and the amount, never a credential and never a card.
        metadata: {
          provider: input.provider,
          kind: input.kind,
          amount: payable.amount,
          currency: PAYMENT_CURRENCY,
          bookingReference: booking.reference,
          providerRef: checkout.providerRef,
        },
      }),
    }),
  ]);

  return { ok: true, paymentId: payment.id, checkoutUrl: checkout.checkoutUrl };
}

export type CallbackOutcome =
  | {
      ok: true;
      /** So the route can send the guest back to their own booking page. */
      bookingReference: string | null;
      /** Absent on a duplicate delivery — nothing was looked up, because nothing
       *  needed to be. */
      bookingId?: string;
      /** The attempt this delivery was about. What the caller hands to
       *  `confirmBookingForPayment`, which re-reads it rather than trusting
       *  anything else in this object. */
      paymentId?: string;
      kind?: PaymentKind;
      amount?: number;
      provider?: PaymentProviderId;
      providerRef?: string;
      status: PaymentLifecycle | null;
      /** True when this delivery had already been applied. Not an error — it is
       *  the mechanism working. */
      duplicate: boolean;
    }
  | { ok: false; reason: PaymentFailure | "UNVERIFIED" | "UNKNOWN_REFERENCE"; detail?: string };

/**
 * Apply one delivery from a provider — a webhook, or the guest's return.
 *
 * The sequence, and why it is this way round:
 *
 *   1. **Parse and authenticate.** The adapter checks the signature (where the
 *      provider offers one) and extracts the reference. Nothing is trusted
 *      about the *status* it claims.
 *   2. **Record the event.** Inside its own insert, whose unique index rejects
 *      a duplicate. This happens BEFORE any verification, so a provider
 *      hammering a retry cannot make this server issue an outbound call per
 *      retry.
 *   3. **Verify with the provider.** An outbound, authenticated call. This is
 *      the only thing whose answer can settle a payment.
 *   4. **Settle.** Amount and currency re-checked against what was owed, the
 *      transition checked against the current status, the booking roll-up
 *      recomputed, and an audit row written — all in one transaction.
 *
 * Step 2 before step 3 is the piece that is easy to get backwards. Verifying
 * first and recording second leaves a window in which two retries both verify
 * and both settle.
 */
export async function applyCallback(
  providerId: string,
  request: CallbackRequest,
): Promise<CallbackOutcome> {
  if (!isPaymentProvider(providerId) || providerId === "MANUAL") {
    return { ok: false, reason: "PROVIDER_UNAVAILABLE" };
  }

  const adapter = getProvider(providerId);
  if (!adapter) return { ok: false, reason: "PROVIDER_UNAVAILABLE" };

  const parsed = await adapter.parseCallback(request);
  if (!parsed.ok) {
    return {
      ok: false,
      reason: parsed.code === "UNVERIFIED" ? "UNVERIFIED" : "GATEWAY_ERROR",
      detail: parsed.code,
    };
  }

  const payment = await prisma.payment.findUnique({
    where: { provider_providerRef: { provider: providerId, providerRef: parsed.providerRef } },
    select: {
      id: true,
      status: true,
      amount: true,
      currency: true,
      kind: true,
      bookingId: true,
      booking: { select: { reference: true } },
    },
  });

  // --- step 2: record the delivery, idempotently ---------------------------
  //
  // Written even when no payment matches. A callback for a reference this
  // platform has never issued is the one thing worth keeping a record of — a
  // stray retry after a restore, or somebody probing the endpoint — and
  // dropping it silently means the only evidence never existed.
  try {
    await prisma.paymentEvent.create({
      data: {
        paymentId: payment?.id ?? null,
        provider: providerId,
        eventId: parsed.eventId,
        kind: request.kind,
        providerStatus: parsed.providerStatus ?? null,
        payload: truncate(request.rawBody || JSON.stringify(request.query), 8_000),
      },
    });
  } catch (error) {
    // P2002 — the unique index on (provider, eventId) fired. This exact
    // delivery has been applied before, so the work is already done and saying
    // so is a success, not a failure: returning an error here would make the
    // provider retry a delivery that has already taken effect.
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return {
        ok: true,
        bookingReference: payment?.booking.reference ?? null,
        status: null,
        duplicate: true,
      };
    }
    throw error;
  }

  if (!payment) return { ok: false, reason: "UNKNOWN_REFERENCE" };

  // --- step 3: ask the provider what actually happened ---------------------
  const verified = await adapter.verifyPayment({
    providerRef: parsed.providerRef,
    expectedAmount: payment.amount,
    expectedCurrency: payment.currency,
  });

  if (!verified.ok) {
    return { ok: false, reason: "GATEWAY_ERROR", detail: verified.code };
  }

  const settled = await settlePayment({
    paymentId: payment.id,
    status: verified.status,
    providerStatus: verified.providerStatus,
    method: verified.method,
    paidAmount: verified.paidAmount,
    paidCurrency: verified.paidCurrency,
    failureReason: verified.failureReason,
    metadata: verified.metadata,
  });

  if (!settled.ok) return settled;

  return {
    ok: true,
    bookingId: payment.bookingId,
    paymentId: payment.id,
    bookingReference: payment.booking.reference,
    kind: payment.kind as PaymentKind,
    amount: payment.amount,
    provider: providerId,
    providerRef: parsed.providerRef,
    status: settled.status,
    duplicate: false,
  };
}

/**
 * Write a verified outcome onto a payment, and roll it up onto the booking.
 *
 * ─── The amount check ───────────────────────────────────────────────────────
 * A provider reporting a payment for less than was owed does NOT settle the
 * booking. It is recorded — status, provider status and the figure that came
 * back all land on the row — and the payment is left un-settled for a human,
 * because a partial payment is a commercial conversation and not something this
 * function can decide. Silently accepting it would confirm a booking for a
 * fraction of its price; silently rejecting it would lose the record of money
 * that really did move.
 *
 * ─── The transition check ───────────────────────────────────────────────────
 * `canTransition` refuses to overwrite a terminal status. That is what makes a
 * late "expired" notification arriving after a successful capture a no-op
 * instead of a cancelled booking that has already been paid for.
 */
export async function settlePayment(input: {
  paymentId: string;
  status: PaymentLifecycle;
  providerStatus: string;
  method?: string;
  paidAmount?: number;
  paidCurrency?: string;
  failureReason?: string;
  metadata?: Record<string, unknown>;
}): Promise<
  { ok: true; status: PaymentLifecycle } | { ok: false; reason: PaymentFailure; detail?: string }
> {
  const payment = await prisma.payment.findUnique({
    where: { id: input.paymentId },
    select: { id: true, status: true, amount: true, currency: true, bookingId: true },
  });
  if (!payment) return { ok: false, reason: "BOOKING_NOT_FOUND" };

  let status = input.status;
  let mismatch: string | undefined;

  if (status === "PAID") {
    const amountOk =
      input.paidAmount === undefined || input.paidAmount === payment.amount;
    const currencyOk =
      input.paidCurrency === undefined || input.paidCurrency === payment.currency;

    if (!amountOk || !currencyOk) {
      // Recorded, not settled. See the note above.
      mismatch = `expected ${payment.amount} ${payment.currency}, provider reported ${input.paidAmount ?? "?"} ${input.paidCurrency ?? "?"}`;
      status = "PROCESSING";
    }
  }

  // The provider's word is always written down, even when it changes nothing —
  // `providerStatus` is the only record of what a gateway actually said.
  const observed = {
    providerStatus: input.providerStatus,
    method: input.method && isPaymentMethod(input.method) ? input.method : undefined,
    metadata: safeJson(input.metadata),
  };

  if (!canTransition(payment.status, status)) {
    await prisma.payment.update({
      where: { id: payment.id },
      data: {
        providerStatus: observed.providerStatus,
        ...(observed.method ? { method: observed.method } : {}),
      },
    });
    return { ok: true, status: payment.status as PaymentLifecycle };
  }

  await prisma.payment.update({
    where: { id: payment.id },
    data: {
      status,
      providerStatus: observed.providerStatus,
      ...(observed.method ? { method: observed.method } : {}),
      metadata: observed.metadata,
      failureReason: mismatch ?? input.failureReason?.slice(0, 500) ?? null,
      ...(status === "PAID" ? { paidAt: new Date() } : {}),
      ...(status === "REFUNDED" ? { refundedAt: new Date() } : {}),
    },
  });

  await refreshBookingPaymentRollup(payment.bookingId);

  await prisma.auditLog.create({
    data: auditData({
      actor: SYSTEM_ACTOR,
      action:
        status === "PAID"
          ? "PAYMENT_SETTLED"
          : status === "REFUNDED"
            ? "PAYMENT_REFUNDED"
            : "PAYMENT_FAILED",
      entityType: "Payment",
      entityId: payment.id,
      summary: `${status} — ${payment.amount} ${payment.currency}`,
      metadata: {
        status,
        providerStatus: input.providerStatus,
        amount: payment.amount,
        currency: payment.currency,
        ...(mismatch ? { mismatch } : {}),
      },
    }),
  });

  return { ok: true, status };
}

/**
 * Recompute `BookingRequest.paymentStatus` / `paymentReference` from the ledger.
 *
 * Called after every change to a payment. Cheap — one indexed read of a
 * handful of rows — and it is what keeps the denormalised pair honest without
 * any caller having to remember the precedence rules, which live in
 * `rollUpPaymentStatus`.
 *
 * Note what this deliberately does NOT do: it does not confirm the booking.
 * Closing a calendar is a separate decision with its own clash re-check and its
 * own transaction — see `confirmBookingForPayment` in
 * src/app/actions/requests.ts.
 */
export async function refreshBookingPaymentRollup(bookingId: string): Promise<void> {
  const payments = await prisma.payment.findMany({
    where: { bookingId },
    select: { status: true, providerRef: true, createdAt: true },
    orderBy: { createdAt: "desc" },
  });

  await prisma.bookingRequest.update({
    where: { id: bookingId },
    data: {
      paymentStatus: rollUpPaymentStatus(payments),
      paymentReference: rollUpPaymentReference(payments),
    },
  });
}

/**
 * Record money the owner collected off-platform — a bank transfer, or cash.
 *
 * This is the "MANUAL" provider, and it is what makes the ledger complete: with
 * it, "what has this booking been paid" has one answer whatever route the money
 * took, and nothing that reads `paymentStatus` needs a special case for the
 * flow this platform has always used.
 *
 * It writes a `Payment` row and nothing else. It does not confirm the booking,
 * does not touch the calendar and does not advance the handover — step 1 of the
 * workflow already does all three, and this is called from inside that step so
 * they commit together. See `applyStageAdvance` in src/app/actions/requests.ts.
 */
export async function recordManualPayment(input: {
  bookingId: string;
  amount: number;
  reference?: string | null;
  actor: { id?: string | null; email?: string | null; role?: string | null };
}): Promise<{ ok: true; paymentId: string } | { ok: false; reason: PaymentFailure }> {
  const check = assertChargeable(input.amount, PAYMENT_CURRENCY);
  if (!check.ok) return check;

  const payment = await prisma.payment.create({
    data: {
      bookingId: input.bookingId,
      provider: "MANUAL",
      method: "BANK_TRANSFER",
      kind: "DEPOSIT",
      amount: input.amount,
      currency: PAYMENT_CURRENCY,
      // Straight to PAID: the owner is not reporting an intention, they are
      // reporting money they have. The verification here is a human one, and
      // the audit row below records which human.
      status: "PAID",
      providerRef: input.reference?.trim() || null,
      providerStatus: "CONFIRMED_BY_OWNER",
      paidAt: new Date(),
    },
    select: { id: true },
  });

  await refreshBookingPaymentRollup(input.bookingId);

  await prisma.auditLog.create({
    data: auditData({
      actor: input.actor,
      action: "PAYMENT_SETTLED",
      entityType: "Payment",
      entityId: payment.id,
      summary: `MANUAL ${input.amount} ${PAYMENT_CURRENCY}`,
      metadata: { provider: "MANUAL", amount: input.amount, currency: PAYMENT_CURRENCY },
    }),
  });

  return { ok: true, paymentId: payment.id };
}

/**
 * Return a settled payment.
 *
 * Calls the gateway where the adapter supports it, and records the outcome
 * either way — a provider without an API refund is not a reason to leave the
 * ledger saying a refunded booking is still paid, because the operator will
 * have done it from the gateway's own dashboard.
 *
 * `UNSUPPORTED` is therefore not treated as a failure: the row moves to
 * REFUNDED and the audit entry records that no API call was made.
 */
export async function refundPayment(input: {
  paymentId: string;
  reason: string;
  actor: { id?: string | null; email?: string | null; role?: string | null };
}): Promise<{ ok: true } | { ok: false; reason: PaymentFailure; detail?: string }> {
  const payment = await prisma.payment.findUnique({
    where: { id: input.paymentId },
    select: {
      id: true,
      provider: true,
      providerRef: true,
      status: true,
      amount: true,
      currency: true,
      bookingId: true,
    },
  });
  if (!payment) return { ok: false, reason: "BOOKING_NOT_FOUND" };
  if (payment.status !== "PAID") return { ok: false, reason: "BOOKING_NOT_PAYABLE" };

  const adapter = getProvider(payment.provider);
  let providerStatus = "REFUNDED_OFF_PLATFORM";

  if (adapter?.refund && payment.providerRef) {
    const result = await adapter.refund({
      providerRef: payment.providerRef,
      amount: payment.amount,
      currency: payment.currency,
      reason: input.reason,
    });
    if (!result.ok && result.code !== "UNSUPPORTED") {
      return { ok: false, reason: "GATEWAY_ERROR", detail: result.code };
    }
    if (result.ok) providerStatus = result.providerStatus ?? "REFUNDED";
  }

  await prisma.payment.update({
    where: { id: payment.id },
    data: { status: "REFUNDED", providerStatus, refundedAt: new Date() },
  });

  await refreshBookingPaymentRollup(payment.bookingId);

  await prisma.auditLog.create({
    data: auditData({
      actor: input.actor,
      action: "PAYMENT_REFUNDED",
      entityType: "Payment",
      entityId: payment.id,
      summary: `${payment.provider} ${payment.amount} ${payment.currency}`,
      metadata: { reason: input.reason.slice(0, 300), providerStatus },
    }),
  });

  return { ok: true };
}

/** JSON for a metadata column, never throwing and never unbounded. */
function safeJson(value: unknown): string {
  if (value === undefined || value === null) return "{}";
  try {
    return truncate(JSON.stringify(value), 4_000);
  } catch {
    return '{"_error":"unserialisable"}';
  }
}

function truncate(value: string, max: number): string {
  return value.length > max ? value.slice(0, max) : value;
}

export { isPaymentKind };
