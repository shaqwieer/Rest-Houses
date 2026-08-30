"use client";

import { useEffect, useRef } from "react";
import type { Map as LeafletMap, LayerGroup } from "leaflet";
import { arNum, currencyUnit } from "@/lib/format";
import { useLocale } from "@/lib/i18n/provider";
import type { Dictionary, Locale } from "@/lib/i18n";
import { groupByCoord, type CoordGroup } from "@/lib/map-groups";

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
 * themselves. The *footer* and *settings* maps are Google Maps embeds instead,
 * because the client asked for Google Maps for the business location
 * specifically — that's a keyless `<iframe>`.
 *
 * ─── The basemap: OpenStreetMap's own tiles, and why not CARTO ───────────────
 * This used to point at `{s}.basemaps.cartocdn.com/rastertiles/voyager`, whose
 * muted palette sat nicely against the sand/gold design. CARTO has since put
 * that host behind an API key: it keeps answering 200 with a real PNG, so
 * nothing errors and nothing logs — the tiles simply arrive with
 * "API KEY REQUIRED — carto.com/basemaps/apikey" printed diagonally across the
 * map. A silent watermark, in production, on the page where a guest checks
 * where they are going.
 *
 * `tile.openstreetmap.org` is the replacement: keyless, no account, no
 * dependency, and the one basemap this project was already half-attributing.
 * It also labels the UAE in Arabic, which CARTO's English-first style did not.
 *
 * Three details in that URL are load-bearing, and each was a bug waiting to
 * happen if the old URL's shape had simply been retargeted:
 *
 *   * no `{r}` — Leaflet substitutes "@2x" there on a high-DPI screen, which is
 *     a CARTO convention. OSM answers `…/{z}/{x}/{y}@2x.png` with **400**, so
 *     carrying it over would have left the map working on a desktop and blank
 *     on every phone — the one device most guests open a listing on.
 *   * no `{s}` — OSM has deprecated subdomain sharding (a.,b.,c.). HTTP/2
 *     multiplexes over one connection anyway, and the sharded hosts are not a
 *     supported entry point.
 *   * the attribution is a *link* to the copyright page. OSM's licence asks for
 *     the credit to be clickable, and the old string additionally credited
 *     CARTO — who no longer serve any of these tiles.
 *
 * `maxZoom` stays at 18 (OSM serves 19) so the zoom range a visitor gets is
 * exactly the one they had before.
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
        // OpenStreetMap's own standard raster tiles. See the note above for
        // why the URL is spelled exactly like this — no {s}, no {r}.
        L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
          maxZoom: 18,
          attribution:
            '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap</a> contributors',
        }).addTo(mapRef.current);
        layerRef.current = L.layerGroup().addTo(mapRef.current);
      }

      const map = mapRef.current;
      const layer = layerRef.current;
      if (!map || !layer) return;

      layer.clearLayers();

      // One marker per *spot*, not per listing. Rest houses that share a
      // compound are registered at the same coordinates, and stacked markers
      // hide one another completely at every zoom level — see map-groups.ts.
      const groups = groupByCoord(points);
      const coords: [number, number][] = groups.map((g) => [g.lat, g.lng]);

      for (const g of groups) {
        const marker = L.marker([g.lat, g.lng], {
          icon: L.divIcon({
            html: pillHtml(g, t, locale),
            className: "marker-pill",
            iconSize: [0, 0],
          }),
          title:
            g.points.length > 1
              ? t.listing.sameSpot(arNum(g.points.length, locale), g.points.length)
              : g.points[0].name,
        }).addTo(layer);

        marker.bindPopup(popupHtml(g, t, locale));
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
  }, [points, zoom, t, locale]);

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

/**
 * The marker: a gold-outlined night pill instead of Leaflet's default blue
 * teardrop, matching the design's marker treatment. A shared spot shows the
 * cheapest of its rest houses plus a count badge, so three of them never look
 * like one.
 *
 * `inline-flex`, not `flex`, and the pairing matters: a block-level flex box
 * resolves `width: auto` against its container, and Leaflet's container is the
 * 0×0 box that `iconSize: [0, 0]` asks for — which collapsed the price to an
 * ellipsis on narrow screens. An inline-level box is shrink-to-fit, and
 * `.marker-pill` in globals.css overrides Leaflet's inline `width: 0px` to
 * `max-content` so the parent cannot squeeze it either. Both halves are needed.
 *
 * A `<span>` rather than a `<div>` so the mobile override in globals.css can
 * target it without matching Leaflet's own wrapper.
 */
