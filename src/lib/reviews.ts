import { randomBytes } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { prisma } from "./prisma";
import { absoluteUrl } from "./settings";
import { REVIEW_RATING_MAX, REVIEW_RATING_MIN } from "./constants";

/**
 * Guest reviews — the invite link, the moderation queue and the rating that
 * falls out of them.
 *
 * ─── Why a guest cannot simply post a review ─────────────────────────────────
 * There are no customer accounts on this platform: a guest books with a name
 * and a WhatsApp number and never signs up (see the note on `listCustomers` in
 * ./admin-queries.ts). An open review form would therefore be an open door —
 * anonymous, unauthenticated, and attached to whichever rest house the poster
 * named. So a review can only be written through an *invite*, issued by the
 * owner at the last step of the booking workflow, once the stay has actually
 * been paid for, checked out, inspected and settled.
 *
 * The token in that invite is the entire authentication. Three things make
 * that safe enough to rely on, and all three are enforced here rather than in
 * the UI: it is 32 random bytes (not derivable from a booking reference the
 * guest can read off their own confirmation page), it expires, and it is
 * single-use.
 */

/** Token length in bytes before hex encoding — 32 bytes, 64 hex characters. */
const TOKEN_BYTES = 32;

export function generateInviteToken(): string {
  return randomBytes(TOKEN_BYTES).toString("hex");
}

/** The link handed to the guest. Absolute — it is sent over WhatsApp. */
export function reviewInviteUrl(token: string): string {
  return absoluteUrl(`/review/${token}`);
}

/**
 * Recompute a listing's denormalised rating from its reviews.
 *
 * Counts only what the public actually sees — `published: true` — so a review
 * sitting in the moderation queue cannot move a listing's score before an
 * operator has looked at it, and rejecting one takes its contribution back out.
 *
 * Takes a transaction client so the recalculation commits with the moderation
 * decision that caused it. A separate write could leave a listing whose stars
 * disagree with its own review list, which is exactly the kind of drift a
 * denormalised aggregate exists to avoid — so it must never be optional.
 */
export async function recalcListingRating(
  tx: Prisma.TransactionClient,
  listingId: string,
): Promise<void> {
  const stats = await tx.review.aggregate({
    where: { listingId, published: true },
    _avg: { rating: true },
    _count: { _all: true },
  });

  const count = stats._count._all;

  await tx.listing.update({
    where: { id: listingId },
    data: {
      // Rounded to one decimal: the design shows "٤٫٨", and storing the raw
      // average would render 4.799999999999999 the moment a third review lands.
      rating: count === 0 ? 0 : Math.round((stats._avg.rating ?? 0) * 10) / 10,
      reviewsCount: count,
    },
  });
}

export type InviteLookup =
  | { ok: true; invite: UsableInvite }
  | { ok: false; reason: "NOT_FOUND" | "EXPIRED" | "USED" };

export type UsableInvite = {
  id: string;
  bookingId: string;
  listingId: string;
  listingName: string;
  listingSlug: string;
  customerName: string;
  checkIn: string;
  checkOut: string;
  expiresAt: Date;
};

/**
 * Resolve a review token, distinguishing the three ways it can fail.
 *
 * The distinction is for the guest, not for an attacker: "this link has already
 * been used" and "this link expired on the 3rd" are both things the person
 * holding a legitimate link needs told, and neither reveals anything about a
 * token the caller does not already possess. A token that was never issued
 * still gets the flat NOT_FOUND.
 *
 * Expiry and single-use are checked HERE, on every visit, and never in the page
 * that renders the form — a check that lives in a component is a check that a
 * direct POST skips.
 */
export async function lookupReviewInvite(token: string): Promise<InviteLookup> {
  if (!token || typeof token !== "string" || token.length > 200) {
    return { ok: false, reason: "NOT_FOUND" };
  }

  const invite = await prisma.reviewInvite.findUnique({
    where: { token },
    select: {
      id: true,
      bookingId: true,
      listingId: true,
      expiresAt: true,
      usedAt: true,
      listing: { select: { name: true, slug: true } },
      booking: { select: { customerName: true, checkIn: true, checkOut: true } },
    },
  });

  if (!invite) return { ok: false, reason: "NOT_FOUND" };
  if (invite.usedAt) return { ok: false, reason: "USED" };
  if (invite.expiresAt.getTime() <= Date.now()) return { ok: false, reason: "EXPIRED" };

  return {
    ok: true,
    invite: {
      id: invite.id,
      bookingId: invite.bookingId,
      listingId: invite.listingId,
      listingName: invite.listing.name,
      listingSlug: invite.listing.slug,
      customerName: invite.booking.customerName,
      checkIn: invite.booking.checkIn,
      checkOut: invite.booking.checkOut,
      expiresAt: invite.expiresAt,
    },
  };
}

/** Is this a rating a review may carry? */
export function isValidRating(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isInteger(value) &&
    value >= REVIEW_RATING_MIN &&
    value <= REVIEW_RATING_MAX
  );
}
