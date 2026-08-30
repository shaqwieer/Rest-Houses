import { randomBytes } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { PAYMENT_CURRENCY, type PaymentKind } from "@/lib/constants";
import { absoluteUrl, getSettings } from "@/lib/settings";
import { assertChargeable, resolvePayable, type PaymentFailure } from "./service";
import { platformPaymentModes, resolveListingPaymentModes } from "./methods";

/**
 * Payment links — the "semi-self" flow.
 *
 * The shape the client asked for: the owner confirms the request first, and
 * only then does Rihla ask the guest to pay. That ordering matters commercially
 * — an owner who has not agreed to the dates should not have taken the money —
 * and it is enforced here rather than in the UI: `issuePaymentLink` refuses a
 * booking that is not CONFIRMED.
 *
 * ─── Why there is nothing in the URL but a token ────────────────────────────
 * The link is `/pay/<64 hex chars>` and carries no amount, no booking
 * reference and no signature. The amount, the currency and the booking are read
 * from the `PaymentLink` row that the token resolves to.
 *
 * That is a stronger guarantee than a signed URL, and cheaper. A signed
 * `?amount=1500&booking=RQ-2419&sig=…` has to be verified correctly on every
 * path that reads it, and the day somebody adds a second reader who forgets the
 * check, the amount becomes editable. Here there is no amount to edit: a guest
 * changing a character in the token gets "no such link", and the tampering
 * surface is a 256-bit random string.
 *
 * ─── The token is the whole authentication ──────────────────────────────────
 * Same reasoning as `ReviewInvite`, and higher stakes, so the same three
 * properties are load-bearing:
 *   * 32 random bytes from `crypto.randomBytes`, never derived from the booking
 *     reference — which the guest can read off their own confirmation page, and
 *     which would otherwise let them mint links for other people's bookings
 *   * `expiresAt` checked server-side on every visit, never in the UI
 *   * `usedAt` set the moment a checkout is opened, so a forwarded link cannot
 *     be replayed
 */

/** 32 bytes → 64 hex characters, matching `generateInviteToken`. */
const TOKEN_BYTES = 32;

export function generatePaymentToken(): string {
  return randomBytes(TOKEN_BYTES).toString("hex");
}

/** The absolute URL handed to the guest — it is sent over WhatsApp. */
export function paymentLinkUrl(token: string): string {
  return absoluteUrl(`/pay/${token}`);
}

export type IssueLinkResult =
  | { ok: true; token: string; url: string; amount: number; expiresAt: Date }
  | { ok: false; reason: PaymentFailure };

/**
 * Issue a link for one booking.
 *
 * `where` is passed in by the caller rather than built here, and that is the
 * authorisation mechanism: an owner's call supplies
 * `{ id, listing: { ownerId } }`, an operator's supplies `{ id }`. Asking for
 * somebody else's booking then returns "not found" — the same answer as for an
 * id that does not exist, which is both correct and leaks nothing about which
 * other bookings exist. Same pattern as `applyRequestStatus` in
 * src/app/actions/requests.ts and `authorizeListing` in
 * src/lib/listing-access.ts.
 */
