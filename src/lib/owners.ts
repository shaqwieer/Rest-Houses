import type { Prisma } from "@prisma/client";
import type { OwnerAccessState, OwnerStatus } from "./constants";

/**
 * Owner eligibility — the one place that decides whether an owner may act and
 * whether their listings are visible to the public.
 *
 * Both questions have the same answer, and it is deliberately computed from the
 * two stored fields (`status`, `membershipExpiresAt`) every time rather than
 * cached in a third:
 *
 *   • A stored "is active" flag needs something to flip it the moment a
 *     membership lapses. That means a scheduled job, which this deployment has
 *     no place to run, and which would leave listings visible for up to a day
 *     after expiry.
 *   • Deriving it also makes renewal trivially correct: move the date forward
 *     and every listing that *was* eligible becomes eligible again, with no
 *     record of what had been hidden needing to be replayed.
 */

/** The minimum an eligibility decision needs. */
export type OwnerEligibilityInput = {
  status: string;
  membershipExpiresAt: Date | null;
};

/** Has this owner's membership period ended? A null date means "no expiry set". */
export function isMembershipExpired(
  membershipExpiresAt: Date | null | undefined,
  now: Date = new Date(),
): boolean {
  if (!membershipExpiresAt) return false;
  return membershipExpiresAt.getTime() <= now.getTime();
}

/**
 * The single value the UI shows for an owner.
 *
 * "EXPIRED" is derived here and never stored — see the note on OWNER_STATUSES
 * in constants.ts. An owner who is SUSPENDED *and* expired reads as SUSPENDED,
 * because that is the fact an admin needs to act on first.
 */
export function ownerAccessState(
  owner: OwnerEligibilityInput,
  now: Date = new Date(),
): OwnerAccessState {
  const status = owner.status as OwnerStatus;

  if (status !== "APPROVED") {
    return status as OwnerAccessState;
  }
  if (isMembershipExpired(owner.membershipExpiresAt, now)) {
    return "EXPIRED";
  }
  return "APPROVED";
}

/**
 * May this owner manage listings, publish, and reach the owner dashboard?
 *
 * True only for an approved owner inside their membership period. Everything
 * else — pending, rejected, suspended, expired — is false.
 */
export function isOwnerActive(
  owner: OwnerEligibilityInput | null | undefined,
  now: Date = new Date(),
): boolean {
  if (!owner) return false;
  return ownerAccessState(owner, now) === "APPROVED";
}

/**
 * The Prisma predicate for "this owner is currently eligible".
 *
 * Kept next to `isOwnerActive` on purpose: the in-memory check and the SQL check
 * must agree, and the surest way to keep two rules in step is to write them
 * where a reader sees both at once. Any change to one belongs in the other.
 */
export function activeOwnerWhere(now: Date = new Date()): Prisma.OwnerProfileWhereInput {
  return {
    status: "APPROVED",
    OR: [
      // No expiry set = an open-ended membership, not an expired one.
      { membershipExpiresAt: null },
      { membershipExpiresAt: { gt: now } },
    ],
  };
}

/**
 * Public-facing owner details.
 *
 * A listing page shows who a guest will be dealing with; it must not leak the
 * owner's private contact details, ID number or account state. The WhatsApp
 * number is the deliberate exception — contacting the owner is the entire point
 * of the platform, and that number is what the contact button opens.
 */
export function publicOwnerFields() {
  return {
    id: true,
    fullName: true,
    businessName: true,
    whatsapp: true,
    city: true,
    about: true,
  } satisfies Prisma.OwnerProfileSelect;
}
