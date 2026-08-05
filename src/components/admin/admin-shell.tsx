"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
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
 * ─── Why there is a "More" sheet on phones ───────────────────────────────────
 * Ten tabs do not fit a phone bottom bar. The bar used to render only the ones
 * marked `primary` and simply drop the rest — which meant Owners, Calendar,
 * Customers, Payments and the Audit log were *unreachable on a phone*, with
 * nothing on screen to suggest they existed. On a dashboard whose whole premise
 * is being usable one-handed, half the product was missing and looked like it
 * had never been built.
 *
 * So the bar now carries four daily tabs plus a fifth that opens a sheet
 * listing every section. Four-plus-more rather than five-plus-more because a
 * fifth cramped tab that hides five others reads as the whole menu; the sheet
 * has to look like the way in, not like an afterthought.
 *
 * `primary` marks the four in the bar. Everything appears in the sheet,
 * including those four — a menu that omits where you already are makes you
 * hunt for the tab you just left.
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
  | "reviews"
  | "auditLog"
  | "settings"
  | "account";

const TABS: {
  href: string;
  labelKey: AdminTabKey;
  icon: IconName;
  exact?: boolean;
  primary?: boolean;
}[] = [
  { href: "/admin", labelKey: "overview", icon: "space_dashboard", exact: true, primary: true },
  { href: "/admin/requests", labelKey: "requests", icon: "inbox", primary: true },
  { href: "/admin/listings", labelKey: "listings", icon: "holiday_village", primary: true },
  { href: "/admin/owner-requests", labelKey: "ownerRequests", icon: "badge", primary: true },
  { href: "/admin/owners", labelKey: "owners", icon: "group" },
  { href: "/admin/calendar", labelKey: "calendar", icon: "calendar_month" },
  { href: "/admin/customers", labelKey: "customers", icon: "contact_phone" },
  { href: "/admin/payments", labelKey: "payments", icon: "payments" },
  { href: "/admin/reviews", labelKey: "reviews", icon: "rate_review" },
  { href: "/admin/audit", labelKey: "auditLog", icon: "history" },
  { href: "/admin/settings", labelKey: "settings", icon: "tune" },
  // The operator's own credentials, deliberately its own page rather than a
  // card inside /admin/settings: everything there is *the site's* configuration,
  // which any admin may change freely, while this is one person's sign-in and
  // needs their current password to touch.
  { href: "/admin/account", labelKey: "account", icon: "person" },
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
  const [menuOpen, setMenuOpen] = useState(false);

  const primaryTabs = TABS.filter((tab) => tab.primary);

  const isActive = (tab: (typeof TABS)[number]) =>
    tab.exact ? pathname === tab.href : pathname.startsWith(tab.href);

  // A tab tap is a client-side navigation, so the sheet has to be closed by
  // something watching the URL — nothing unmounts it on the way out.
  useEffect(() => setMenuOpen(false), [pathname]);

  // Escape closes it, and the page behind it does not scroll while it is open:
  // a sheet you can scroll the page under feels broken on a phone.
  useEffect(() => {
    if (!menuOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMenuOpen(false);
    };
    window.addEventListener("keydown", onKey);
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = previous;
    };
  }, [menuOpen]);

  // True when the section on screen is one the bar has no tab for, so "More"
  // can show as the active item instead of nothing looking selected.
  const onOverflowSection = !primaryTabs.some(isActive);

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
            <span className="max-w-full truncate">{t.admin[tab.labelKey]}</span>
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

        {/* The fifth slot: every remaining section, one tap away. */}
        <button
          type="button"
          onClick={() => setMenuOpen(true)}
          aria-haspopup="dialog"
          aria-expanded={menuOpen}
          className={clsx(
            "flex flex-1 flex-col items-center gap-0.5 rounded-[14px] px-1 py-2 text-[10.5px] transition",
            onOverflowSection || menuOpen
              ? "bg-gold-100 font-bold text-bronze"
              : "font-medium text-muted",
          )}
        >
          <Icon name="more_horiz" size={22} />
          <span className="max-w-full truncate">{t.admin.moreSections}</span>
        </button>
      </nav>

      {/* ---- the "More" sheet (phones only) ---- */}
      {menuOpen && (
        <div className="fixed inset-0 z-200 md:hidden" role="dialog" aria-modal="true">
          <button
            type="button"
            aria-label={t.common.closeMenu}
            onClick={() => setMenuOpen(false)}
            className="absolute inset-0 h-full w-full cursor-default bg-night-900/55 backdrop-blur-[2px]"
          />

          {/* Anchored to the bottom, where the thumb already is — a sheet that
              opens at the top of a phone screen is a menu you reach for with
              your other hand. */}
          <div
            className="animate-pop-in absolute inset-x-0 bottom-0 max-h-[82vh] overflow-y-auto rounded-t-[26px] border-t border-line bg-surface px-3.5 pt-2.5 shadow-[0_-12px_36px_rgb(23_32_44/0.22)]"
            style={{ paddingBottom: "calc(1rem + env(safe-area-inset-bottom))" }}
          >
            <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-sand-300" aria-hidden />

            <div className="mb-3 flex items-center justify-between gap-3 px-1">
              <h2 className="m-0 font-display text-[15px] font-extrabold text-ink">
                {t.admin.allSections}
              </h2>
              <button
                type="button"
                onClick={() => setMenuOpen(false)}
                aria-label={t.common.closeMenu}
                className="grid size-8 place-items-center rounded-full bg-sand-100 text-muted"
              >
                <Icon name="close" size={18} />
              </button>
            </div>

            {/* Two columns of large targets rather than a list of thin rows:
                the whole tile is tappable, which is what a thumb needs. */}
            <div className="grid grid-cols-2 gap-2">
              {TABS.map((tab) => {
                const active = isActive(tab);
                const dot =
                  (tab.href === "/admin/requests" && newRequestCount > 0) ||
                  (tab.href === "/admin/owner-requests" && pendingOwnerCount > 0);

                return (
                  <Link
                    key={tab.href}
                    href={tab.href}
                    aria-current={active ? "page" : undefined}
                    className={clsx(
                      "relative flex items-center gap-2.5 rounded-[16px] border p-3 text-[13px] no-underline transition hover:no-underline",
                      active
                        ? "border-gold-500 bg-gold-100 font-bold text-bronze"
                        : "border-line bg-sand-50 font-semibold text-ink",
                    )}
                  >
                    <span
                      className={clsx(
                        "grid size-9 shrink-0 place-items-center rounded-xl",
                        active ? "bg-surface text-bronze" : "bg-surface text-muted",
                      )}
                    >
                      <Icon name={tab.icon} size={20} />
                    </span>
                    <span className="min-w-0 flex-1 truncate">{t.admin[tab.labelKey]}</span>
                    {dot && (
                      <span className="size-2 shrink-0 rounded-full bg-busy" aria-hidden />
                    )}
                  </Link>
                );
              })}
            </div>

            <div className="mt-2.5 grid grid-cols-2 gap-2">
              <Link
                href="/"
                className="flex items-center gap-2.5 rounded-[16px] border border-line bg-sand-50 p-3 text-[13px] font-semibold text-ink no-underline hover:no-underline"
              >
                <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-surface text-muted">
                  <Icon name="public" size={20} />
                </span>
                <span className="min-w-0 flex-1 truncate">{t.nav.home}</span>
              </Link>

              {/* The language switcher and sign-out are icon-only in the header
                  and disappear entirely below `sm:`. This is where they are
                  actually reachable on a phone. */}
              <form
                action={() => startTransition(() => void logoutAction())}
                className="contents"
              >
                <button
                  type="submit"
                  disabled={pending}
                  className="flex items-center gap-2.5 rounded-[16px] border border-line bg-sand-50 p-3 text-[13px] font-semibold text-ink transition disabled:opacity-50"
                >
                  <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-surface text-busy">
                    <Icon name="logout" size={20} />
                  </span>
                  <span className="min-w-0 flex-1 truncate text-start">{t.auth.signOut}</span>
                </button>
              </form>
            </div>

            <div className="mt-3 flex justify-center">
              <LanguageSwitcher />
            </div>
          </div>
        </div>
      )}
    </div>
    </ToastProvider>
  );
}