export async function issuePaymentLink(input: {
  where: { id: string; listing?: { ownerId: string } };
  kind: PaymentKind;
  issuedById?: string | null;
}): Promise<IssueLinkResult> {
  const settings = await getSettings();

  if (!platformPaymentModes(settings).includes("LINK")) {
    return { ok: false, reason: "PAYMENTS_DISABLED" };
  }

  const booking = await prisma.bookingRequest.findFirst({
    where: input.where,
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
  if (!booking) return { ok: false, reason: "BOOKING_NOT_FOUND" };

  // The owner confirms FIRST. This is the whole point of the flow, and it is
  // checked here rather than trusted to the button that called us.
  if (booking.status !== "CONFIRMED") {
    return { ok: false, reason: "BOOKING_NOT_PAYABLE" };
  }

  if (!resolveListingPaymentModes(booking.listing?.paymentModes, settings).includes("LINK")) {
    return { ok: false, reason: "MODE_UNAVAILABLE" };
  }

  const payable = resolvePayable(booking, input.kind);
  if (!payable.ok) return payable;

  const days = Math.max(1, Math.min(90, settings.paymentLinkDays || 7));
  const expiresAt = new Date(Date.now() + days * 24 * 60 * 60 * 1000);
  const token = generatePaymentToken();

  await prisma.paymentLink.create({
    data: {
      token,
      bookingId: booking.id,
      // The snapshot, taken now. What the guest is asked for is what the owner
      // saw when they issued the link, which is the discipline every other
      // amount in this schema follows.
      amount: payable.amount,
      currency: PAYMENT_CURRENCY,
      kind: input.kind,
      expiresAt,
      issuedById: input.issuedById ?? null,
    },
  });

  return {
    ok: true,
    token,
    url: paymentLinkUrl(token),
    amount: payable.amount,
    expiresAt,
  };
}

export type ResolvedLink = {
  id: string;
  bookingId: string;
  amount: number;
  currency: string;
  kind: PaymentKind;
  expiresAt: Date;
  booking: {
    reference: string;
    status: string;
    customerName: string;
    listingName: string;
    listingSlug: string;
    listingPaymentModes: string | null;
  };
};

export type LinkLookup =
  | { ok: true; link: ResolvedLink }
  | { ok: false; reason: PaymentFailure };

/**
 * Resolve a token to its link, refusing anything not currently payable.
 *
 * Every one of these checks is server-side and repeated on every visit, because
 * the link lives in a WhatsApp thread forever and the state it points at moves:
 * a booking gets cancelled, a link expires, a guest pays and then re-opens the
 * message a week later.
 *
 * The token is looked up whole. There is no partial match, no id in the URL to
 * enumerate, and a wrong token is indistinguishable from an expired one to the
 * caller — `LINK_INVALID` rather than a message that would confirm a token
 * exists.
 */
export async function resolvePaymentLink(token: string): Promise<LinkLookup> {
  // Cheap shape check before the query — a 64-hex token is the only thing this
  // can ever be, so anything else is a probe and does not deserve a round trip.
  if (!/^[0-9a-f]{64}$/.test(token)) return { ok: false, reason: "LINK_INVALID" };

  const link = await prisma.paymentLink.findUnique({
    where: { token },
    select: {
      id: true,
      bookingId: true,
      amount: true,
      currency: true,
      kind: true,
      expiresAt: true,
      usedAt: true,
      booking: {
        select: {
          reference: true,
          status: true,
          customerName: true,
          paymentStatus: true,
          listing: { select: { name: true, slug: true, paymentModes: true } },
        },
      },
    },
  });

  if (!link) return { ok: false, reason: "LINK_INVALID" };
  if (link.usedAt) return { ok: false, reason: "LINK_USED" };
  if (link.expiresAt.getTime() <= Date.now()) return { ok: false, reason: "LINK_EXPIRED" };

  // The booking can have moved since the link was issued. A cancelled stay must
  // not still be collectable, and a booking already paid must not be paid twice
  // by a guest who re-opened the message.
  if (link.booking.status !== "CONFIRMED") return { ok: false, reason: "BOOKING_NOT_PAYABLE" };
  if (link.booking.paymentStatus === "PAID") return { ok: false, reason: "ALREADY_PAID" };

  const check = assertChargeable(link.amount, link.currency);
  if (!check.ok) return check;

  return {
    ok: true,
    link: {
      id: link.id,
      bookingId: link.bookingId,
      amount: link.amount,
      currency: link.currency,
      kind: link.kind as PaymentKind,
      expiresAt: link.expiresAt,
      booking: {
        reference: link.booking.reference,
        status: link.booking.status,
        customerName: link.booking.customerName,
        listingName: link.booking.listing?.name ?? "",
        listingSlug: link.booking.listing?.slug ?? "",
        listingPaymentModes: link.booking.listing?.paymentModes ?? null,
      },
    },
  };
}

/**
 * Mark a link spent.
 *
 * Called the instant a checkout is opened from it, not when the payment
 * succeeds — so a guest who abandons the provider's page cannot come back and
 * open a second checkout from the same link. If they need another attempt, the
 * owner issues another link, which is one more row and one more audit entry
 * rather than an unbounded token.
 *
 * `usedAt: null` in the WHERE clause makes this a compare-and-set: two
 * simultaneous taps on the same link produce one update and one no-op, which
 * `count` reports.
 */
export async function markLinkUsed(linkId: string): Promise<boolean> {
  const result = await prisma.paymentLink.updateMany({
    where: { id: linkId, usedAt: null },
    data: { usedAt: new Date() },
  });
  return result.count === 1;
}

/**
 * Hand a link back after a checkout that never started.
 *
 * The counterpart to `markLinkUsed`, for the case where the gateway refused
 * before creating an order: the guest has done nothing wrong and there is
 * nothing to double-charge, so making them ask the owner for a fresh link would
 * be punishing them for a misconfiguration.
 *
 * Scoped to a link with no payment attached (`paymentId: null`). A link that
 * has produced an attempt is never released, whatever went wrong afterwards —
 * that is the case the single-use rule exists for.
 */
export async function releasePaymentLink(linkId: string): Promise<boolean> {
  const result = await prisma.paymentLink.updateMany({
    where: { id: linkId, paymentId: null },
    data: { usedAt: null },
  });
  return result.count === 1;
}
