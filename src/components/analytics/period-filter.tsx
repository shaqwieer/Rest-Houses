import Link from "next/link";
import clsx from "clsx";
import { Icon } from "@/components/ui/icon";
import { ANALYTICS_PERIODS, type AnalyticsPeriod, type DateRange } from "@/lib/analytics";
import { arFullDate } from "@/lib/dates";
import type { Dictionary } from "@/lib/i18n";
import type { Locale } from "@/lib/i18n/config";

/**
 * The period control, and the export beside it.
 *
 * ─── Why this needs no JavaScript ────────────────────────────────────────────
 * The presets are links and the custom range is a plain `<form method="get">`.
 * Both navigate by changing the query string, which is what the page reads its
 * period from — so the whole control works before React has hydrated, the
 * chosen period survives a refresh, and a reader can bookmark or send someone
 * "last quarter for this rest house" as a URL. A client component holding the
 * range in state could do none of those.
 *
 * ─── `extra` ────────────────────────────────────────────────────────────────
 * Any other query parameter the page is keyed by — on the operator's view, the
 * selected rest house. It is threaded through every link and re-emitted as
 * hidden inputs in the form, because a `<form method="get">` REPLACES the query
 * string rather than merging into it: without this, choosing a custom range
 * would silently reset the picker to "all rest houses".
 */
export function PeriodFilter({
  basePath,
  exportPath,
  period,
  range,
  previous,
  extra = {},
  t,
  locale,
}: {
  basePath: string;
  exportPath: string;
  period: AnalyticsPeriod;
  range: DateRange;
  previous: DateRange;
  extra?: Record<string, string>;
  t: Dictionary;
  locale: Locale;
}) {
  const href = (next: AnalyticsPeriod) => {
    const params = new URLSearchParams({ ...extra, period: next });
    // A custom link with no dates on it would resolve straight back to the
    // default; carry the current range so the tab opens on what is on screen.
    if (next === "custom") {
      params.set("from", range.from);
      params.set("to", range.lastDay);
    }
    return `${basePath}?${params}`;
  };

  const exportHref = () => {
    const params = new URLSearchParams({ ...extra, period });
    if (period === "custom") {
      params.set("from", range.from);
      params.set("to", range.lastDay);
    }
    return `${exportPath}?${params}`;
  };

  const label: Record<AnalyticsPeriod, string> = {
    "7d": t.analytics.period7d,
    "30d": t.analytics.period30d,
    "3m": t.analytics.period3m,
    "6m": t.analytics.period6m,
    "1y": t.analytics.period1y,
    custom: t.analytics.periodCustom,
  };

  return (
    <div className="rounded-[20px] border border-line bg-surface p-4 shadow-e1">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <span className="text-[12px] font-semibold text-muted">{t.analytics.period}</span>
        <a
          href={exportHref()}
          className="inline-flex items-center gap-1.5 rounded-full border border-line bg-sand-50 px-3 py-1.5 text-[12px] font-bold text-ink no-underline transition hover:border-gold-500 hover:no-underline"
        >
          <Icon name="ios_share" size={15} className="text-bronze" />
          {t.analytics.exportExcel}
        </a>
      </div>

      <div className="flex flex-wrap gap-1.5">
        {ANALYTICS_PERIODS.map((option) => (
          <Link
            key={option}
            href={href(option)}
            aria-current={option === period ? "true" : undefined}
            className={clsx(
              "rounded-full px-3.5 py-2 text-[12.5px] no-underline transition hover:no-underline",
              option === period
                ? "bg-gold-100 font-bold text-bronze"
                : "border border-line bg-sand-50 font-semibold text-muted hover:border-gold-500",
            )}
          >
            {label[option]}
          </Link>
        ))}
      </div>

      {period === "custom" && (
        <form method="get" action={basePath} className="mt-3 flex flex-wrap items-end gap-2">
          <input type="hidden" name="period" value="custom" />
          {Object.entries(extra).map(([name, value]) => (
            <input key={name} type="hidden" name={name} value={value} />
          ))}

          <label className="flex flex-col gap-1 text-[11.5px] font-semibold text-muted">
            {t.analytics.from}
            <input
              type="date"
              name="from"
              defaultValue={range.from}
              className="rounded-xl border border-line bg-sand-50 px-3 py-2 text-[13px] text-ink"
            />
          </label>
          <label className="flex flex-col gap-1 text-[11.5px] font-semibold text-muted">
            {t.analytics.to}
            <input
              type="date"
              name="to"
              defaultValue={range.lastDay}
              className="rounded-xl border border-line bg-sand-50 px-3 py-2 text-[13px] text-ink"
            />
          </label>
          <button
            type="submit"
            className="rounded-full bg-night-900 px-4 py-2.5 text-[12.5px] font-bold text-sand-50 transition hover:bg-night-700"
          >
            {t.analytics.apply}
          </button>
        </form>
      )}

      <p className="m-0 mt-3 text-[11.5px] text-muted">
        {t.analytics.rangeLine(arFullDate(range.from, locale), arFullDate(range.lastDay, locale))}
        {" · "}
        {t.analytics.comparedTo(
          arFullDate(previous.from, locale),
          arFullDate(previous.lastDay, locale),
        )}
      </p>
    </div>
  );
}
