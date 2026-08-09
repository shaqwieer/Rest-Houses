"use client";

import { useEffect, useRef } from "react";
import type { Map as LeafletMap, LayerGroup } from "leaflet";
import { arNum, currencyUnit } from "@/lib/format";
import { useLocale } from "@/lib/i18n/provider";

// Leaflet's own stylesheet. Imported statically so the bundler can process it,
// but because this whole module is only reached through `next/dynamic` (see
// map-embed.tsx) the CSS lands in the same lazy chunk as the JS — pages without
// a map never download either.
import "leaflet/dist/leaflet.css";

/**
 * Leaflet map — results overview and per-listing location.
 *
 * Why Leaflet and not the Google Maps JS API: it needs no API key and no
 * billing account, which matters for a self-hosted deployment the owner runs
 * themselves. Tiles come from CARTO's free Voyager basemap, whose muted palette
 * happens to sit well against the sand/gold design. The *footer* and *settings*
 * maps are Google Maps embeds instead, because the client asked for Google Maps
 * for the business location specifically — that's a keyless `<iframe>`.
 *
 * Loaded via `next/dynamic` with `ssr: false` by the callers: Leaflet touches
 * `window` at import time and would crash a server render.
 */

export type MapPoint = {
  id: string;
  lat: number;
  lng: number;
  name: string;
  area?: string;
  /** Shown in the marker pill. 0 → a pin glyph instead of a price. */
  price?: number;
  capacity?: number;
  href?: string;
};

export default function ListingMap({
  points,
  /** Single-point maps zoom in; multi-point maps fit their bounds. */
  zoom = 12,
  className,
}: {
  points: MapPoint[];
  zoom?: number;
  className?: string;
}) {
  const { t, locale } = useLocale();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<LeafletMap | null>(null);
  const layerRef = useRef<LayerGroup | null>(null);

  useEffect(() => {
    const el = containerRef.current;
    if (!el || points.length === 0) return;

    let cancelled = false;

    // Dynamic import so Leaflet and its CSS are only fetched by pages that
    // actually show a map, and never during SSR.
    (async () => {
      const L = (await import("leaflet")).default;

      if (cancelled || !containerRef.current) return;

      if (!mapRef.current) {
        mapRef.current = L.map(el, {
          // Page-scroll should not be hijacked into map zoom — a common
          // annoyance when a map sits mid-article.
          scrollWheelZoom: false,
          zoomControl: true,
          attributionControl: true,
        });
        L.tileLayer("https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png", {
          maxZoom: 18,
          attribution: "&copy; OpenStreetMap, &copy; CARTO",
        }).addTo(mapRef.current);
        layerRef.current = L.layerGroup().addTo(mapRef.current);
      }

      const map = mapRef.current;
      const layer = layerRef.current;
      if (!map || !layer) return;

      layer.clearLayers();

      const coords: [number, number][] = [];
      for (const p of points) {
        coords.push([p.lat, p.lng]);

        const label = p.price ? `${arNum(p.price, locale)} ${currencyUnit(locale)}` : "📍";

        // A gold-outlined night pill instead of Leaflet's default blue teardrop,
        // matching the design's marker treatment.
        //
        // `inline-flex`, not `flex`, and the pairing matters: a block-level flex
        // box resolves `width: auto` against its container, and Leaflet's
        // container is the 0×0 box that `iconSize: [0, 0]` asks for — which
        // collapsed the price to an ellipsis on narrow screens. An inline-level
        // box is shrink-to-fit, and `.marker-pill` in globals.css overrides
        // Leaflet's inline `width: 0px` to `max-content` so the parent cannot
        // squeeze it either. Both halves are needed.
        //
        // A `<span>` rather than a `<div>` so the mobile override in globals.css
        // can target it without matching Leaflet's own wrapper.
        const html = `<span style="display:inline-flex;align-items:center;gap:6px;background:var(--night-900,#0C1522);color:var(--gold-100,#F5E9CC);border:1px solid var(--gold-500,#C9A44C);border-radius:999px;padding:5px 11px;font-family:var(--font-tajawal),sans-serif;font-weight:700;font-size:12px;line-height:1.2;white-space:nowrap;box-shadow:0 6px 18px rgba(0,0,0,.35);transform:translate(-50%,-50%)">${escapeHtml(label)}</span>`;

        const marker = L.marker([p.lat, p.lng], {
          icon: L.divIcon({ html, className: "marker-pill", iconSize: [0, 0] }),
          title: p.name,
        }).addTo(layer);

        const detail = [
      p.area,
      p.capacity ? t.common.upToGuests(arNum(p.capacity, locale), p.capacity) : null,
    ]
          .filter(Boolean)
          .join(" · ");

        marker.bindPopup(
          `<div style="direction:rtl;text-align:right;font-family:var(--font-tajawal),sans-serif">
             <b style="font-size:13px">${escapeHtml(p.name)}</b>
             ${detail ? `<br><span style="color:#6E6A60;font-size:12px">${escapeHtml(detail)}</span>` : ""}
             ${
            p.href
              ? `<br><a href="${p.href}" style="font-size:12px;color:#A8873A">${t.listing.viewDetailsArrow}</a>`
              : ""
          }
           </div>`,
        );
      }

      if (coords.length === 1) map.setView(coords[0], zoom);
      else map.fitBounds(coords, { padding: [40, 40] });

      // The container is often sized by a CSS grid that settles after Leaflet
      // measures it; without this the tiles render into a stale viewport.
      setTimeout(() => map.invalidateSize(), 80);
    })();

    return () => {
      cancelled = true;
    };
  }, [points, zoom]);

  // Tear the map down only on unmount, so re-filtering the results list reuses
  // the existing instance instead of rebuilding it.
  useEffect(() => {
    return () => {
      mapRef.current?.remove();
      mapRef.current = null;
      layerRef.current = null;
    };
  }, []);

  return <div ref={containerRef} className={className ?? "size-full"} />;
}

/** Popups are built as HTML strings, so listing names must be escaped. */
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
