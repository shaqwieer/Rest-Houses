import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { AdminShell } from "@/components/admin/admin-shell";
import { auth, dashboardForSession } from "@/lib/auth";
import { getSettings } from "@/lib/settings";
import { prisma } from "@/lib/prisma";
import { getI18n } from "@/lib/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return {
    title: t.admin.dashboard,
    robots: { index: false, follow: false, nocache: true },
  };
}

/** The dashboard reads live data on every request — caching it would show the
 *  operator a stale request list, which is the one thing it exists to prevent. */
export const dynamic = "force-dynamic";

/**
 * Admin layout + the real authorisation check.
 *
 * `middleware.ts` already redirects anyone without a session cookie, but it only
 * checks that a cookie *exists* — it can't verify the signature at the edge
 * cheaply. This is where the session is validated and, since owners now sign in
 * through the same /login, where the **role** is checked: a signed-in owner
 * reaching /admin is sent to their own dashboard rather than shown an operator's
 * view of the whole platform.
 *
 * The role is re-read from the database rather than taken from the 30-day JWT,
 * which would keep asserting a role that had since been changed. Every mutating
 * server action calls `requireAdmin()` on top of this.
 */
export default async function AdminLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const session = await auth();
  if (!session?.user) redirect("/login?next=/admin");

  // `dashboardForSession()` rather than a bare role check: an account that is
  // neither a valid admin nor a valid owner has to end up at /login, not at
  // /owner, or the two dashboards bounce it between them forever. See the long
  // note on that function in src/lib/auth.ts.
  const home = await dashboardForSession();
  if (home !== "/admin") redirect(home ?? "/login?expired=1");

  const [settings, newRequestCount, pendingOwnerCount] = await Promise.all([
    getSettings(),
    prisma.bookingRequest.count({ where: { status: "NEW" } }),
    prisma.ownerProfile.count({ where: { status: "PENDING" } }),
  ]);

  return (
    <AdminShell
      siteName={settings.siteName}
      logoGlyph={settings.logoGlyph || "و"}
      newRequestCount={newRequestCount}
      pendingOwnerCount={pendingOwnerCount}
    >
      {children}
    </AdminShell>
  );
}
