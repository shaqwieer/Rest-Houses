"use client";

import Link from "next/link";
import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { useState } from "react";
import clsx from "clsx";
import { Icon } from "@/components/ui/icon";
import { useLocale } from "@/lib/i18n/provider";
import { arNum } from "@/lib/format";

/**
 * Shared chrome for the admin's large lists: a search box, filter chips, and
 * server-side pagination.
 *
 * ─── Why the URL is the state ────────────────────────────────────────────────
 * Search term, filters and page number all live in the query string rather than
 * in React state. That makes every view linkable and back-button-correct, and —
 * the part that matters here — it means the *server* does the filtering and
 * paging, because it reads those params before rendering. Holding them in
 * component state would force the whole table to be fetched client-side and
 * narrowed in the browser, which is exactly what breaks once the audit log has
 * a hundred thousand rows.
 */

/** Build a URL preserving the current params, overriding some, dropping empties. */
function buildHref(
  pathname: string,
  current: URLSearchParams,
  overrides: Record<string, string | null>,
): string {
  const next = new URLSearchParams(current.toString());
  for (const [key, value] of Object.entries(overrides)) {
    if (value === null || value === "") next.delete(key);
    else next.set(key, value);
  }
  const qs = next.toString();
  return qs ? `${pathname}?${qs}` : pathname;
}

export function AdminSearch({ placeholder }: { placeholder?: string }) {
  const { t } = useLocale();
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [value, setValue] = useState(params.get("q") ?? "");

  function submit(e: React.FormEvent) {
    e.preventDefault();
    // Any new search returns to page 1 — staying on page 7 of the old result
    // set would usually land on an empty page.
    router.push(buildHref(pathname, params, { q: value.trim() || null, page: null }));
  }

  return (
    <form onSubmit={submit} className="flex flex-1 items-center gap-2">
      <span className="flex min-w-0 flex-1 items-center gap-2 rounded-full border border-line bg-surface px-3.5 focus-within:border-gold-500">
        <Icon name="search" size={18} className="shrink-0 text-muted" />
        <input
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder={placeholder ?? t.admin.searchPlaceholder}
          className="min-w-0 flex-1 border-0 bg-transparent py-2.5 text-[13.5px] text-ink outline-none"
        />
        {value && (
          <button
            type="button"
            onClick={() => {
              setValue("");
              router.push(buildHref(pathname, params, { q: null, page: null }));
            }}
            aria-label={t.common.reset}
            className="shrink-0 text-muted hover:text-busy"
          >
            <Icon name="close" size={16} />
          </button>
        )}
      </span>
      <button
        type="submit"
        className="shrink-0 rounded-full bg-night-900 px-4 py-2.5 text-[13px] font-bold text-sand-100"
      >
        {t.common.search}
      </button>
    </form>
  );
}

export function AdminFilterChips({
  param,
  options,
}: {
  param: string;
  options: { value: string; label: string; count?: number }[];
}) {
  const { locale } = useLocale();
  const pathname = usePathname();
  const params = useSearchParams();
  const active = params.get(param) ?? "all";

  return (
    <div className="no-scrollbar flex gap-1.5 overflow-x-auto pb-1">
      {options.map((o) => (
        <Link
          key={o.value}
          href={buildHref(pathname, params, {
            [param]: o.value === "all" ? null : o.value,
            page: null,
          })}
          className={clsx(
            "shrink-0 rounded-full border px-3.5 py-2 text-[12.5px] no-underline transition hover:no-underline",
            active === o.value
              ? "border-gold-600 bg-gold-100 font-bold text-bronze"
              : "border-line bg-surface font-medium text-ink hover:border-gold-500",
          )}
        >
          {o.label}
          {o.count !== undefined && ` (${arNum(o.count, locale)})`}
        </Link>
      ))}
    </div>
  );
}

export function AdminPagination({
  page,
  pageCount,
  total,
  pageSize,
}: {
  page: number;
  pageCount: number;
  total: number;
  pageSize: number;
}) {
  const { t, locale } = useLocale();
  const pathname = usePathname();
  const params = useSearchParams();

  if (total === 0) return null;

  const from = (page - 1) * pageSize + 1;
  const to = Math.min(total, page * pageSize);

  return (
    <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
      <span className="text-[12.5px] text-muted">
        {t.admin.showingRange(
          arNum(from, locale),
          arNum(to, locale),
          arNum(total, locale),
        )}
      </span>

      <div className="flex items-center gap-1.5">
        <PageLink
          href={buildHref(pathname, params, { page: String(page - 1) })}
          disabled={page <= 1}
          label={t.common.previous}
          // The chevron points backwards along the reading direction, so it
          // flips with the document rather than always pointing left.
          icon={locale === "ar" ? "chevron_right" : "chevron_left"}
        />
        <span className="px-2 text-[12.5px] font-bold text-ink">
          {arNum(page, locale)} {t.common.of} {arNum(pageCount, locale)}
        </span>
        <PageLink
          href={buildHref(pathname, params, { page: String(page + 1) })}
          disabled={page >= pageCount}
          label={t.common.next}
          icon={locale === "ar" ? "chevron_left" : "chevron_right"}
        />
      </div>
    </div>
  );
}

function PageLink({
  href,
  disabled,
  label,
  icon,
}: {
  href: string;
  disabled: boolean;
  label: string;
  icon: "chevron_left" | "chevron_right";
}) {
  if (disabled) {
    return (
      <span
        aria-disabled
        className="grid size-9 place-items-center rounded-xl border border-line bg-sand-100 text-off"
      >
        <Icon name={icon} size={18} />
      </span>
    );
  }
  return (
    <Link
      href={href}
      aria-label={label}
      className="grid size-9 place-items-center rounded-xl border border-line bg-surface text-ink no-underline transition hover:border-gold-500 hover:no-underline"
    >
      <Icon name={icon} size={18} />
    </Link>
  );
}

/**
 * A horizontally scrollable table wrapper.
 *
 * The scroll lives on this container rather than the page, so a wide table on a
 * phone scrolls inside its own box and the document body never scrolls
 * sideways — which would otherwise shift the whole layout.
 */
export function AdminTable({ children }: { children: React.ReactNode }) {
  return (
    <div className="overflow-x-auto rounded-[20px] border border-line bg-surface shadow-e1">
      <table className="w-full min-w-[720px] border-collapse text-start">{children}</table>
    </div>
  );
}

export function Th({ children }: { children: React.ReactNode }) {
  return (
    <th className="border-b border-line px-3.5 py-3 text-start text-[12px] font-bold text-bronze">
      {children}
    </th>
  );
}

export function Td({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <td className={clsx("border-b border-line px-3.5 py-3 text-[13px] text-ink", className)}>
      {children}
    </td>
  );
}

export function EmptyRow({ colSpan, message }: { colSpan: number; message: string }) {
  return (
    <tr>
      <td colSpan={colSpan} className="px-3.5 py-10 text-center text-[13.5px] text-muted">
        {message}
      </td>
    </tr>
  );
}
