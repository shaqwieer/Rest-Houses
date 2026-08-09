"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useOptimistic, useState, useTransition } from "react";
import clsx from "clsx";
import { Icon } from "@/components/ui/icon";
import { Select, TextInput } from "@/components/ui/field";
import { useToast } from "@/components/ui/toast";
import {
  setRangeBlocked,
  setRangeSpecial,
  toggleBlockedDate,
  toggleSpecialDate,
} from "@/app/actions/availability";
import { dayNamesShort } from "@/lib/constants";
import {
  arMonthLabel,
  buildMonthGrid,
  shiftMonth,
  todayISO,
  toWeekendMode,
  type ISODate,
} from "@/lib/dates";
import { useLocale } from "@/lib/i18n/provider";
import { arNum } from "@/lib/format";

/**
 * Owner availability editor.
 *
 * Tapping a day toggles it blocked/free. The update is applied optimistically
 * with `useOptimistic` so the cell flips instantly — on a phone, waiting for a
 * server round-trip per tap makes blocking a whole week feel broken. If the
 * action fails (e.g. the day belongs to a confirmed booking) React discards the
 * optimistic value and a toast explains why.
 */

/**
 * One closed day, already collapsed to the single status the cell shows.
 *
 * `source` names the platform holding an EXTERNAL day ("Airbnb"), so a cell the
 * operator cannot clear says *why* rather than just refusing.
 */
export type AvailabilityEntry = {
  date: ISODate;
  status: "BLOCKED" | "BOOKED" | "EXTERNAL";
  source?: string;
};

/**
 * What tapping a day does.
 *
 * A mode switch rather than two calendars, because the owner is looking at one
 * month and asking two questions about the same cells — "is this open?" and
 * "does this cost more?" — and two grids would mean scrolling between them to
 * see that Eid is both marked and still open for business.
 */
export type CalendarMode = "block" | "special";

