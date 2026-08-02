"use client";

import dynamic from "next/dynamic";
import type { MapPoint } from "./listing-map";
import { useT } from "@/lib/i18n/provider";

/**
 * The loading placeholder.
 *
 * A component rather than inline JSX because `dynamic()`'s `loading` option is
 * evaluated at module scope, where a hook cannot be called — wrapping it makes
 * the label translatable.
 */
function MapLoading() {
  const t = useT();
  return (
    <div className="grid size-full place-items-center bg-sand-200 text-muted">
      <span className="text-[13px]">{t.listing.loadingMap}</span>
    </div>
  );
}

/**
 * Client boundary for the Leaflet map.
 *
 * `next/dynamic({ ssr: false })` is only legal inside a client component, so
 * server pages import this wrapper instead of calling `dynamic` themselves.
 * It also means Leaflet (~40 KB plus its CSS) is a separate chunk fetched only
 * by pages that actually render a map.
 */
const ListingMap = dynamic(() => import("./listing-map"), {
  ssr: false,
  loading: () => <MapLoading />,
});

export function MapEmbed({
  points,
  zoom,
  className,
}: {
  points: MapPoint[];
  zoom?: number;
  className?: string;
}) {
  return <ListingMap points={points} zoom={zoom} className={className} />;
}

export type { MapPoint };
