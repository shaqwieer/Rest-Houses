"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { AuthorizationError, requireAdmin } from "@/lib/auth";
import { auditData } from "@/lib/audit";
import { REVIEW_RATING_MAX, REVIEW_RATING_MIN } from "@/lib/constants";
import { lookupReviewInvite, recalcListingRating } from "@/lib/reviews";
import { getI18n } from "@/lib/i18n/server";
import type { Dictionary } from "@/lib/i18n";
import type { ActionResult } from "./listings";

/**
 * Guest reviews — submission through an invite, and moderation by an operator.
 *
 * ─── This is the one action on the platform with no session behind it ───────
 * `submitGuestReview` is called by somebody who is not logged in and cannot be:
 * guests never sign up. The token they hold is the entire authorisation, so
 * everything that would normally be a session check is a property of the token
 * instead — it is unguessable, it expires, and spending it marks it used inside
 * the same transaction that writes the review. There is nothing to rate-limit
 * per account because there are no accounts; the single-use token is what
 * bounds it.
 *
 * A submitted review is never visible. It is written PENDING and
 * `published: false` and waits for an operator, which is what the seventh step
 * of the booking workflow promises.
 */

function reviewSchema(t: Dictionary) {
  return z.object({
    authorName: z.string().trim().min(2, t.validation.fullNameRequired).max(80),
    rating: z.coerce
      .number()
      .int()
      .min(REVIEW_RATING_MIN, t.validation.ratingRequired)
      .max(REVIEW_RATING_MAX, t.validation.ratingRequired),
    body: z.string().trim().min(10, t.validation.reviewTooShort).max(2000),
  });
}

export async function submitGuestReview(
  token: string,
  formData: FormData,
): Promise<ActionResult> {
  const { t } = await getI18n();

  // Re-resolved here rather than trusted from the page that rendered the form:
  // a form post is a separate request, and the invite may have expired or been
  // spent between the two.
  const lookup = await lookupReviewInvite(token);
  if (!lookup.ok) {
    const byReason = {
      NOT_FOUND: t.validation.reviewLinkInvalid,
      EXPIRED: t.validation.reviewLinkExpired,
      USED: t.validation.reviewLinkUsed,
    };
    return { ok: false, error: byReason[lookup.reason] };
  }

  const parsed = reviewSchema(t).safeParse({
    authorName: formData.get("authorName"),
    rating: formData.get("rating"),
    body: formData.get("body"),
  });

  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      const key = String(issue.path[0] ?? "form");
      if (!fieldErrors[key]) fieldErrors[key] = issue.message;
    }
    return { ok: false, error: t.validation.checkInput, fieldErrors };
  }

  const { invite } = lookup;
  const data = parsed.data;

  /**
   * The review and the spending of the invite commit together.
   *
   * Written the other way round — review first, then mark used — a crash in
   * between leaves a live token that can post a second review for the same
   * stay. The `usedAt: null` in the WHERE clause is what makes it safe under
   * two simultaneous submissions as well: the second update matches zero rows
   * and the transaction rolls back rather than writing a duplicate.
   */
  try {
    await prisma.$transaction(async (tx) => {
      const spent = await tx.reviewInvite.updateMany({
        where: { id: invite.id, usedAt: null },
        data: { usedAt: new Date() },
      });
      if (spent.count === 0) throw new AlreadyUsedError();

      await tx.review.create({
        data: {
          listingId: invite.listingId,
          bookingId: invite.bookingId,
          authorName: data.authorName,
          rating: data.rating,
          body: data.body,
          // Both, explicitly. `published` defaults to true — the seeded
          // catalogue relies on it — so a review that skipped this line would
          // go straight onto the listing page unmoderated.
          published: false,
          status: "PENDING",
        },
      });
    });
  } catch (error) {
    if (error instanceof AlreadyUsedError) {
      return { ok: false, error: t.validation.reviewLinkUsed };
    }
    throw error;
  }

  revalidatePath("/admin/reviews");
  revalidatePath("/admin");

  return { ok: true, message: t.validation.reviewSubmitted };
}

class AlreadyUsedError extends Error {}

/**
 * Approve or reject a pending review.
 *
 * A rejected review is kept rather than deleted: the invite that produced it is
 * already spent, so deleting the row would leave no record of why a guest's
 * review never appeared — and the operator answering "you rejected mine" needs
 * to be able to see it.
 */
export async function moderateReview(
  reviewId: string,
  approve: boolean,
): Promise<ActionResult> {
  const { t } = await getI18n();

  let actor: { id: string; email: string; role: string };
  try {
    const user = await requireAdmin();
    actor = { id: user.id, email: user.email, role: user.role };
  } catch (error) {
    if (error instanceof AuthorizationError) {
      return { ok: false, error: t.validation.unauthorized };
    }
    throw error;
  }

  const review = await prisma.review.findUnique({
    where: { id: reviewId },
    select: {
      id: true,
      listingId: true,
      authorName: true,
      rating: true,
      listing: { select: { slug: true } },
    },
  });
  if (!review) return { ok: false, error: t.validation.reviewNotFound };

  // The decision and the listing's star rating move together — a listing whose
  // score disagrees with its own visible review list is precisely what a
  // denormalised aggregate is supposed to prevent.
  await prisma.$transaction(async (tx) => {
    await tx.review.update({
      where: { id: review.id },
      data: {
        status: approve ? "APPROVED" : "REJECTED",
        published: approve,
      },
    });

    await tx.auditLog.create({
      data: auditData({
        actor,
        action: approve ? "REVIEW_APPROVED" : "REVIEW_REJECTED",
        entityType: "Review",
        entityId: review.id,
        summary: `${review.authorName} — ${review.rating}/5`,
        metadata: { listingId: review.listingId },
      }),
    });

    await recalcListingRating(tx, review.listingId);
  });

  revalidatePath("/admin/reviews");
  revalidatePath("/admin");
  revalidatePath(`/listings/${review.listing.slug}`);
  revalidatePath("/listings");

  return {
    ok: true,
    message: approve ? t.validation.reviewApproved : t.validation.reviewRejected,
  };
}
