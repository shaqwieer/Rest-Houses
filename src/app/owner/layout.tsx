import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { OwnerShell } from "@/components/owner/owner-shell";
import { OwnerStatusPanel } from "@/components/owner/status-panel";
import { auth, getOwnerProfileForSession } from "@/lib/auth";
import { ownerAccessState } from "@/lib/owners";
import { getSettings } from "@/lib/settings";
import { prisma } from "@/lib/prisma";
import { getI18n } from "@/lib/i18n/server";
import { toISODate } from "@/lib/dates";

export const metadata: Metadata = {
  robots: { index: false, follow: false, nocache: true },
};

/** Live data on every request — a cached dashboard would show a stale queue. */
export const dynamic = "force-dynamic";

/**
 * Owner dashboard layout, and the gate in front of it.
 *
 * ─── The gate is the point of this file ──────────────────────────────────────
 * An owner who is pending, rejected, suspended or out of membership never
 * reaches the dashboard: they get the status panel instead, which explains
 * exactly where they stand and — for a rejection — why.
 *
 * This is a *usability* boundary, not the security one. Every owner mutation
 * independently calls `requireApprovedOwner()`, which re-reads status and
 * membership from the database. If this check were the only one, an owner could
 * simply POST at a server action id and skip the page entirely.
 *
 * Note the state is derived per request, not read from the session: a 30-day
 * JWT minted while the owner was approved would otherwise keep asserting that
 * for a month after an admin suspends them.
 */
export default async function OwnerLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  // Signed-out and signed-in-as-an-admin are different situations and need
  // different answers: the first needs a login form, the second is already
  // authenticated and just came to the wrong dashboard. Bouncing an admin to
  // /login would ask them to sign in when they already are.
  const session = await auth();
  if (!session?.user) redirect("/login?next=/owner");

  const account = await getOwnerProfileForSession();
  if (!account?.ownerProfile) redirect("/admin");

  const settings = await getSettings();
  const state = ownerAccessState(account.ownerProfile);

  if (state !== "APPROVED") {
    return (
      <OwnerShell
        siteName={settings.siteName}
        logoGlyph={settings.logoGlyph || "و"}
        ownerName={account.ownerProfile.fullName}
        newRequestCount={0}
        // Navigation is hidden entirely rather than shown-and-disabled: every
        // tab would lead to a page this owner may not use, and a row of dead
        // links reads as a broken dashboard rather than a pending account.
        showNav={false}
      >
        <OwnerStatusPanel
          state={state}
          rejectionReason={account.ownerProfile.rejectionReason}
          membershipExpiresAt={
            account.ownerProfile.membershipExpiresAt
              ? toISODate(account.ownerProfile.membershipExpiresAt)
              : null
          }
        />
      </OwnerShell>
    );
  }

  const newRequestCount = await prisma.bookingRequest.count({
    where: { status: "NEW", listing: { ownerId: account.ownerProfile.id } },
  });

  return (
    <OwnerShell
      siteName={settings.siteName}
      logoGlyph={settings.logoGlyph || "و"}
      ownerName={account.ownerProfile.businessName || account.ownerProfile.fullName}
      newRequestCount={newRequestCount}
      // A plain ISO string, not a Date: props to a client component are
      // serialised into the RSC payload, and a string has no timezone for the
      // browser to reinterpret. The shell formats it with the active locale.
      membershipExpiresAt={
        account.ownerProfile.membershipExpiresAt
          ? toISODate(account.ownerProfile.membershipExpiresAt)
          : null
      }
    >
      {children}
    </OwnerShell>
  );
}
