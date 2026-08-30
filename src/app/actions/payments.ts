"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { auditData } from "@/lib/audit";
import {
  AuthorizationError,
  requireAdmin,
  requireApprovedOwner,
} from "@/lib/auth";
import { isPaymentKind, isPaymentProvider, type PaymentKind } from "@/lib/constants";
import { getI18n } from "@/lib/i18n/server";
import type { Dictionary } from "@/lib/i18n";
import { getSettings } from "@/lib/settings";
import {
  availableProviders,
  issuePaymentLink,
  markLinkUsed,
  releasePaymentLink,
  resolvePaymentLink,
  startPayment,
  type PaymentFailure,
} from "@/lib/payments";
import { clientIp, consumeAll, type RateLimitRule } from "@/lib/security";

/**
 * Payment actions — everything a human presses that touches money.
 *
 * Three entry points, with three different authorisation stories, and the
 * differences are the interesting part of this file:
 *
 *   `startLinkCheckout`     PUBLIC. The 64-hex token IS the authorisation, the
 *                           same arrangement as a review invite. Nothing else
 *                           in the request is trusted, including the amount —
 *                           which is not a parameter.
 *   `issueBookingPayLink`   An owner for their OWN bookings, or an operator for
 *                           any. Scoped by a WHERE clause, never by a check
 *                           after the read.
 *   `revokeBookingPayLink`  Same scope as issuing. Revoking is how a link sent
 *                           to the wrong number is taken back.
 *
 * There is deliberately no action here that accepts an amount, a currency or a
 * booking total. Every figure is read from the database inside
 * src/lib/payments/service.ts — see the three rules at the top of that file.
 */

export type PaymentActionResult =
  | { ok: true; message?: string; url?: string }
  | { ok: false; error: string };

/**
 * Opening a checkout is a public write that costs a third party a request and
 * this platform a gateway call, so it gets its own budget.
 *
 * Deliberately tighter than the booking form's: a guest paying a link taps once
 * and, at worst, a second time after a failed card. Six in a quarter of an hour
 * is already generous, and thirty in a day is not a person paying for a stay.
 */
const CHECKOUT_RATE_RULES: RateLimitRule[] = [
  { name: "checkout:ip:short", limit: 6, windowMs: 15 * 60_000 },
  { name: "checkout:ip:day", limit: 30, windowMs: 24 * 60 * 60_000 },
];

/**
 * Turn a `PaymentFailure` code into a sentence in the reader's language.
 *
 * The payment library returns codes precisely so it does not have to know the
 * locale; this is the boundary where one is available. Anything unmapped falls
 * back to the generic message rather than rendering a raw code at a guest.
 */
function failureMessage(reason: PaymentFailure | string, t: Dictionary): string {
  const map: Record<string, string> = {
    PAYMENTS_DISABLED: t.payments.errorDisabled,
    PROVIDER_UNAVAILABLE: t.payments.errorProviderUnavailable,
    MODE_UNAVAILABLE: t.payments.errorProviderUnavailable,
    BOOKING_NOT_FOUND: t.validation.requestNotFound,
    BOOKING_NOT_PAYABLE: t.payments.errorNotPayable,
    NOTHING_DUE: t.payments.errorNothingDue,
    ALREADY_PAID: t.payments.errorAlreadyPaid,
    INVALID_AMOUNT: t.payments.errorAmount,
    INVALID_CURRENCY: t.payments.errorAmount,
    GATEWAY_ERROR: t.payments.errorGateway,
    LINK_INVALID: t.payments.errorLinkInvalid,
    LINK_EXPIRED: t.payments.errorLinkExpired,
    LINK_USED: t.payments.errorLinkUsed,
  };
  return map[reason] ?? t.payments.errorGateway;
}

/** Turn a guard failure into a translated result rather than a 500. */
function guardResult(error: unknown, t: Dictionary): PaymentActionResult {
  if (error instanceof AuthorizationError) {
    return {
      ok: false,
      error:
        error.code === "OWNER_INACTIVE" ? t.validation.ownerInactive : t.validation.unauthorized,
    };
  }
  throw error;
}

