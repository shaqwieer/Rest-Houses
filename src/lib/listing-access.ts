import { prisma } from "@/lib/prisma";
import { requireAdmin, requireApprovedOwner, AuthorizationError } from "@/lib/auth";
import type { Dictionary } from "@/lib/i18n";

/**
 * "May this caller act on this listing?" — asked once, by every action that an
 * operator and an owner can both perform.
 *
 * Three of those now exist: the calendar feeds, blocking days, and marking
 * occasion nights. Each needs the same two-step decision, and writing it three
 * times is how the third copy ends up missing the `ownerId` clause.
 *
 * ─── The authorisation rule ─────────────────────────────────────────────────
 * An owner's scope is applied as `ownerId` in the WHERE CLAUSE, not as a check
 * after reading the row. Asking for someone else's listing then returns "not
 * found" — the same answer as for an id that does not exist, which is both the
 * correct outcome and the one that leaks nothing about which other listings
 * exist (IDOR). This mirrors the note at the top of src/app/actions/listings.ts.
 *
 * Admin is tried first and its failure swallowed, because an operator has no
 * OwnerProfile and `requireApprovedOwner` would reject them. That cannot fall
 * through to "allowed": the owner guard below throws its own error, which is
 * translated and returned.
 *
 * Both guards re-read role, status and membership from the database on every
 * call. Sessions are 30-day JWTs, so a token minted while an owner was approved
 * keeps asserting it long after a suspension — see the notes in src/lib/auth.ts.
 */

export type ListingActor = { id: string; email: string | null; role: string | null };

export type ListingAccess =
  | {
      ok: true;
      listing: { id: string; slug: string; name: string };
      actor: ListingActor;
      /** Set when the caller is an owner; absent for an operator. */
      ownerId?: string;
    }
  | { ok: false; error: string };

export async function authorizeListing(
  listingId: string,
  t: Dictionary,
): Promise<ListingAccess> {
  let actor: ListingActor;
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
    if (error instanceof AuthorizationError) {
      return {
        ok: false,
        error:
          error.code === "OWNER_INACTIVE" ? t.validation.ownerInactive : t.validation.unauthorized,
      };
    }
    throw error;
  }

  const listing = await prisma.listing.findFirst({
    where: ownerId ? { id: listingId, ownerId } : { id: listingId },
    select: { id: true, slug: true, name: true },
  });
  if (!listing) return { ok: false, error: t.validation.listingNotFound };

  return { ok: true, listing, actor, ownerId };
}

/**
 * The listings a caller may choose between on a calendar page.
 *
 * An operator sees every listing; an owner sees only their own, again by
 * putting `ownerId` in the WHERE clause rather than filtering afterwards.
 */
export async function listingsForCalendar(ownerId?: string) {
  return prisma.listing.findMany({
    where: ownerId ? { ownerId } : {},
    // `weekendMode` shades the same days the listing charges the weekend rate
    // for; `holidayPrice` tells the editor whether marking an occasion night
    // will actually change a price, so it can say so when it will not.
    select: { id: true, name: true, weekendMode: true, holidayPrice: true },
    orderBy: { createdAt: "asc" },
  });
}