function pillHtml(g: CoordGroup<MapPoint>, t: Dictionary, locale: Locale): string {
  const prices = g.points
    .map((p) => p.price)
    .filter((n): n is number => typeof n === "number" && n > 0);
  const cheapest = prices.length > 0 ? Math.min(...prices) : 0;
  const money = cheapest ? `${arNum(cheapest, locale)} ${currencyUnit(locale)}` : "";

  // "from 1,500" only when the members are not all the same price — otherwise
  // the bare figure is exact, and shorter on a phone.
  const label = money
    ? prices.some((n) => n !== cheapest)
      ? t.listing.priceFrom(money)
      : money
    : "📍";

  const badge =
    g.points.length > 1
      ? `<span style="display:inline-flex;align-items:center;justify-content:center;min-width:17px;height:17px;padding:0 4px;border-radius:999px;background:var(--gold-500,#C9A44C);color:var(--night-900,#0C1522);font-size:10.5px;font-weight:800;line-height:1">${escapeHtml(arNum(g.points.length, locale))}</span>`
      : "";

  return `<span style="display:inline-flex;align-items:center;gap:6px;background:var(--night-900,#0C1522);color:var(--gold-100,#F5E9CC);border:1px solid var(--gold-500,#C9A44C);border-radius:999px;padding:5px 11px;font-family:var(--font-tajawal),sans-serif;font-weight:700;font-size:12px;line-height:1.2;white-space:nowrap;box-shadow:0 6px 18px rgba(0,0,0,.35);transform:translate(-50%,-50%)">${badge}${escapeHtml(label)}</span>`;
}

/**
 * The popup. For one listing it is the name, its area and a link; for a shared
 * spot it is the whole list — and that list is the only place the second and
 * third rest house at a coordinate can be told apart, so every row carries its
 * own price too.
 */
function popupHtml(g: CoordGroup<MapPoint>, t: Dictionary, locale: Locale): string {
  const rtl = locale === "ar";
  const open = `<div style="direction:${rtl ? "rtl" : "ltr"};text-align:${rtl ? "right" : "left"};font-family:var(--font-tajawal),sans-serif">`;

  // The pill beside it already carries the price, so a lone row omits it.
  if (g.points.length === 1) return `${open}${entryHtml(g.points[0], t, locale, false)}</div>`;

  const rows = g.points
    .map(
      (p) =>
        `<li style="border-top:1px solid #EFE7D8;padding:8px 0">${entryHtml(p, t, locale, true)}</li>`,
    )
    .join("");

  return `${open}
       <b style="font-size:13px">${escapeHtml(t.listing.sameSpot(arNum(g.points.length, locale), g.points.length))}</b>
       <ul style="list-style:none;margin:2px 0 0;padding:0;max-height:222px;overflow-y:auto">${rows}</ul>
     </div>`;
}

/** One rest house inside a popup. */
function entryHtml(p: MapPoint, t: Dictionary, locale: Locale, withPrice: boolean): string {
  const detail = [
    p.area,
    p.capacity ? t.common.upToGuests(arNum(p.capacity, locale), p.capacity) : null,
  ]
    .filter(Boolean)
    .join(" · ");

  const price = withPrice && p.price ? `${arNum(p.price, locale)} ${currencyUnit(locale)}` : "";
  const link = p.href
    ? `<a href="${escapeHtml(p.href)}" style="font-size:12px;color:#A8873A">${t.listing.viewDetailsArrow}</a>`
    : "";

  return `<b style="font-size:13px">${escapeHtml(p.name)}</b>
     ${detail ? `<br><span style="color:#6E6A60;font-size:12px">${escapeHtml(detail)}</span>` : ""}
     ${
       price || link
         ? `<br>${price ? `<span style="font-size:12px;font-weight:700;color:#0C1522">${escapeHtml(price)}</span>` : ""}${price && link ? " · " : ""}${link}`
         : ""
     }`;
}

/** Popups are built as HTML strings, so listing names must be escaped. */
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
