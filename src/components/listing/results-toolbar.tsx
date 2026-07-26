"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import clsx from "clsx";
import { Icon } from "@/components/ui/icon";
import { SORT_OPTIONS } from "@/lib/constants";
import { MapEmbed, type MapPoint } from "./map-embed";

/** Sort dropdown + map toggle. Both write to the URL so results stay shareable. */
export function ResultsToolbar({ points }: { points: MapPoint[] }) {
  const router = useRouter();
  const params = useSearchParams();
  const [mapOpen, setMapOpen] = useState(params.get("map") === "1");

  const sort = params.get("sort") ?? "reco";

  function setSort(value: string) {
    const next = new URLSearchParams(params.toString());
    if (value === "reco") next.delete("sort");
    else next.set("sort", value);
    router.push(`/listings?${next.toString()}`, { scroll: false });
  }

  return (
    <>
      <label className="flex items-center gap-2 rounded-full border border-line bg-surface px-3.5 py-2.5">
        <Icon name="swap_vert" size={18} className="text-muted" />
        <span className="text-[13px] font-semibold text-muted">ترتيب</span>
        <select
          value={sort}
          onChange={(e) => setSort(e.target.value)}
          aria-label="ترتيب النتائج"
          className="cursor-pointer border-0 bg-transparent text-[13.5px] font-bold text-ink outline-none"
        >
          {SORT_OPTIONS.map((o) => (
            <option key={o.id} value={o.id}>
              {o.ar}
            </option>
          ))}
        </select>
      </label>

      <button
        type="button"
        onClick={() => setMapOpen((v) => !v)}
        aria-pressed={mapOpen}
        className={clsx(
          "flex items-center gap-2 rounded-full border px-4 py-2.5 text-[13.5px] font-bold transition",
          mapOpen
            ? "border-night-900 bg-night-900 text-sand-100"
            : "border-line bg-surface text-ink hover:border-gold-500",
        )}
      >
        <Icon name="map" size={18} />
        عرض الخريطة
      </button>

      {/* Rendered in a portal-ish sibling slot below the toolbar by the parent
          grid; kept here so the toggle and the panel share one state. */}
      {mapOpen && points.length > 0 && (
        <div className="order-last w-full basis-full">
          <div className="mt-4 h-100 overflow-hidden rounded-[20px] border border-line bg-sand-200 shadow-e1">
            <MapEmbed points={points} />
          </div>
        </div>
      )}
    </>
  );
}
