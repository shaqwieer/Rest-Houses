"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTransition } from "react";
import clsx from "clsx";
import { Icon, type IconName } from "@/components/ui/icon";
import { logoutAction } from "@/app/actions/auth";
import { ToastProvider } from "@/components/ui/toast";
import { LanguageSwitcher } from "@/components/site/language-switcher";
import { useT } from "@/lib/i18n/provider";

/**
 * Admin chrome — MOBILE FIRST.
 *
 * The dashboard is designed to be fully usable one-handed on a phone, which is
 * where an استراحة owner actually is when a booking request arrives:
 *   • navigation is a thumb-reachable bottom tab bar, above the iOS home
 *     indicator (`env(safe-area-inset-bottom)`)
 *   • from `md:` up the same tabs become a horizontal pill bar under the header
 *   • the header is sticky and compact so content gets the vertical space
 */

/**
 * Dashboard sections.
 *
 * `labelKey` indexes the `admin` dictionary group rather than carrying a literal
 * string, so the tab bar translates with the rest of the interface.
 *
 * Ten tabs no longer fit a phone bottom bar, so it shows the five an operator
 * touches daily while the pill bar from `md:` up carries the full set.
 * `primary` marks the five.
 */
type AdminTabKey =
  | "overview"
  | "listings"
  | "calendar"
  | "requests"
  | "owners"
  | "ownerRequests"
  | "customers"
  | "payments"
  | "auditLog"
  | "settings";

const TABS: {
  href: string;
  labelKey: AdminTabKey;
  icon: IconName;
  exact?: boolean;
  primary?: boolean;
}[] = [
  { href: "/admin", labelKey: "overview", icon: "space_dashboard", exact: true, primary: true },
  { href: "/admin/owner-requests", labelKey: "ownerRequests", icon: "badge", primary: true },
  { href: "/admin/owners", labelKey: "owners", icon: "group" },
  { href: "/admin/listings", labelKey: "listings", icon: "holiday_village", primary: true },
  { href: "/admin/calendar", labelKey: "calendar", icon: "calendar_month" },
  { href: "/admin/requests", labelKey: "requests", icon: "inbox", primary: true },
  { href: "/admin/customers", labelKey: "customers", icon: "contact_phone" },
  { href: "/admin/payments", labelKey: "payments", icon: "payments" },
  { href: "/admin/audit", labelKey: "auditLog", icon: "history" },
  { href: "/admin/settings", labelKey: "settings", icon: "tune", primary: true },
];