/**
 * Open a checkout from a payment link.
 *
 * ─── What the caller may influence, in full ─────────────────────────────────
 * The token, and which of the enabled providers to use. That is the entire
 * surface. The amount, the currency, the booking and what is being paid for all
 * come from the `PaymentLink` row the token resolves to — so there is no
 * parameter through which a guest could pay 1 dirham for a 4,000 dirham stay,
 * and no signature that has to be verified correctly for that to hold.
 *
 * ─── The link is spent before the gateway is called ─────────────────────────
 * `markLinkUsed` is a compare-and-set on `usedAt`, and it runs BEFORE
 * `startPayment`. Two simultaneous taps therefore produce one checkout and one
 * "already used", rather than two orders against one booking. The cost of that
 * ordering is that a guest who abandons the provider's page needs a fresh link
 * — which is one row and one audit entry, and is the right trade against
 * double-charging somebody.
 *
 * ─── But a gateway failure must not burn the link ───────────────────────────
 * Abandoning a checkout and never reaching one are different, and treating them
 * alike left a guest holding a permanently dead link under a message telling
 * them to try again shortly — which was impossible, because the link was spent.
 *
 * So the link is RELEASED when the failure proves no order was created:
 * credentials missing, the provider refusing the request, the mode or provider
 * unavailable. It stays spent on a NETWORK failure, where the request may have
 * reached the gateway and a retry could produce a second order — the one case
 * where losing a link is cheaper than the alternative, and the guest is told to
 * ask the owner for a new one rather than to try again.
 */
export async function startLinkCheckout(formData: FormData): Promise<PaymentActionResult> {
  const { t, locale } = await getI18n();

  const ip = await clientIp();
  const verdict = consumeAll(CHECKOUT_RATE_RULES, ip);
  if (!verdict.allowed) return { ok: false, error: t.security.tooManyAttempts };

  const token = String(formData.get("token") ?? "");
  const provider = String(formData.get("provider") ?? "").toUpperCase();

  if (!isPaymentProvider(provider) || provider === "MANUAL") {
    return { ok: false, error: failureMessage("PROVIDER_UNAVAILABLE", t) };
  }

  const lookup = await resolvePaymentLink(token);
  if (!lookup.ok) return { ok: false, error: failureMessage(lookup.reason, t) };

  if (!(await markLinkUsed(lookup.link.id))) {
    // Somebody else won the race, or the guest double-tapped.
    return { ok: false, error: failureMessage("LINK_USED", t) };
  }

  const result = await startPayment({
    bookingId: lookup.link.bookingId,
    provider,
    kind: lookup.link.kind,
    locale,
    // The snapshot from the link row — the figure the owner saw when they
    // issued it. Re-validated inside `startPayment` regardless.
    amountOverride: lookup.link.amount,
    linkId: lookup.link.id,
  });

  if (!result.ok) {
    // `detail` is the provider's error code, present only on GATEWAY_ERROR.
    // NETWORK is the one value that leaves any doubt about whether an order was
    // created, so it is the one that keeps the link spent.
    const orderCertainlyNotCreated = result.detail !== "NETWORK";

    if (orderCertainlyNotCreated) {
      await releasePaymentLink(lookup.link.id);
      return { ok: false, error: failureMessage(result.reason, t) };
    }

    // Spent, and honestly described: there is nothing this guest can retry.
    return { ok: false, error: t.payments.errorLinkSpentByFailure };
  }

  return { ok: true, url: result.checkoutUrl };
}

/**
 * Issue a payment link for a booking the owner has already confirmed.
 *
 * The ordering is the whole flow: `issuePaymentLink` refuses a booking that is
 * not CONFIRMED, so the owner agreeing to the dates is a precondition of asking
 * the guest for money rather than a convention the UI happens to follow.
 *
 * ─── Scope ──────────────────────────────────────────────────────────────────
 * Admin is tried first and its failure swallowed — an operator has no
 * `OwnerProfile` and `requireApprovedOwner` would reject them. An owner's scope
 * then goes into the WHERE clause as `listing: { ownerId }`, so asking for
 * somebody else's booking returns "not found": the same answer as for an id
 * that does not exist, which confirms nothing about which other bookings exist.
 * Same pattern as `setOwnerRequestStatus` in ./requests.ts.
 */
export async function issueBookingPayLink(
  bookingId: string,
  kind: string = "DEPOSIT",
): Promise<PaymentActionResult> {
  const { t } = await getI18n();

  let actor: { id: string; email: string | null; role: string | null };
  let ownerId: string | undefined;

  try {
    const admin = await requireAdmin().catch(() => null);
    if (admin) {
      actor = { id: admin.id, email: admin.email, role: admin.role };
    } else {
      const { owner, user } = await requireApprovedOwner();
      actor = { id: user.id, email: user.email, role: user.role };
      ownerId = owner.id;
    }
  } catch (error) {
    return guardResult(error, t);
  }

  const settings = await getSettings();
  if (!settings.paymentLinksEnabled || availableProviders(settings).length === 0) {
    return { ok: false, error: failureMessage("PAYMENTS_DISABLED", t) };
  }

  const result = await issuePaymentLink({
    where: ownerId ? { id: bookingId, listing: { ownerId } } : { id: bookingId },
    kind: isPaymentKind(kind) ? (kind as PaymentKind) : "DEPOSIT",
    issuedById: actor.id,
  });

  if (!result.ok) return { ok: false, error: failureMessage(result.reason, t) };

  await prisma.auditLog.create({
    data: auditData({
      actor,
      action: "PAYMENT_LINK_ISSUED",
      entityType: "BookingRequest",
      entityId: bookingId,
      summary: `${result.amount} AED`,
      // The amount and the expiry, never the token — the audit log is readable
      // by every operator, and the token is a bearer credential for a payment.
      metadata: { amount: result.amount, expiresAt: result.expiresAt.toISOString() },
    }),
  });

  revalidatePath("/admin/requests");
  revalidatePath("/owner/bookings");

  return { ok: true, url: result.url, message: t.payments.linkIssued };
}

