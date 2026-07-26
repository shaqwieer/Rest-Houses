"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useOptimistic, useState, useTransition } from "react";
import clsx from "clsx";
import { Icon } from "@/components/ui/icon";
import { Select } from "@/components/ui/field";
import { useToast } from "@/components/ui/toast";
import { setRangeBlocked, toggleBlockedDate } from "@/app/actions/availability";
import { DOW_AR_SHORT } from "@/lib/constants";
import { arMonthLabel, buildMonthGrid, shiftMonth, todayISO, type ISODate } from "@/lib/dates";
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

export type AvailabilityEntry = { date: ISODate; status: "BLOCKED" | "BOOKED" };

export function AvailabilityEditor({
  listings,
  selectedId,
  entries,
}: {
  listings: { id: string; name: string }[];
  selectedId: string;
  entries: AvailabilityEntry[];
}) {
  const router = useRouter();
  const params = useSearchParams();
  const { toast } = useToast();
  const [pending, startTransition] = useTransition();

  const today = todayISO();
  const [view, setView] = useState(() => {
    const [y, m] = today.split("-").map(Number);
    return { year: y, month: m - 1 };
  });

  // Optimistic overlay: a Map of date → status, mutated by a toggle before the
  // server confirms.
  const [optimistic, applyOptimistic] = useOptimistic(
    new Map(entries.map((e) => [e.date, e.status] as const)),
    (current: Map<string, "BLOCKED" | "BOOKED">, date: string) => {
      const next = new Map(current);
      if (next.has(date)) next.delete(date);
      else next.set(date, "BLOCKED");
      return next;
    },
  );

  // Both statuses render as unavailable in the visitor's calendar.
  const unavailable = new Set(optimistic.keys());
  const cells = buildMonthGrid(view.year, view.month, unavailable, today);

  const blockedCount = [...optimistic.values()].filter((s) => s === "BLOCKED").length;
  const bookedCount = [...optimistic.values()].filter((s) => s === "BOOKED").length;

  const atFirstMonth = (() => {
    const [y, m] = today.split("-").map(Number);
    return view.year === y && view.month === m - 1;
  })();

  function onSelectListing(id: string) {
    const next = new URLSearchParams(params.toString());
    next.set("listing", id);
    router.push(`/admin/calendar?${next.toString()}`);
  }

  function onToggle(date: ISODate) {
    startTransition(async () => {
      applyOptimistic(date);
      const result = await toggleBlockedDate(selectedId, date);
      if (!result.ok) toast(result.error, "error");
      // Refresh either way: on success to persist, on failure to reconcile.
      router.refresh();
    });
  }

  /** Block or free the rest of the visible month in one go. */
  function onBulk(blocked: boolean) {
    const first = `${view.year}-${String(view.month + 1).padStart(2, "0")}-01`;
    const { year: ny, month: nm } = shiftMonth(view.year, view.month, 1);
    const nextFirst = `${ny}-${String(nm + 1).padStart(2, "0")}-01`;
    const from = first < today ? today : first;

    startTransition(async () => {
      const result = await setRangeBlocked(selectedId, from, nextFirst, blocked);
      toast(result.ok ? (result.message ?? "تم") : result.error, result.ok ? "ok" : "error");
      if (result.ok) router.refresh();
    });
  }

  const selectedName = listings.find((l) => l.id === selectedId)?.name ?? "";

  return (
    <div className="animate-fade-up">
      <h1 className="m-0 mb-1 font-display text-[20px] font-extrabold text-ink">محرّر التوفّر</h1>
      <p className="m-0 mb-4 text-[13.5px] leading-relaxed text-muted">
        اضغط على أي يوم لحظره أو إتاحته. الأيام المحظورة تظهر للزوار كـ«محجوز».
      </p>

      <label className="mb-3.5 flex flex-col gap-1.5">
        <span className="text-[12.5px] font-bold text-bronze">الاستراحة</span>
        <Select value={selectedId} onChange={(e) => onSelectListing(e.target.value)}>
          {listings.map((l) => (
            <option key={l.id} value={l.id}>
              {l.name}
            </option>
          ))}
        </Select>
      </label>

      <div className="rounded-[20px] border border-line bg-surface p-4 shadow-e1">
        {/* month nav */}
        <div className="mb-3.5 flex items-center justify-between">
          <button
            type="button"
            onClick={() => setView((v) => shiftMonth(v.year, v.month, -1))}
            disabled={atFirstMonth}
            aria-label="الشهر السابق"
            className="grid size-8.5 place-items-center rounded-xl border border-line text-ink disabled:opacity-35"
          >
            <Icon name="chevron_right" size={19} />
          </button>
          <span className="font-display text-[16px] font-extrabold text-ink">
            {arMonthLabel(view.year, view.month)}
          </span>
          <button
            type="button"
            onClick={() => setView((v) => shiftMonth(v.year, v.month, 1))}
            aria-label="الشهر التالي"
            className="grid size-8.5 place-items-center rounded-xl border border-line text-ink"
          >
            <Icon name="chevron_left" size={19} />
          </button>
        </div>

        {/* weekday header */}
        <div className="mb-1.5 grid grid-cols-7 gap-1.5">
          {DOW_AR_SHORT.map((d) => (
            <div key={d} className="text-center text-[10.5px] font-bold text-muted">
              {d}
            </div>
          ))}
        </div>

        {/* days */}
        <div className="grid grid-cols-7 gap-1.5">
          {cells.map((cell) => {
            if (cell.kind === "blank") return <div key={cell.key} aria-hidden />;

            const status = optimistic.get(cell.iso);
            const isBooked = status === "BOOKED";
            const isBlocked = status === "BLOCKED";

            return (
              <button
                key={cell.key}
                type="button"
                onClick={() => onToggle(cell.iso)}
                disabled={cell.isPast || pending}
                aria-label={`${cell.dayNumber}${
                  isBooked ? " — محجوز بطلب مؤكد" : isBlocked ? " — محظور" : " — متاح"
                }`}
                aria-pressed={Boolean(status)}
                className={clsx(
                  "flex h-11 flex-col items-center justify-center rounded-[10px] border text-[13px] font-bold leading-none transition",
                  cell.isPast && "cursor-not-allowed border-[#EFE9DC] bg-[#F8F5EE] text-off",
                  !cell.isPast &&
                    isBooked &&
                    // Confirmed bookings look distinct from owner blocks and
                    // can't be freed here — the request has to be cancelled.
                    "cursor-not-allowed border-ok bg-ok-bg text-ok",
                  !cell.isPast && isBlocked && "cursor-pointer border-busy bg-busy-bg text-busy",
                  !cell.isPast &&
                    !status &&
                    "cursor-pointer border-line bg-surface text-ink hover:border-gold-500 hover:bg-gold-100",
                )}
              >
                <span>{cell.label}</span>
                {cell.hijri && (
                  <span className="mt-0.5 text-[8.5px] font-medium opacity-50">{cell.hijri}</span>
                )}
              </button>
            );
          })}
        </div>

        {/* legend */}
        <div className="mt-3.5 flex flex-wrap gap-3.5 border-t border-line pt-3">
          <Legend swatch="border border-line bg-surface" label="متاح للحجز" />
          <Legend swatch="border border-busy bg-busy-bg" label="محظور — اضغط للتحرير" />
          <Legend swatch="border border-ok bg-ok-bg" label="محجوز بطلب مؤكد" />
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
          <Icon name="event_busy" size={18} />
          حظر بقية الشهر
        </button>
        <button
          type="button"
          onClick={() => onBulk(false)}
          disabled={pending}
          className="flex items-center justify-center gap-2 rounded-2xl border border-line bg-surface p-3.5 text-[13px] font-bold text-ink transition hover:border-ok hover:text-ok disabled:opacity-50"
        >
          <Icon name="event_available" size={18} />
          تحرير بقية الشهر
        </button>
      </div>

      <div className="mt-2.5 flex flex-wrap items-center gap-2 rounded-2xl bg-gold-100 px-4 py-3.5 text-[13px] font-semibold text-bronze">
        <Icon name="event_busy" size={19} />
        <span>
          {arNum(blockedCount)} يومًا محظورًا
          {bookedCount > 0 && <> و {arNum(bookedCount)} يومًا محجوزًا</>} في «{selectedName}»
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