export function AvailabilityEditor({
  listings,
  selectedId,
  entries,
  specialDays,
  basePath,
}: {
  /** `weekendMode` is the raw column; normalised per selection below. */
  listings: { id: string; name: string; weekendMode: string; holidayPrice: number }[];
  selectedId: string;
  entries: AvailabilityEntry[];
  /** date → occasion name, for the days charged at the holiday rate. */
  specialDays: { date: ISODate; label: string }[];
  /**
   * Where the listing `<select>` navigates. "/admin/calendar" or
   * "/owner/calendar" — the same component serves both dashboards, and the
   * actions behind it authorise each caller separately.
   */
  basePath: string;
}) {
  const router = useRouter();
  const params = useSearchParams();
  const { toast } = useToast();
  const { t, locale } = useLocale();
  const [pending, startTransition] = useTransition();
  const [mode, setMode] = useState<CalendarMode>("block");
  const [occasion, setOccasion] = useState("");

  const today = todayISO();
  const [view, setView] = useState(() => {
    const [y, m] = today.split("-").map(Number);
    return { year: y, month: m - 1 };
  });

  // Optimistic overlay: a Map of date → entry, mutated by a toggle before the
  // server confirms.
  //
  // Only a free day and an owner-BLOCKED day flip here. A BOOKED or EXTERNAL
  // day is not togglable at all — its button is disabled — so the reducer
  // leaves it alone rather than showing the cell clearing for a moment before
  // the server refuses and React rolls it back.
  const [optimistic, applyOptimistic] = useOptimistic(
    new Map(entries.map((e) => [e.date, e] as const)),
    (current: Map<string, AvailabilityEntry>, date: string) => {
      const existing = current.get(date);
      if (existing && existing.status !== "BLOCKED") return current;

      const next = new Map(current);
      if (existing) next.delete(date);
      else next.set(date, { date, status: "BLOCKED" });
      return next;
    },
  );

  // Marked occasion nights, with the same optimistic treatment: tapping in
  // "special" mode flips the cell immediately and reconciles on refresh.
  const [optimisticSpecial, applyOptimisticSpecial] = useOptimistic(
    new Map(specialDays.map((d) => [d.date, d.label] as const)),
    (current: Map<string, string>, entry: { date: string; label: string }) => {
      const next = new Map(current);
      if (next.has(entry.date)) next.delete(entry.date);
      else next.set(entry.date, entry.label);
      return next;
    },
  );

  // All three statuses render as unavailable in the visitor's calendar.
  const unavailable = new Set(optimistic.keys());
  // The selected rest house's own weekend, so the shading here matches what the
  // guest sees on that listing's page and what its quote actually charges.
  const selected = listings.find((l) => l.id === selectedId);
  const weekendMode = toWeekendMode(selected?.weekendMode);
  // 0 means the listing never set an occasion rate. Marking days is still
  // allowed — the owner may be setting up before pricing — but the panel says
  // plainly that nothing will cost more until the field is filled in, rather
  // than letting them mark a month and wonder why the price never moved.
  const holidayPrice = selected?.holidayPrice ?? 0;
  const cells = buildMonthGrid(view.year, view.month, unavailable, today, locale, weekendMode);

  const statuses = [...optimistic.values()].map((e) => e.status);
  const blockedCount = statuses.filter((s) => s === "BLOCKED").length;
  const bookedCount = statuses.filter((s) => s === "BOOKED").length;
  const externalCount = statuses.filter((s) => s === "EXTERNAL").length;

  const atFirstMonth = (() => {
    const [y, m] = today.split("-").map(Number);
    return view.year === y && view.month === m - 1;
  })();

  function onSelectListing(id: string) {
    const next = new URLSearchParams(params.toString());
    next.set("listing", id);
    router.push(`${basePath}?${next.toString()}`);
  }

  function onToggle(date: ISODate) {
    startTransition(async () => {
      if (mode === "special") {
        applyOptimisticSpecial({ date, label: occasion });
        const result = await toggleSpecialDate(selectedId, date, occasion);
        if (!result.ok) toast(result.error, "error");
      } else {
        applyOptimistic(date);
        const result = await toggleBlockedDate(selectedId, date);
        if (!result.ok) toast(result.error, "error");
      }
      // Refresh either way: on success to persist, on failure to reconcile.
      router.refresh();
    });
  }

  /** The visible month, clipped to today — what both bulk buttons act on. */
  function visibleMonthRange(): { from: ISODate; to: ISODate } {
    const first = `${view.year}-${String(view.month + 1).padStart(2, "0")}-01`;
    const { year: ny, month: nm } = shiftMonth(view.year, view.month, 1);
    return {
      from: first < today ? today : first,
      to: `${ny}-${String(nm + 1).padStart(2, "0")}-01`,
    };
  }

  /** Apply the current mode to the rest of the visible month in one go. */
  function onBulk(on: boolean) {
    const { from, to } = visibleMonthRange();

    startTransition(async () => {
      const result =
        mode === "special"
          ? await setRangeSpecial(selectedId, from, to, on, occasion)
          : await setRangeBlocked(selectedId, from, to, on);
      toast(
        result.ok ? (result.message ?? t.common.saved) : result.error,
        result.ok ? "ok" : "error",
      );
      if (result.ok) router.refresh();
    });
  }

  const selectedName = selected?.name ?? "";
  const specialCount = optimisticSpecial.size;

  return (
    <div className="animate-fade-up">
      <h1 className="m-0 mb-1 font-display text-[20px] font-extrabold text-ink">
          {t.admin.availabilityEditor}
        </h1>
      <p className="m-0 mb-4 text-[13.5px] leading-relaxed text-muted">
        {mode === "special" ? t.calendar.specialModeHint : t.admin.availabilityEditorHint}
      </p>

      <label className="mb-3.5 flex flex-col gap-1.5">
        <span className="text-[12.5px] font-bold text-bronze">{t.admin.selectListing}</span>
        <Select value={selectedId} onChange={(e) => onSelectListing(e.target.value)}>
          {listings.map((l) => (
            <option key={l.id} value={l.id}>
              {l.name}
            </option>
          ))}
        </Select>
      </label>

      {/* What a tap does. Two questions about the same cells, one grid — see
          the note on CalendarMode. */}
      <div
        role="tablist"
        aria-label={t.calendar.modeLabel}
        className="mb-3.5 grid grid-cols-2 gap-1.5 rounded-2xl border border-line bg-sand-50 p-1.5"
      >
        {(["block", "special"] as const).map((m) => (
          <button
            key={m}
            type="button"
            role="tab"
            aria-selected={mode === m}
            onClick={() => setMode(m)}
            className={clsx(
              "flex items-center justify-center gap-2 rounded-xl px-3 py-2.5 text-[13px] font-bold transition",
              mode === m
                ? "bg-night-900 text-sand-50"
                : "bg-transparent text-muted hover:text-ink",
            )}
          >
            <Icon name={m === "block" ? "event_busy" : "celebration"} size={17} />
            {m === "block" ? t.calendar.modeBlock : t.calendar.modeSpecial}
          </button>
        ))}
      </div>

      {mode === "special" && (
        <div className="mb-3.5 flex flex-col gap-2 rounded-2xl border border-gold-500 bg-gold-100 p-3.5">
          <label className="flex flex-col gap-1.5">
            <span className="text-[12.5px] font-bold text-bronze">
              {t.calendar.occasionName}
            </span>
            <TextInput
              value={occasion}
              onChange={(e) => setOccasion(e.target.value)}
              placeholder={t.calendar.occasionPlaceholder}
              maxLength={60}
              disabled={pending}
            />
          </label>
          <p className="m-0 text-[12px] leading-relaxed text-bronze">
            {holidayPrice > 0
              ? t.calendar.holidayRateActive(arNum(holidayPrice, locale))
              : t.calendar.holidayRateMissing}
          </p>
        </div>
      )}

      <div className="rounded-[20px] border border-line bg-surface p-4 shadow-e1">
        {/* month nav */}
        <div className="mb-3.5 flex items-center justify-between">
          <button
            type="button"
            onClick={() => setView((v) => shiftMonth(v.year, v.month, -1))}
            disabled={atFirstMonth}
            aria-label={t.listing.prevMonth}
            className="grid size-8.5 place-items-center rounded-xl border border-line text-ink disabled:opacity-35"
          >
            <Icon name="chevron_right" size={19} />
          </button>
          <span className="font-display text-[16px] font-extrabold text-ink">
            {arMonthLabel(view.year, view.month, locale)}
          </span>
          <button
            type="button"
            onClick={() => setView((v) => shiftMonth(v.year, v.month, 1))}
            aria-label={t.listing.nextMonth}
            className="grid size-8.5 place-items-center rounded-xl border border-line text-ink"
          >
            <Icon name="chevron_left" size={19} />
          </button>
        </div>

        {/* weekday header */}
        <div className="mb-1.5 grid grid-cols-7 gap-1.5">
          {dayNamesShort(locale).map((d) => (
            <div key={d} className="text-center text-[10.5px] font-bold text-muted">
              {d}
            </div>
          ))}
        </div>

        {/* days */}
        <div className="grid grid-cols-7 gap-1.5">
          {cells.map((cell) => {
            if (cell.kind === "blank") return <div key={cell.key} aria-hidden />;

            const entry = optimistic.get(cell.iso);
            const status = entry?.status;
            const isBooked = status === "BOOKED";
            const isBlocked = status === "BLOCKED";
            const isExternal = status === "EXTERNAL";
            const specialLabel = optimisticSpecial.get(cell.iso);
            const isSpecial = specialLabel !== undefined;

            // In "special" mode a booked or imported day is still markable: what
            // it costs and whether it is free to book are unrelated questions,
            // and an owner setting next year's Eid rate should not be stopped by
            // this year's booking. Only "block" mode has days it may not touch.
            const lockedForMode = mode === "block" && (isBooked || isExternal);

            return (
              <button
                key={cell.key}
                type="button"
                onClick={() => onToggle(cell.iso)}
                // An imported day is disabled for the same reason a confirmed
                // booking is: it is not this platform's to release. Pressing it
                // would fail server-side anyway, and a button that always
                // errors teaches an operator to ignore the toast.
                disabled={cell.isPast || pending || lockedForMode}
                aria-label={`${cell.dayNumber}${
                  isBooked
                    ? ` — ${t.admin.dayBookedConfirmed}`
                    : isExternal
                      ? ` — ${t.calendar.dayHeldBy(entry?.source || t.calendar.externalPlatform)}`
                      : isBlocked
                        ? ` — ${t.admin.dayBlocked}`
                        : ` — ${t.admin.availableToBook}`
                }${
                  // Appended rather than replacing: an occasion night can also
                  // be booked or blocked, and a screen reader needs both facts.
                  isSpecial
                    ? ` — ${specialLabel || t.calendar.specialDay}${
                        holidayPrice > 0
                          ? ` (${arNum(holidayPrice, locale)} ${t.common.aed})`
                          : ""
                      }`
                    : ""
                }`}
                title={
                  isSpecial
                    ? `${specialLabel || t.calendar.specialDay}${
                        holidayPrice > 0
                          ? ` — ${arNum(holidayPrice, locale)} ${t.common.aed}`
                          : ""
                      }`
                    : isExternal
                      ? t.calendar.dayHeldBy(entry?.source || t.calendar.externalPlatform)
                      : undefined
                }
                aria-pressed={mode === "special" ? isSpecial : Boolean(status)}
                className={clsx(
                  // `relative` is what the occasion star below positions against. The
                  // guest calendar's cell already carries it for the same reason.
                  "relative flex h-11 flex-col items-center justify-center rounded-[10px] border text-[13px] font-bold leading-none transition",
                  cell.isPast && "cursor-not-allowed border-[#EFE9DC] bg-[#F8F5EE] text-off",
                  !cell.isPast &&
                    isBooked &&
                    // Confirmed bookings look distinct from owner blocks and
                    // can't be freed here — the request has to be cancelled.
                    "cursor-not-allowed border-ok bg-ok-bg text-ok",
                  !cell.isPast &&
                    isExternal &&
                    // A third colour, not a shade of either other one: the
                    // remedy is different from both. This day is released on
                    // Airbnb/Booking.com and nowhere else.
                    "cursor-not-allowed border-gold-500 bg-gold-100 text-bronze",
                  !cell.isPast && isBlocked && "cursor-pointer border-busy bg-busy-bg text-busy",
                  !cell.isPast &&
                    !status &&
                    "cursor-pointer border-line bg-surface text-ink hover:border-gold-500 hover:bg-gold-100",
                  // An occasion night is marked with a ring rather than a fill,
                  // so it can be read *on top of* whichever availability colour
                  // the cell already carries. A fourth background would have
                  // forced a choice between showing that Eid is booked and
                  // showing that it is Eid.
                  !cell.isPast &&
                    isSpecial &&
                    "ring-2 ring-inset ring-gold-500 ring-offset-0",
                )}
              >
                <span>{cell.label}</span>
                {cell.hijri && (
                  <span className="mt-0.5 text-[8.5px] font-medium opacity-50">{cell.hijri}</span>
                )}
                {isSpecial && !cell.isPast && (
                  <span
                    aria-hidden
                    className="absolute bottom-0.5 text-[8px] leading-none text-gold-600"
                  >
                    ★
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {/* legend */}
        <div className="mt-3.5 flex flex-wrap gap-3.5 border-t border-line pt-3">
          <Legend swatch="border border-line bg-surface" label={t.admin.availableToBook} />
          <Legend swatch="border border-busy bg-busy-bg" label={t.admin.dayBlockedClickToFree} />
          <Legend swatch="border border-ok bg-ok-bg" label={t.admin.dayBookedConfirmed} />
          {externalCount > 0 && (
            <Legend
              swatch="border border-gold-500 bg-gold-100"
              label={t.calendar.dayImported}
            />
          )}
          {specialCount > 0 && (
            <Legend
              swatch="border-2 border-gold-500 bg-surface"
              label={t.calendar.specialDay}
            />
          )}
        </div>
      </div>

      {/* bulk actions */}
      <div className="mt-2.5 grid grid-cols-2 gap-2.5">
        <button
          type="button"
          onClick={() => onBulk(true)}
          disabled={pending}
          className="flex items-center justify-center gap-2 rounded-2xl border border-line bg-surface p-3.5 text-[13px] font-bold text-ink transition hover:border-busy hover:text-busy disabled:opacity-50"
        >
          <Icon name={mode === "special" ? "celebration" : "event_busy"} size={18} />
          {mode === "special" ? t.calendar.markRestOfMonth : t.admin.blockRestOfMonth}
        </button>
        <button
          type="button"
          onClick={() => onBulk(false)}
          disabled={pending}
          className="flex items-center justify-center gap-2 rounded-2xl border border-line bg-surface p-3.5 text-[13px] font-bold text-ink transition hover:border-ok hover:text-ok disabled:opacity-50"
        >
          <Icon name="event_available" size={18} />
          {mode === "special" ? t.calendar.unmarkRestOfMonth : t.admin.freeRestOfMonth}
        </button>
      </div>

      <div className="mt-2.5 flex flex-wrap items-center gap-2 rounded-2xl bg-gold-100 px-4 py-3.5 text-[13px] font-semibold text-bronze">
        <Icon name="event_busy" size={19} />
        <span>
          {t.admin.blockedDaysCount(arNum(blockedCount, locale))}
          {bookedCount > 0 && (
            <> · {t.admin.bookedDaysCount(arNum(bookedCount, locale))}</>
          )}
          {externalCount > 0 && (
            <> · {t.calendar.importedDaysCount(arNum(externalCount, locale))}</>
          )}
          {specialCount > 0 && (
            <> · {t.calendar.specialDaysCount(arNum(specialCount, locale))}</>
          )}{" "}
          — {selectedName}
        </span>
      </div>
    </div>
  );
}

function Legend({ swatch, label }: { swatch: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-2 text-[12px] text-muted">
      <span className={clsx("size-3.25 rounded-[5px]", swatch)} aria-hidden />
      {label}
    </span>
  );
}