/**
 * Revoke an unused link.
 *
 * Implemented as "mark it spent" rather than a delete, so the record of it
 * having been issued survives — the audit trail says a link went out, and
 * deleting the row would leave that entry pointing at nothing.
 *
 * Only an UNUSED link can be revoked (`usedAt: null` in the WHERE clause). One
 * already spent has a payment attached to it and revoking it would say
 * something untrue about a checkout that really happened.
 */
export async function revokeBookingPayLink(linkId: string): Promise<PaymentActionResult> {
  const { t } = await getI18n();

  let actor: { id: string; email: string | null; role: string | null };
  let ownerId: string | undefined;

  try {
    const admin = await requireAdmin().catch(() => null);
    if (admin) {
      actor = { id: admin.id, email: admin.email, role: admin.role };
    } else {
      const { owner, user } = await requireApprovedOwner();
      actor = { id: user.id, email: user.email, role: user.role };
      ownerId = owner.id;
    }
  } catch (error) {
    return guardResult(error, t);
  }

  const result = await prisma.paymentLink.updateMany({
    where: {
      id: linkId,
      usedAt: null,
      ...(ownerId ? { booking: { listing: { ownerId } } } : {}),
    },
    data: { usedAt: new Date() },
  });

  if (result.count === 0) return { ok: false, error: t.validation.requestNotFound };

  await prisma.auditLog.create({
    data: auditData({
      actor,
      action: "PAYMENT_LINK_REVOKED",
      entityType: "PaymentLink",
      entityId: linkId,
    }),
  });

  revalidatePath("/admin/requests");
  revalidatePath("/owner/bookings");

  return { ok: true, message: t.payments.linkRevoked };
}


/**
 * Open a checkout for a booking the guest has just made.
 *
 * ─── Why this is public, and what that does and does not allow ──────────────
 * There are no customer accounts on this platform: a guest books with a name
 * and a WhatsApp number and never signs up. So the person paying for their own
 * booking has nothing to authenticate with, and the booking reference they are
 * looking at on their confirmation page is what they have.
 *
 * What somebody else's reference would let a stranger do, stated plainly: pay
 * for that booking. It does not read the guest's details, does not change the
 * booking, and cannot direct money anywhere but at that stay — the amount is
 * computed from the booking row and the `Payment` is bound to it by a foreign
 * key. The worst outcome is an unwanted `Payment` row in AWAITING_PAYMENT that
 * nobody completes, which is why the rate limit above is the mitigation rather
 * than an authentication scheme that has nobody to authenticate.
 *
 * The reference is looked up whole, so it is not an enumeration surface any more
 * than the public /booking/<reference> page already is.
 */
export async function startBookingCheckout(formData: FormData): Promise<PaymentActionResult> {
  const { t, locale } = await getI18n();

  const ip = await clientIp();
  const verdict = consumeAll(CHECKOUT_RATE_RULES, ip);
  if (!verdict.allowed) return { ok: false, error: t.security.tooManyAttempts };

  const reference = String(formData.get("reference") ?? "").trim();
  const provider = String(formData.get("provider") ?? "").toUpperCase();

  if (!reference) return { ok: false, error: t.validation.requestNotFound };
  if (!isPaymentProvider(provider) || provider === "MANUAL") {
    return { ok: false, error: failureMessage("PROVIDER_UNAVAILABLE", t) };
  }

  const booking = await prisma.bookingRequest.findUnique({
    where: { reference },
    select: { id: true },
  });
  if (!booking) return { ok: false, error: t.validation.requestNotFound };

  // The deposit, always. Everything else about the amount — what it is, whether
  // anything is owed at all — is decided inside `startPayment` from the booking
  // row, not here and not by the caller.
  const result = await startPayment({
    bookingId: booking.id,
    provider,
    kind: "DEPOSIT",
    locale,
  });

  if (!result.ok) return { ok: false, error: failureMessage(result.reason, t) };

  return { ok: true, url: result.checkoutUrl };
}
