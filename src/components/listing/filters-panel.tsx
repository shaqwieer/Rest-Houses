"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useState, useTransition } from "react";
import clsx from "clsx";
import { Icon } from "@/components/ui/icon";
import { Chip } from "@/components/ui/field";
import { arNum } from "@/lib/format";
import {
  AMENITIES,
  CATEGORIES,
  CITIES,
  CAPACITY_MAX,
  PRICE_MAX,
  PRICE_MIN,
} from "@/lib/constants";

/**
 * Results filter sidebar.
 *
 * All state lives in the URL, not in React: every chip and slider writes a
 * query param and lets the server re-render the results. That makes a filtered
 * view shareable and back-button-correct, and means the filtering logic exists
 * in exactly one place (src/lib/listings.ts) rather than being duplicated
 * client-side.
 *
 * The two sliders are the exception — they hold a local value while dragging so
 * the number updates at 60fps, and only commit to the URL on release.
 */
export function FiltersPanel({
  resultCount,
  /** Rendered inside a mobile sheet; the desktop sidebar is always visible. */
  onClose,
}: {
  resultCount: number;
  onClose?: () => void;
}) {
  const router = useRouter();
  const params = useSearchParams();
  const [, startTransition] = useTransition();

  const city = params.get("city") ?? "all";
  const category = params.get("category") ?? "all";
  const activeAmenities = (params.get("amenities") ?? "").split(",").filter(Boolean);

  const urlMaxPrice = Number(params.get("maxPrice")) || PRICE_MAX;
  const urlCapacity = Number(params.get("capacity")) || 0;

  // Live slider values — committed to the URL on pointer release.
  const [priceDraft, setPriceDraft] = useState(urlMaxPrice);
  const [capacityDraft, setCapacityDraft] = useState(urlCapacity);

  const push = useCallback(
    (mutate: (p: URLSearchParams) => void) => {
      const next = new URLSearchParams(params.toString());
      mutate(next);
      startTransition(() => {
        // scroll:false keeps the grid in place while a filter is toggled.
        router.push(`/listings?${next.toString()}`, { scroll: false });
      });
    },
    [params, router],
  );

  const setParam = useCallback(
    (key: string, value: string | null) => {
      push((p) => {
        if (value === null || value === "" || value === "all") p.delete(key);
        else p.set(key, value);
      });
    },
    [push],
  );

  const toggleAmenity = useCallback(
    (id: string) => {
      const next = activeAmenities.includes(id)
        ? activeAmenities.filter((a) => a !== id)
        : [...activeAmenities, id];
      setParam("amenities", next.join(","));
    },
    [activeAmenities, setParam],
  );

  function reset() {
    // Keep date and free-text search: those came from the hero, and wiping them
    // would throw away the visitor's original intent, not just their filters.
    const keep = new URLSearchParams();
    for (const k of ["from", "to", "q", "sort"]) {
      const v = params.get(k);
      if (v) keep.set(k, v);
    }
    setPriceDraft(PRICE_MAX);
    setCapacityDraft(0);
    startTransition(() => router.push(`/listings?${keep.toString()}`, { scroll: false }));
  }

  const groupLabel = "mb-2.5 text-[12.5px] font-bold tracking-wide text-bronze";

  return (
    <div className="flex flex-col">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="m-0 font-display text-[16px] font-extrabold text-ink">تصفية النتائج</h2>
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            aria-label="إغلاق الفلاتر"
            className="grid size-7.5 place-items-center rounded-[9px] bg-sand-100 text-ink"
          >
            <Icon name="close" size={19} />
          </button>
        )}
      </div>

      {/* city */}
      <div className="mb-5.5">
        <div className={groupLabel}>المدينة / المنطقة</div>
        <div className="flex flex-wrap gap-1.5">
          <Chip active={city === "all"} onClick={() => setParam("city", "all")}>
            كل المدن
          </Chip>
          {CITIES.map((c) => (
            <Chip key={c.id} active={city === c.id} onClick={() => setParam("city", c.id)}>
              {c.ar}
            </Chip>
          ))}
        </div>
      </div>

      {/* occasion */}
      <div className="mb-5.5">
        <div className={groupLabel}>المناسبة</div>
        <div className="flex flex-wrap gap-1.5">
          <Chip active={category === "all"} onClick={() => setParam("category", "all")}>
            الكل
          </Chip>
          {CATEGORIES.map((c) => (
            <Chip
              key={c.id}
              active={category === c.id}
              onClick={() => setParam("category", c.id)}
            >
              {c.ar}
            </Chip>
          ))}
        </div>
      </div>

      {/* max price */}
      <div className="mb-5.5">
        <div className="mb-1.5 flex items-baseline justify-between">
          <span className="text-[12.5px] font-bold tracking-wide text-bronze">
            الحد الأقصى للسعر
          </span>
          <span className="font-display text-[15px] font-extrabold text-ink">
            {arNum(priceDraft)}{" "}
            <span className="text-[11.5px] font-semibold text-muted">د.إ</span>
          </span>
        </div>
        <input
          type="range"
          min={PRICE_MIN}
          max={PRICE_MAX}
          step={50}
          value={priceDraft}
          onChange={(e) => setPriceDraft(Number(e.target.value))}
          // Commit on release (mouse) and on blur (keyboard/touch).
          onPointerUp={() => setParam("maxPrice", priceDraft === PRICE_MAX ? null : String(priceDraft))}
          onKeyUp={() => setParam("maxPrice", priceDraft === PRICE_MAX ? null : String(priceDraft))}
          aria-label="الحد الأقصى للسعر"
          className="h-1.5 w-full cursor-pointer"
        />
        <div className="mt-1 flex justify-between text-[11.5px] text-muted">
          <span>{arNum(PRICE_MIN)}</span>
          <span>{arNum(PRICE_MAX)}</span>
        </div>
      </div>

      {/* capacity */}
      <div className="mb-5.5">
        <div className="mb-1.5 flex items-baseline justify-between">
          <span className="text-[12.5px] font-bold tracking-wide text-bronze">
            السعة (عدد الضيوف)
          </span>
          <span className="font-display text-[15px] font-extrabold text-ink">
            {capacityDraft ? `${arNum(capacityDraft)}+` : "أي عدد"}
          </span>
        </div>
        <input
          type="range"
          min={0}
          max={CAPACITY_MAX}
          step={10}
          value={capacityDraft}
          onChange={(e) => setCapacityDraft(Number(e.target.value))}
          onPointerUp={() => setParam("capacity", capacityDraft === 0 ? null : String(capacityDraft))}
          onKeyUp={() => setParam("capacity", capacityDraft === 0 ? null : String(capacityDraft))}
          aria-label="السعة"
          className="h-1.5 w-full cursor-pointer"
        />
        <div className="mt-1 flex justify-between text-[11.5px] text-muted">
          <span>أي عدد</span>
          <span>{arNum(CAPACITY_MAX)}+</span>
        </div>
      </div>

      {/* amenities */}
      <div>
        <div className={groupLabel}>المرافق</div>
        <div className="flex flex-wrap gap-1.5">
          {AMENITIES.map((a) => (
            <Chip
              key={a.id}
              active={activeAmenities.includes(a.id)}
              onClick={() => toggleAmenity(a.id)}
            >
              <Icon name={a.icon as never} size={16} />
              {a.ar}
            </Chip>
          ))}
        </div>
      </div>

      <button
        type="button"
        onClick={reset}
        className="mt-5 text-[13px] font-semibold text-bronze underline underline-offset-3"
      >
        إعادة ضبط الفلاتر
      </button>

      {onClose && (
        <button
          type="button"
          onClick={onClose}
          className="mt-4 w-full rounded-2xl bg-night-900 p-3.5 text-[14.5px] font-bold text-sand-100"
        >
          عرض {arNum(resultCount)} نتيجة
        </button>
      )}
    </div>
  );
}

