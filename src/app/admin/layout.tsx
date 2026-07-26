import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { AdminShell } from "@/components/admin/admin-shell";
import { auth } from "@/lib/auth";
import { getSettings } from "@/lib/settings";
import { prisma } from "@/lib/prisma";

export const metadata: Metadata = {
  title: "لوحة التحكم",
  robots: { index: false, follow: false, nocache: true },
};

/** The dashboard reads live data on every request — caching it would show the
 *  owner a stale request list, which is the one thing it exists to prevent. */
export const dynamic = "force-dynamic";

/**
 * Admin layout + the real authorisation check.
 *
 * `middleware.ts` already redirects anyone without a session cookie, but it only
 * checks that a cookie *exists* — it can't verify the signature at the edge
 * cheaply. This is where the session is actually validated, and every mutating
 * server action calls `requireAdmin()` on top of that.
 */
export default async function AdminLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const session = await auth();
  if (!session?.user) redirect("/login?next=/admin");

  const [settings, newRequestCount] = await Promise.all([
    getSettings(),
    prisma.bookingRequest.count({ where: { status: "NEW" } }),
  ]);

  return (
    <AdminShell
      siteName={settings.siteName}
      logoGlyph={settings.logoGlyph || "و"}
      newRequestCount={newRequestCount}
    >
      {children}
    </AdminShell>
  );
}
