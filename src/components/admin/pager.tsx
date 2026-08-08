import Link from "next/link";
import { Icon } from "@/components/ui/icon";
import { arNum } from "@/lib/format";
import type { Dictionary } from "@/lib/i18n";
import type { Locale } from "@/lib/i18n/config";

/**
 * How many closed bookings one page of the archive holds.
 *
 * 24, because the grid is two columns on a laptop — so twelve rows, and a whole
 * number of rows on the last page more often than not. Each card carries its
 * own seven-step handover stepper, which is what makes the count matter: this
 * page used to render up to 200 of them at once and was several thousand pixels
 * tall on a phone.
 */
export const ARCHIVE_PAGE_SIZE = 24;

/** 1-based, clamped into range. Junk, 0, -3 and 99 all land somewhere real. */
export function pageFromParam(raw: unknown, totalPages: number): number {
  const n = Math.floor(Number(Array.isArray(raw) ? raw[0] : raw));
  if (!Number.isFinite(n) || n < 1) return 1;
  return Math.min(n, Math.max(1, totalPages));
}

/**
 * Previous / next through the closed-booking archive.
 *
 * Plain links, not a client component: this is a server-rendered list and a
 * page change is a navigation. It also means the pager works before hydration
 * and that a page can be bookmarked or opened in a new tab.
 *
 * `hrefFor` is supplied by the caller because the two surfaces live at
 * different paths and must both carry the active status filter through — losing
 * `?status=CONFIRMED` on page 2 would silently widen what the operator is
 * looking at.
 */
export function Pager({
  page,
  totalPages,
  hrefFor,
  t,
  locale,
}: {
  page: number;
  totalPages: number;
  hrefFor: (page: number) => string;
  t: Dictionary;
  locale: Locale;
}) {
  if (totalPages <= 1) return null;

  const atStart = page <= 1;
  const atEnd = page >= totalPages;

  return (
    <nav
      aria-label={t.admin.pagerLabel}
      className="mt-4 flex items-center justify-center gap-2.5"
    >
      <PagerLink
        href={hrefFor(page - 1)}
        disabled={atStart}
        label={t.common.previous}
        // The glyph points along the reading direction, so it flips with the
        // document — the same rule the editor's back arrow follows.
        icon={locale === "ar" ? "arrow_forward" : "arrow_back"}
      />

      <span className="text-[12.5px] font-semibold text-muted">
        {t.admin.pageOf(arNum(page, locale), arNum(totalPages, locale))}
      </span>

      <PagerLink
        href={hrefFor(page + 1)}
        disabled={atEnd}
        label={t.common.next}
        icon={locale === "ar" ? "arrow_back" : "arrow_forward"}
      />
    </nav>
  );
}

function PagerLink({
  href,
  disabled,
  label,
  icon,
}: {
  href: string;
  disabled: boolean;
  label: string;
  icon: "arrow_back" | "arrow_forward";
}) {
  const shared =
    "grid size-10 place-items-center rounded-xl border no-underline transition hover:no-underline";

  // A <span> rather than a disabled <Link>: there is no such thing, and an
  // anchor with no href is still focusable and still announced as a link.
  if (disabled) {
    return (
      <span
        aria-hidden
        className={`${shared} cursor-not-allowed border-line bg-sand-100 text-sand-400`}
      >
        <Icon name={icon} size={18} />
      </span>
    );
  }

  return (
    <Link
      href={href}
      aria-label={label}
      className={`${shared} border-line bg-surface text-ink hover:border-gold-500`}
    >
      <Icon name={icon} size={18} />
    </Link>
  );
}
