"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import clsx from "clsx";
import { Brand } from "./brand";
import { useFavorites } from "./favorites-provider";
import { Icon } from "@/components/ui/icon";
import { arNum } from "@/lib/format";
import type { Settings } from "@/lib/settings";

/**
 * Public site header.
 *
 * Two layouts in one component, switched by CSS breakpoints rather than a
 * device flag: the utility strip + wide nav from `md:` up, and a compact bar
 * with a slide-down menu below it. The prototype toggled these with a state
 * variable, which would have ignored the visitor's actual viewport.
 */

const NAV_LINKS = [
  { href: "/", label: "الرئيسية" },
  { href: "/listings", label: "تصفّح الاستراحات" },
  { href: "/about", label: "من نحن" },
] as const;

export function SiteHeader({ settings }: { settings: Settings }) {
  const pathname = usePathname();
  const { count, ready } = useFavorites();
  const [menuOpen, setMenuOpen] = useState(false);

  const favBadge = ready ? arNum(count) : "";

  return (
    <header className="sticky top-0 z-120 border-b border-line bg-sand-50/95 backdrop-blur-lg">
      {/* ---- utility strip (desktop only) ---- */}
      <div className="hidden bg-night-900 text-sand-100/70 md:block">
        <div className="mx-auto flex max-w-[1280px] items-center gap-5 px-4 py-1.5 text-[12.5px] lg:px-10">
          <a
            href={`tel:${settings.phone ?? settings.whatsappNumber}`}
            className="flex items-center gap-1.5 text-gold-300 no-underline hover:no-underline hover:text-sand-100"
          >
            <Icon name="call" size={16} />
            <span dir="ltr">{settings.phone ?? settings.whatsappNumber}</span>
          </a>
          <span className="opacity-30">|</span>
          <span className="flex items-center gap-1.5">
            <Icon name="bolt" size={16} />
            ردّ سريع عبر الواتساب
          </span>
          <span className="flex-1" />
          <Link
            href="/admin"
            className="flex items-center gap-1.5 rounded-full border border-gold-500/30 px-3 py-1 text-[11.5px] font-bold text-gold-300 no-underline hover:bg-gold-500/15 hover:no-underline"
          >
            <Icon name="lock_open" size={15} />
            دخول المُلّاك
          </Link>
        </div>
      </div>

      {/* ---- main bar ---- */}
      <div className="mx-auto flex max-w-[1280px] items-center gap-3 px-4 py-2.5 md:gap-6 md:py-3.5 lg:px-10">
        {/* mobile: menu toggle */}
        <button
          type="button"
          onClick={() => setMenuOpen((v) => !v)}
          aria-label={menuOpen ? "إغلاق القائمة" : "فتح القائمة"}
          aria-expanded={menuOpen}
          className="grid size-9.5 shrink-0 place-items-center rounded-xl border border-line bg-surface text-ink md:hidden"
        >
          <Icon name={menuOpen ? "close" : "menu"} size={21} />
        </button>

        <div className="flex-1 md:flex-none">
          <Brand settings={settings} size="md" showTagline />
        </div>

        <nav className="hidden min-w-0 flex-1 flex-wrap items-center gap-1 md:flex">
          {NAV_LINKS.map((link) => {
            const active = link.href === "/" ? pathname === "/" : pathname.startsWith(link.href.split("?")[0]);
            return (
              <Link
                key={link.href}
                href={link.href}
                className={clsx(
                  "rounded-full px-3.5 py-2 text-[14.5px] text-ink no-underline transition hover:bg-sand-100 hover:no-underline",
                  active ? "font-bold" : "font-medium",
                )}
              >
                {link.label}
              </Link>
            );
          })}
        </nav>

        {/* favourites — icon-only on mobile, labelled from md up */}
        <Link
          href="/favorites"
          aria-label="المفضلة"
          className="relative flex shrink-0 items-center gap-1.5 rounded-xl border border-line bg-surface p-2 text-[14px] font-semibold text-ink no-underline transition hover:border-gold-500 hover:no-underline md:rounded-full md:px-4 md:py-2.5"
        >
          <Icon name={count > 0 ? "favorite" : "favorite_border"} size={19} className="text-busy" />
          <span className="hidden md:inline">المفضلة</span>
          {ready && count > 0 && (
            <span className="absolute -top-1.5 -start-1.5 grid h-4.5 min-w-4.5 place-items-center rounded-full border-2 border-sand-50 bg-busy px-1 text-[10px] font-bold text-white md:static md:border-0 md:px-1.5 md:text-[11px]">
              {favBadge}
            </span>
          )}
        </Link>

        <Link
          href="/admin"
          className="hidden shrink-0 items-center gap-2 rounded-full bg-night-900 px-5 py-2.5 text-[14px] font-bold text-sand-100 no-underline transition hover:bg-night-700 hover:no-underline md:flex"
        >
          <Icon name="add_home_work" size={18} />
          أضف استراحتك
        </Link>
      </div>

      {/* ---- mobile menu ---- */}
      {menuOpen && (
        <nav className="animate-fade-up border-t border-line bg-surface px-4 py-3 md:hidden">
          <ul className="flex flex-col">
            {NAV_LINKS.map((link) => (
              <li key={link.href}>
                <Link
                  href={link.href}
                  onClick={() => setMenuOpen(false)}
                  className="block rounded-xl px-3 py-3 text-[15px] font-semibold text-ink no-underline hover:bg-sand-100 hover:no-underline"
                >
                  {link.label}
                </Link>
              </li>
            ))}
            <li className="mt-2 border-t border-line pt-2">
              <Link
                href="/admin"
                onClick={() => setMenuOpen(false)}
                className="flex items-center gap-2 rounded-xl px-3 py-3 text-[15px] font-semibold text-bronze no-underline hover:bg-gold-100 hover:no-underline"
              >
                <Icon name="lock_open" size={18} />
                دخول المُلّاك
              </Link>
            </li>
          </ul>
        </nav>
      )}
    </header>
  );
}