export function AdminShell({
  siteName,
  logoGlyph,
  newRequestCount,
  pendingOwnerCount = 0,
  children,
}: {
  siteName: string;
  logoGlyph: string;
  newRequestCount: number;
  pendingOwnerCount?: number;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const t = useT();
  const [pending, startTransition] = useTransition();

  const primaryTabs = TABS.filter((tab) => tab.primary);

  const isActive = (tab: (typeof TABS)[number]) =>
    tab.exact ? pathname === tab.href : pathname.startsWith(tab.href);

  return (
    <ToastProvider>
    <div className="flex min-h-screen flex-col bg-sand-100">
      {/* ---- header ---- */}
      <header className="sticky top-0 z-120 flex items-center gap-3 bg-night-900 px-4 py-3 text-sand-50">
        <div
          className="grid size-9 shrink-0 place-items-center rounded-[11px] font-display text-[17px] font-extrabold text-night-900"
          style={{ background: "linear-gradient(150deg, var(--gold-500), var(--bronze))" }}
          aria-hidden
        >
          {logoGlyph}
        </div>

        <div className="min-w-0 flex-1">
          <div className="truncate font-display text-[15px] font-extrabold leading-tight">
            {siteName}
          </div>
          <div className="text-[11.5px] text-sand-100/55">{t.admin.dashboard}</div>
        </div>

        <LanguageSwitcher tone="dark" className="hidden sm:flex" />

        <Link
          href="/"
          className="hidden items-center gap-1.5 rounded-full border border-gold-500/30 px-3 py-2 text-[12.5px] font-semibold text-gold-300 no-underline hover:bg-gold-500/15 hover:no-underline lg:flex"
        >
          <Icon name="public" size={16} />
          {t.nav.home}
        </Link>

        <Link
          href="/admin/requests"
          aria-label={t.admin.requests}
          className="relative grid size-9 place-items-center rounded-full bg-surface/10 text-sand-100 no-underline hover:no-underline"
        >
          <Icon name="notifications" size={20} />
          {newRequestCount > 0 && (
            <span
              className="absolute top-1 start-1.5 size-2 rounded-full border-[1.5px] border-night-900 bg-busy"
              aria-hidden
            />
          )}
        </Link>

        <form
          action={() => startTransition(() => void logoutAction())}
          className="contents"
        >
          <button
            type="submit"
            disabled={pending}
            title={t.auth.signOut}
            aria-label={t.auth.signOut}
            className="grid size-9 place-items-center rounded-full bg-surface/10 text-sand-100 transition hover:bg-busy/30 disabled:opacity-50"
          >
            <Icon name="logout" size={20} />
          </button>
        </form>
      </header>

      {/* ---- tabs: pill bar from md up ---- */}
      <nav
        aria-label={t.admin.dashboard}
        className="mx-auto mt-4 hidden w-full max-w-[1180px] flex-wrap gap-1.5 rounded-[18px] border border-line bg-surface p-1.5 shadow-e1 md:flex"
      >
        {TABS.map((tab) => (
          <Link
            key={tab.href}
            href={tab.href}
            aria-current={isActive(tab) ? "page" : undefined}
            className={clsx(
              "relative flex min-w-[86px] flex-1 flex-col items-center gap-1 rounded-[14px] px-2 py-2.5 text-[11.5px] no-underline transition hover:no-underline",
              isActive(tab)
                ? "bg-gold-100 font-bold text-bronze"
                : "font-medium text-muted hover:bg-sand-50",
            )}
          >
            <Icon name={tab.icon} size={22} />
            <span>{t.admin[tab.labelKey]}</span>
            {tab.href === "/admin/owner-requests" && pendingOwnerCount > 0 && (
              <span className="absolute top-1.5 end-2 size-2 rounded-full bg-busy" aria-hidden />
            )}
            {tab.href === "/admin/requests" && newRequestCount > 0 && (
              <span className="absolute top-1.5 end-2 size-2 rounded-full bg-busy" aria-hidden />
            )}
          </Link>
        ))}
      </nav>

      {/* ---- content ---- */}
      <div className="mx-auto w-full max-w-[1180px] flex-1 px-3.5 pt-4 pb-5 md:px-6 md:pb-14">
        {children}
      </div>

      {/* ---- tabs: bottom bar below md ---- */}
      <nav
        aria-label={t.admin.dashboard}
        className="sticky bottom-0 z-130 flex gap-0.5 border-t border-line bg-surface/97 px-2 pt-1.5 backdrop-blur-lg shadow-[0_-8px_24px_rgb(23_32_44/0.08)] md:hidden"
        // Clears the iOS home indicator so the last tab is still tappable.
        style={{ paddingBottom: "calc(0.375rem + env(safe-area-inset-bottom))" }}
      >
        {primaryTabs.map((tab) => (
          <Link
            key={tab.href}
            href={tab.href}
            aria-current={isActive(tab) ? "page" : undefined}
            className={clsx(
              "relative flex flex-1 flex-col items-center gap-0.5 rounded-[14px] px-1 py-2 text-[10.5px] no-underline transition hover:no-underline",
              isActive(tab) ? "bg-gold-100 font-bold text-bronze" : "font-medium text-muted",
            )}
          >
            <Icon name={tab.icon} size={22} />
            <span>{t.admin[tab.labelKey]}</span>
            {tab.href === "/admin/owner-requests" && pendingOwnerCount > 0 && (
              <span
                className="absolute top-1 start-1/2 size-1.5 rounded-full bg-busy"
                aria-hidden
              />
            )}
            {tab.href === "/admin/requests" && newRequestCount > 0 && (
              <span
                className="absolute top-1 start-1/2 size-1.5 rounded-full bg-busy"
                aria-hidden
              />
            )}
          </Link>
        ))}
      </nav>
    </div>
    </ToastProvider>
  );
}
