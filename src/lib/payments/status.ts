import { createHash } from "node:crypto";
import {
  PAYMENT_LIFECYCLE,
  isPaymentLifecycle,
  isTerminalPayment,
  type PaymentLifecycle,
  type PaymentStatus,
} from "@/lib/constants";

/**
 * The status layer — where every provider's vocabulary is translated into this
 * platform's, and where the booking-level roll-up is computed.
 *
 * Deliberately free of Prisma, `next/headers` and any provider SDK: it is pure
 * functions over strings and numbers, so it is importable from an adapter, from
 * a server action and from the test suite alike, and every rule in it can be
 * tested without a database.
 */

/**
 * Map a provider's status string onto the internal lifecycle.
 *
 * Each adapter passes its own table. The important behaviour is the FALLBACK:
 * an unrecognised value resolves to "PROCESSING", never to "PAID" and never to
 * "FAILED".
 *
 * That choice is the safe one in both directions, and it is worth being
 * explicit about why, because the obvious alternatives are both wrong:
 *   * falling back to "PAID" would mean a gateway inventing a new status code
 *     confirms bookings nobody paid for
 *   * falling back to "FAILED" would cancel real, settled payments the moment a
 *     provider added a status this build had never seen — losing money that has
 *     already left the guest's account
 * "PROCESSING" is neither: the booking stays unconfirmed, the payment stays
 * in-flight, a later delivery or a reconciliation poll can still resolve it, and
 * the raw string is on `Payment.providerStatus` for whoever investigates.
 */
export function toInternalStatus(
  providerStatus: string | null | undefined,
  table: Record<string, PaymentLifecycle>,
): PaymentLifecycle {
  if (!providerStatus) return "PROCESSING";
  const key = providerStatus.trim().toUpperCase();
  return table[key] ?? "PROCESSING";
}

/**
 * May a payment move from `from` to `to`?
 *
 * The rule is deliberately blunt: **a terminal status is never overwritten**.
 *
 * That is what stops the two orderings a payment gateway will eventually
 * produce from corrupting a booking. A webhook arriving after the guest has
 * already been verified on the return URL would otherwise re-apply, and — worse
 * — a delayed "expired" notification arriving after a successful capture would
 * flip a PAID booking to CANCELLED and re-open a rest house that has been paid
 * for. Neither is hypothetical; both are ordinary gateway behaviour under
 * retry.
 *
 * The one exception is the refund, which is precisely a transition *out* of a
 * terminal state and is the only one allowed.
 */
export function canTransition(from: string, to: PaymentLifecycle): boolean {
  if (from === to) return false;
  if (to === "REFUNDED") return from === "PAID";
  if (isTerminalPayment(from)) return false;
  return (PAYMENT_LIFECYCLE as readonly string[]).includes(to);
}

/**
 * The booking-level answer, computed from every attempt on that booking.
 *
 * ─── Why it is computed rather than assigned ────────────────────────────────
 * A booking can carry several payments: a declined card, then a successful one;
 * a deposit now and a balance later; a settled charge and then its refund.
 * Writing `paymentStatus` from whichever attempt happened to change last would
 * mean a failed retry after a successful charge downgrades a paid booking to
 * unpaid — which is exactly the sequence a guest produces by pressing "pay
 * again" on a page they left open.
 *
 * So the roll-up is a fold over the whole ledger, in a fixed order of
 * precedence:
 *
 *   REFUNDED  wins outright — money has gone back, whatever else happened
 *   PAID      any settled attempt
 *   PENDING   any attempt still in flight
 *   NONE      nothing but failures, cancellations, or no attempts at all
 *
 * Note the last line: a booking whose only payment attempt FAILED reads "NONE",
 * not "PENDING". "PENDING" on this column means "money is on its way"; a
 * declined card is not money on its way, and an operator chasing the pending
 * list should not find it there.
 */
export function rollUpPaymentStatus(
  payments: readonly { status: string }[],
): PaymentStatus {
  if (payments.some((p) => p.status === "REFUNDED")) return "REFUNDED";
  if (payments.some((p) => p.status === "PAID")) return "PAID";
  if (
    payments.some(
      (p) =>
        p.status === "PENDING" ||
        p.status === "AWAITING_PAYMENT" ||
        p.status === "PROCESSING",
    )
  ) {
    return "PENDING";
  }
  return "NONE";
}

/**
 * Which attempt's reference belongs on `BookingRequest.paymentReference`.
 *
 * The settled one, so an operator matching a bank statement against a booking
 * finds the charge that actually cleared rather than the decline that preceded
 * it. Falls back to the most recent attempt with a reference at all, which is
 * what someone investigating a stuck payment needs.
 */
export function rollUpPaymentReference(
  payments: readonly { status: string; providerRef: string | null; createdAt: Date }[],
): string | null {
  const paid = payments.find((p) => p.status === "PAID" && p.providerRef);
  if (paid) return paid.providerRef;

  const withRef = payments
    .filter((p) => p.providerRef)
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());

  return withRef[0]?.providerRef ?? null;
}

/**
 * A stable id for one delivery, for providers that do not send one.
 *
 * Becomes `PaymentEvent.eventId`, under a unique index — so what this digest
 * means in practice is "this provider has already told us this exact thing".
 * Two genuinely different deliveries about one payment (authorised, then
 * captured) hash differently and both apply; the same delivery retried three
 * times hashes identically and applies once.
 *
 * A digest rather than the raw body: a payload can be large, and an index on
 * an unbounded string is a footgun. Hex-encoded SHA-256, matching
 * src/lib/security/sha256.ts.
 */
export function eventKey(...parts: (string | null | undefined)[]): string {
  return createHash("sha256").update(parts.map((p) => p ?? "").join("|")).digest("hex");
}

/**
 * Normalise a stored status read back from the database.
 *
 * A row written by a future build, or corrupted by hand, must not crash a page
 * that renders a list of payments. Anything unrecognised reads as "PROCESSING"
 * — the same neutral answer `toInternalStatus` gives, and for the same reason.
 */
export function toPaymentLifecycle(v: unknown): PaymentLifecycle {
  return isPaymentLifecycle(v) ? v : "PROCESSING";
}
