/**
 * Google Maps deep links.
 *
 * The embedded map on a listing page answers "where is it" but not "how far is
 * it from me", which is the question a guest actually has before booking. These
 * two URLs hand that question to Google Maps — which on a phone means the Maps
 * *app*, with the distance and the drive time already on screen.
 *
 * ─── Why `?api=1` and not the `maps?q=…` spelling ────────────────────────────
 * The other Google Maps URL in this codebase (admin/settings-form.tsx) is
 * `maps?q=<lat>,<lng>&output=embed`. That is the **iframe** form: it is meant
 * for a `src=` attribute and renders a bare embed. Reusing it for a link is a
 * silent downgrade — no app hand-off, no Directions button. `?api=1` is
 * Google's documented, versioned URL API and is the supported way to link.
 *
 * ─── Why coordinates are formatted here rather than interpolated by callers ──
 * Every user-facing number in this project goes through `arNum`, which renders
 * Arabic-Indic digits (١٢٣). A coordinate that took that path would produce a
 * URL Google cannot parse, and the failure is invisible at review time because
 * the digits look correct in the JSX. Funnelling both links through this module
 * keeps the raw `toString()` in one place with the reason attached.
 *
 * Pure and free of React, Leaflet and Next, so both callers can use it: the
 * server-rendered listing page and listing-map.tsx, whose Leaflet import makes
 * the module itself unloadable in a test environment.
 */

/** A coordinate pair, as stored on a listing. */
type LatLng = { lat: number; lng: number };

/**
 * Drops a pin at the coordinates and opens the Maps app on a phone.
 *
 * The gentler of the two: the guest lands looking at the spot and can decide
 * for themselves whether to ask for directions, rather than being pushed into
 * a navigation UI they did not request.
 */
export function googleMapsSearchUrl({ lat, lng }: LatLng): string {
  return `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`;
}

/**
 * Opens directions *to* the rest house, with the guest's own position as the
 * origin — Google fills that in itself, so no permission prompt from us and no
 * location ever reaches this server.
 */
export function googleMapsDirectionsUrl({ lat, lng }: LatLng): string {
  return `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`;
}