/* --------------------------------------------------------------------------
 * The same panel appears in two places in the results layout, so it ships as
 * two components rather than one that renders twice:
 *
 *   <FiltersTrigger>  the "الفلاتر" button in the toolbar row + its bottom
 *                     sheet. Visible below `lg` only.
 *   <FiltersAside>    the sticky sidebar column. Visible from `lg` up.
 *
 * The prototype switched between these with an `isMobile` state flag; here each
 * is hidden by a breakpoint, so the real viewport decides.
 * ------------------------------------------------------------------------ */

export function FiltersTrigger({ resultCount }: { resultCount: number }) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex items-center gap-2 rounded-full border border-gold-600 bg-gold-100 px-4 py-2.5 text-[13.5px] font-bold text-bronze lg:hidden"
      >
        <Icon name="tune" size={18} />
        الفلاتر
      </button>

      {open && (
        <div className="fixed inset-0 z-200 lg:hidden">
          <button
            type="button"
            aria-label="إغلاق الفلاتر"
            onClick={() => setOpen(false)}
            className="absolute inset-0 bg-night-900/50 backdrop-blur-sm"
          />
          <div className="animate-fade-up absolute inset-x-0 bottom-0 max-h-[86vh] overflow-y-auto rounded-t-[24px] border-t border-gold-500 bg-surface p-5 shadow-e2">
            <FiltersPanel resultCount={resultCount} onClose={() => setOpen(false)} />
          </div>
        </div>
      )}
    </>
  );
}

export function FiltersAside({ resultCount }: { resultCount: number }) {
  return (
    <aside
      className={clsx(
        "hidden lg:block",
        "sticky top-[150px] max-h-[calc(100vh-180px)] self-start overflow-y-auto",
        "rounded-[20px] border border-line bg-surface p-5 shadow-e1",
      )}
    >
      <FiltersPanel resultCount={resultCount} />
    </aside>
  );
}
