"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTransition } from "react";
import clsx from "clsx";
import { Icon, type IconName } from "@/components/ui/icon";
import { logoutAction } from "@/app/actions/auth";
import { ToastProvider } from "@/components/ui/toast";
import { LanguageSwitcher } from "@/components/site/language-switcher";
import { useLocale } from "@/lib/i18n/provider";
import { arFullDate } from "@/lib/dates";

/**
 * Owner dashboard chrome — MOBILE FIRST, mirroring the admin shell.
 *
 * An استراحة owner is on a phone when a booking request arrives, so navigation
 * is a thumb-reachable bottom tab bar above the iOS home indicator, becoming a
 * horizontal pill bar from `md:` up.
 *
 * `showNav` is false while the account is pending, rejected, suspended or
 * expired: every tab would lead somewhere the owner may not go, and a row of
 * dead links reads as a broken product rather than an account awaiting review.
 */

// Calendar sits next to listings rather than at the end: blocking a weekend and
// pricing Eid are things an owner does far more often than editing their
// profile, and on a five-tab bottom bar the order is the whole information
// hierarchy.
const TABS: { href: string; labelKey: keyof TabLabels; icon: IconName; exact?: boolean }[] = [
  { href: "/owner", labelKey: "overview", icon: "space_dashboard", exact: true },
  { href: "/owner/listings", labelKey: "listings", icon: "holiday_village" },
  { href: "/owner/calendar", labelKey: "calendar", icon: "calendar_month" },
  { href: "/owner/bookings", labelKey: "bookings", icon: "inbox" },
  { href: "/owner/profile", labelKey: "profile", icon: "person" },
];

type TabLabels = {
  overview: string;
  listings: string;
  calendar: string;
  bookings: string;
  profile: string;
};

export function OwnerShell({
  siteName,
  logoGlyph,
  ownerName,
  newRequestCount,
  membershipExpiresAt = null,
  showNav = true,
  children,
}: {
  siteName: string;
  logoGlyph: string;
  ownerName: string;
  newRequestCount: number;
  /** ISO "YYYY-MM-DD", or null for an open-ended membership. */
  membershipExpiresAt?: string | null;
  showNav?: boolean;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const { t, locale } = useLocale();
  const [pending, startTransition] = useTransition();

  const labels: TabLabels = {
    overview: t.owner.overview,
    listings: t.owner.myListings,
    calendar: t.owner.myCalendar,
    bookings: t.owner.myBookings,
    profile: t.owner.myProfile,
  };

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
              {ownerName || siteName}
            </div>
            <div className="text-[11.5px] text-sand-100/55">{t.owner.dashboardTitle}</div>
          </div>

          <LanguageSwitcher tone="dark" className="hidden sm:flex" />

          <Link
            href="/"
            className="hidden items-center gap-1.5 rounded-full border border-gold-500/30 px-3 py-2 text-[12.5px] font-semibold text-gold-300 no-underline hover:bg-gold-500/15 hover:no-underline lg:flex"
          >
            <Icon name="public" size={16} />
            {t.nav.home}
          </Link>

          <form action={() => startTransition(() => void logoutAction())} className="contents">
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

        {/* ---- membership strip ----
            Surfaced permanently rather than only when close to expiry: an owner
            who can see the date is an owner who renews before their listings
            disappear, which is cheaper for everyone than finding out afterwards. */}
        {showNav && (
          <div className="bg-night-800 px-4 py-1.5 text-center text-[11.5px] text-sand-100/70">
            {membershipExpiresAt
              ? t.owner.membershipActive(arFullDate(membershipExpiresAt, locale))
              : t.owner.membershipNone}
          </div>
        )}

        {/* ---- tabs: pill bar from md up ---- */}
        {showNav && (
          <nav
            aria-label={t.owner.dashboardTitle}
            className="mx-auto mt-4 hidden w-full max-w-[1180px] gap-1.5 rounded-[18px] border border-line bg-surface p-1.5 shadow-e1 md:flex"
          >
            {TABS.map((tab) => (
              <Link
                key={tab.href}
                href={tab.href}
                aria-current={isActive(tab) ? "page" : undefined}
                className={clsx(
                  "flex flex-1 flex-col items-center gap-1 rounded-[14px] px-2 py-2.5 text-[11.5px] no-underline transition hover:no-underline",
                  isActive(tab)
                    ? "bg-gold-100 font-bold text-bronze"
                    : "font-medium text-muted hover:bg-sand-50",
                )}
              >
                <Icon name={tab.icon} size={22} />
                <span>{labels[tab.labelKey]}</span>
              </Link>
            ))}
          </nav>
        )}

        {/* ---- content ---- */}
        <div className="mx-auto w-full max-w-[1180px] flex-1 px-3.5 pt-4 pb-5 md:px-6 md:pb-14">
          {children}
        </div>

        {/* ---- tabs: bottom bar below md ---- */}
        {showNav && (
          <nav
            aria-label={t.owner.dashboardTitle}
            className="sticky bottom-0 z-130 flex gap-0.5 border-t border-line bg-surface/97 px-2 pt-1.5 shadow-[0_-8px_24px_rgb(23_32_44/0.08)] backdrop-blur-lg md:hidden"
            // Clears the iOS home indicator so the last tab is still tappable.
            style={{ paddingBottom: "calc(0.375rem + env(safe-area-inset-bottom))" }}
          >
            {TABS.map((tab) => (
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
                <span>{labels[tab.labelKey]}</span>
                {tab.href === "/owner/bookings" && newRequestCount > 0 && (
                  <span
                    className="absolute top-1 start-1/2 size-1.5 rounded-full bg-busy"
                    aria-hidden
                  />
                )}
              </Link>
            ))}
          </nav>
        )}
      </div>
    </ToastProvider>
  );
}
