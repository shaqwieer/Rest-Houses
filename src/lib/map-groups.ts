/**
 * Co-located map points, folded into one marker each.
 *
 * Several rest houses on the site share a compound — three under "Rose", three
 * under "ماربيلا" — and were registered at *the same* coordinates. Leaflet
 * happily stacks their markers pixel-on-pixel, so only the one drawn last is
 * visible or clickable and the other two are simply gone from the map. Zooming
 * never separates them: the points are identical, not merely close. The marker
 * itself therefore has to carry the count, and its popup has to list every
 * member — that is the only path to the hidden ones.
 *
 * Kept here rather than in listing-map.tsx because that module imports Leaflet
 * and its stylesheet at module scope, which neither the test environment nor a
 * server render can load. This half is pure, so it can be tested directly.
 */

/**
 * Coordinates are matched to five decimals — about a metre.
 *
 * Tighter than that and float noise splits a group that a human entered as one
 * place; looser and genuinely separate neighbours get merged. Note this is a
 * grid, not a radius: two points a hand's width apart but on opposite sides of
 * a cell boundary stay separate. That is fine for the case this exists for,
 * where the coordinates are byte-identical copies of one another.
 */
const PRECISION = 5;

export type CoordGroup<T> = {
  /** The first member's exact position; the marker is anchored here. */
  lat: number;
  lng: number;
  /** Always at least one, in the order the caller supplied. */
  points: T[];
};

/** Groups points that sit on the same spot, preserving input order. */
export function groupByCoord<T extends { lat: number; lng: number }>(
  points: readonly T[],
): CoordGroup<T>[] {
  const groups = new Map<string, CoordGroup<T>>();

  for (const p of points) {
    const key = `${p.lat.toFixed(PRECISION)},${p.lng.toFixed(PRECISION)}`;
    const group = groups.get(key);
    if (group) group.points.push(p);
    else groups.set(key, { lat: p.lat, lng: p.lng, points: [p] });
  }

  return [...groups.values()];
}
