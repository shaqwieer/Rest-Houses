"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useOptimistic, useState, useTransition } from "react";
import clsx from "clsx";
import { Icon } from "@/components/ui/icon";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Select, TextInput } from "@/components/ui/field";
import { useToast } from "@/components/ui/toast";
import {
  setRangeBlocked,
  setRangeSpecial,
  toggleBlockedDate,
  toggleSpecialDate,
  updateSpecialDate,
} from "@/app/actions/availability";
import { dayNamesShort } from "@/lib/constants";
import {
  arDayMonth,
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

/** One marked occasion night. `price` null → the listing's `holidayPrice`. */
type SpecialEntry = { label: string; price: number | null };

/**
 * A price box's text as a day price: null for blank, undefined for anything
 * that is not a whole number of dirhams. The server checks again — this only
 * stops an obvious typo from costing a round trip.
 */
function parseDayPrice(raw: string): number | null | undefined {
  const text = raw.trim();
  if (text === "") return null;
  const n = Number(text);
  return Number.isInteger(n) && n >= 0 ? n || null : undefined;
}

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
  /**
   * The days charged at an occasion rate: the occasion's name, and the day's
   * own price (null → the listing's `holidayPrice`).
   */
  specialDays: { date: ISODate; label: string; price: number | null }[];
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
  // The price a tap marks a new day with, as typed. Blank = the listing's rate.
  const [occasionPriceText, setOccasionPriceText] = useState("");
  // The marked day open in the edit dialog, with its fields as typed.
  const [editing, setEditing] = useState<{
    date: ISODate;
    label: string;
    price: string;
  } | null>(null);

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

  // Marked occasion nights, with the same optimistic treatment: marking,
  // editing or unmarking shows on the cell immediately and reconciles on
  // refresh. `entry` null removes the day.
  const [optimisticSpecial, applyOptimisticSpecial] = useOptimistic(
    new Map(specialDays.map((d) => [d.date, { label: d.label, price: d.price }] as const)),
    (
      current: Map<string, SpecialEntry>,
      change: { date: string; entry: SpecialEntry | null },
    ) => {
      const next = new Map(current);
      if (change.entry) next.set(change.date, change.entry);
      else next.delete(change.date);
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

  /** What a marked day charges: its own price, else the listing's rate, else nothing. */
  const effectivePrice = (entry: SpecialEntry): number | null =>
    entry.price ?? (holidayPrice > 0 ? holidayPrice : null);

  /** "رأس السنة — ٨٬٠٠٠ د.إ", for a cell's title and its screen-reader label. */
  const describeSpecial = (entry: SpecialEntry): string => {
    const price = effectivePrice(entry);
    return `${entry.label || t.calendar.specialDay}${
      price ? ` — ${arNum(price, locale)} ${t.common.aed}` : ""
    }`;
  };

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
    // A day already marked opens for editing rather than unmarking on the
    // spot. Its price is now something the owner may have set by hand, and one
    // stray tap should not throw New Year's Eve's 8,000 away.
    const marked = mode === "special" ? optimisticSpecial.get(date) : undefined;
    if (marked) {
      setEditing({
        date,
        label: marked.label,
        price: marked.price === null ? "" : String(marked.price),
      });
      return;
    }

    const price = mode === "special" ? parseDayPrice(occasionPriceText) : null;
    if (price === undefined) {
      toast(t.validation.occasionPriceInvalid, "error");
      return;
    }

    startTransition(async () => {
      if (mode === "special") {
        applyOptimisticSpecial({ date, entry: { label: occasion, price } });
        const result = await toggleSpecialDate(selectedId, date, occasion, price);
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

  /** Save the edit dialog — a new name or price for a day already marked. */
  function onSaveEdit() {
    if (!editing) return;
    const { date, label } = editing;
    const price = parseDayPrice(editing.price);
    if (price === undefined) {
      toast(t.validation.occasionPriceInvalid, "error");
      return;
    }

    setEditing(null);
    startTransition(async () => {
      applyOptimisticSpecial({ date, entry: { label, price } });
      const result = await updateSpecialDate(selectedId, date, label, price);
      toast(
        result.ok ? (result.message ?? t.common.saved) : result.error,
        result.ok ? "ok" : "error",
      );
      router.refresh();
    });
  }

  /** Unmark the day open in the edit dialog. */
  function onRemoveEdit() {
    if (!editing) return;
    const { date } = editing;

    setEditing(null);
    startTransition(async () => {
      applyOptimisticSpecial({ date, entry: null });
      const result = await toggleSpecialDate(selectedId, date);
      if (!result.ok) toast(result.error, "error");
      router.refresh();
    });
  }

  /** Apply the current mode to the rest of the visible month in one go. */
  function onBulk(on: boolean) {
    const { from, to } = visibleMonthRange();
    const price = mode === "special" && on ? parseDayPrice(occasionPriceText) : null;
    if (price === undefined) {
      toast(t.validation.occasionPriceInvalid, "error");
      return;
    }

    startTransition(async () => {
      const result =
        mode === "special"
          ? await setRangeSpecial(selectedId, from, to, on, occasion, price)
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
          {/* The price a tap marks a new day with. Blank keeps the listing's
              occasion rate, which is what every day marked before this box
              existed charges. */}
          <label className="flex flex-col gap-1.5">
            <span className="text-[12.5px] font-bold text-bronze">
              {t.calendar.occasionPrice}
            </span>
            <TextInput
              value={occasionPriceText}
              onChange={(e) => setOccasionPriceText(e.target.value)}
              type="number"
              inputMode="numeric"
              min={0}
              placeholder={holidayPrice > 0 ? String(holidayPrice) : ""}
              disabled={pending}
              className="font-bold"
            />
            <span className="text-[11.5px] leading-relaxed text-muted">
              {holidayPrice > 0
                ? t.calendar.occasionPriceFallback(arNum(holidayPrice, locale))
                : t.calendar.occasionPriceNoFallback}
            </span>
          </label>
          {/* The listing's own rate is named in the hint above; this only
              speaks up when there is none, since a marked day then costs more
              only if it is given a price of its own. */}
          {holidayPrice <= 0 && (
            <p className="m-0 text-[12px] leading-relaxed text-bronze">
              {t.calendar.holidayRateMissing}
            </p>
          )}
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
            const special = optimisticSpecial.get(cell.iso);
            const isSpecial = special !== undefined;
            const specialPrice = special ? effectivePrice(special) : null;

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
                  special ? ` — ${describeSpecial(special)}` : ""
                }`}
                title={
                  special
                    ? describeSpecial(special)
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
                {/* A marked day shows what it charges in place of the Hijri date,
                    so a month of occasions — 5,000 here, 8,000 on New Year's
                    Eve — can be checked at a glance rather than one tooltip at
                    a time. */}
                {isSpecial && !cell.isPast && specialPrice ? (
                  <span
                    aria-hidden
                    className="mt-0.5 text-[8.5px] font-extrabold leading-none text-gold-600"
                  >
                    ★{arNum(specialPrice, locale)}
                  </span>
                ) : (
                  cell.hijri && (
                    <span className="mt-0.5 text-[8.5px] font-medium opacity-50">{cell.hijri}</span>
                  )
                )}
                {isSpecial && !cell.isPast && !specialPrice && (
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

      {/* Editing a day that is already marked: its name, its own price, or
          unmarking it. A dialog rather than a second tap meaning "unmark",
          because the price is now worth protecting from a stray tap. */}
      <Dialog
        open={editing !== null}
        onClose={() => setEditing(null)}
        label={editing ? t.calendar.editOccasionTitle(arDayMonth(editing.date, locale)) : undefined}
      >
        {editing && (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              onSaveEdit();
            }}
            className="flex flex-col gap-3"
          >
            <h2 className="m-0 font-display text-[17px] font-extrabold text-ink">
              {t.calendar.editOccasionTitle(arDayMonth(editing.date, locale))}
            </h2>

            <label className="flex flex-col gap-1.5">
              <span className="text-[12.5px] font-bold text-bronze">
                {t.calendar.occasionName}
              </span>
              <TextInput
                value={editing.label}
                onChange={(e) => setEditing({ ...editing, label: e.target.value })}
                placeholder={t.calendar.occasionPlaceholder}
                maxLength={60}
              />
            </label>

            <label className="flex flex-col gap-1.5">
              <span className="text-[12.5px] font-bold text-bronze">
                {t.calendar.occasionPrice}
              </span>
              <TextInput
                value={editing.price}
                onChange={(e) => setEditing({ ...editing, price: e.target.value })}
                type="number"
                inputMode="numeric"
                min={0}
                placeholder={holidayPrice > 0 ? String(holidayPrice) : ""}
                className="font-bold"
              />
              <span className="text-[11.5px] leading-relaxed text-muted">
                {holidayPrice > 0
                  ? t.calendar.occasionPriceFallback(arNum(holidayPrice, locale))
                  : t.calendar.occasionPriceNoFallback}
              </span>
            </label>

            <div className="mt-1 flex flex-wrap gap-2.5">
              <Button type="submit" className="flex-1">
                {t.common.save}
              </Button>
              <Button type="button" variant="danger" onClick={onRemoveEdit}>
                {t.calendar.removeOccasion}
              </Button>
              <Button type="button" variant="ghost" onClick={() => setEditing(null)}>
                {t.common.cancel}
              </Button>
            </div>
          </form>
        )}
      </Dialog>
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
