import { describe, expect, it } from "vitest";
import { groupByCoord } from "@/lib/map-groups";

/**
 * Three rest houses share the "Rose" compound and three more share "ماربيلا",
 * each trio registered at one coordinate. On the results map that made two of
 * every three vanish: Leaflet drew their markers on the same pixel, so only the
 * last one was visible and clickable, and zooming in never pulled them apart
 * because the coordinates are identical rather than merely close.
 *
 * Everything the map does about that — the count badge, the list popup, the
 * bounds it fits — follows from this grouping, so the grouping is what is
 * pinned down here.
 */
describe("groupByCoord", () => {
  const rose = (id: string) => ({ id, lat: 24.79331, lng: 56.02114 });

  it("folds listings at one coordinate into a single group", () => {
    const groups = groupByCoord([rose("a"), rose("b"), rose("c")]);

    expect(groups).toHaveLength(1);
    expect(groups[0].points.map((p) => p.id)).toEqual(["a", "b", "c"]);
    expect(groups[0].lat).toBe(24.79331);
    expect(groups[0].lng).toBe(56.02114);
  });

  it("keeps rest houses at different coordinates apart", () => {
    const groups = groupByCoord([
      rose("a"),
      { id: "masfut", lat: 24.8081, lng: 56.0552 },
      rose("b"),
    ]);

    expect(groups).toHaveLength(2);
    expect(groups.map((g) => g.points.length)).toEqual([2, 1]);
  });

  /** Two compounds a hundred metres apart are two places, not one. */
  it("does not merely round everything to the same town", () => {
    const groups = groupByCoord([
      { id: "a", lat: 24.7933, lng: 56.0211 },
      { id: "b", lat: 24.7942, lng: 56.0211 },
    ]);

    expect(groups).toHaveLength(2);
  });

  /**
   * A coordinate that survived a float round-trip — a JSON payload, a Prisma
   * `Float` column — can come back a few billionths off. That is the same spot
   * to anyone standing on it, and must not split the group.
   */
  it("tolerates float noise below a metre", () => {
    const groups = groupByCoord([
      { id: "a", lat: 24.793310000000002, lng: 56.02114 },
      { id: "b", lat: 24.7933099999999, lng: 56.021140000000004 },
    ]);

    expect(groups).toHaveLength(1);
  });

  /** The real trios: Hatta and العين, three listings on each coordinate. */
  it("holds up on the shape the live site actually has", () => {
    const groups = groupByCoord([
      { id: "jasmin", lat: 24.853643, lng: 56.00674 },
      { id: "marbella-3", lat: 23.978674, lng: 55.528588 },
      { id: "jory", lat: 24.853643, lng: 56.00674 },
      { id: "marbella-1", lat: 23.978674, lng: 55.528588 },
      { id: "marbella-2", lat: 23.978674, lng: 55.528588 },
      { id: "rose", lat: 24.853643, lng: 56.00674 },
    ]);

    expect(groups.map((g) => g.points.map((p) => p.id))).toEqual([
      ["jasmin", "jory", "rose"],
      ["marbella-3", "marbella-1", "marbella-2"],
    ]);
  });

  it("returns nothing for no points", () => {
    expect(groupByCoord([])).toEqual([]);
  });
});
