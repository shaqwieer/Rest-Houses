import { describe, expect, it } from "vitest";
import { ARCHIVE_PAGE_SIZE, pageFromParam } from "@/components/admin/pager";

/**
 * The closed-booking archive is paged, and `?page=` comes from the URL — which
 * means it comes from anybody.
 *
 * The failure this guards is not a crash. An out-of-range page produces a
 * perfectly valid query with a `skip` past the end of the table, so Prisma
 * returns [] and the page renders its "no requests yet" empty state. An
 * operator who mistypes a URL, or follows a stale bookmark to page 9 of an
 * archive that has since shrunk to two pages, is told their bookings are gone.
 * Clamping happens BEFORE the query for exactly that reason.
 */
describe("pageFromParam", () => {
  const TOTAL = 3;

  it("passes a page that is in range straight through", () => {
    expect(pageFromParam("1", TOTAL)).toBe(1);
    expect(pageFromParam("2", TOTAL)).toBe(2);
    expect(pageFromParam("3", TOTAL)).toBe(3);
  });

  it("clamps past the end to the last real page, never past it", () => {
    expect(pageFromParam("4", TOTAL)).toBe(TOTAL);
    expect(pageFromParam("9999", TOTAL)).toBe(TOTAL);
  });

  it("clamps zero and negatives to the first page", () => {
    expect(pageFromParam("0", TOTAL)).toBe(1);
    expect(pageFromParam("-3", TOTAL)).toBe(1);
  });

  /** Missing, junk, and the array form Next hands over for a repeated key. */
  it("falls back to the first page for anything that is not a number", () => {
    expect(pageFromParam(undefined, TOTAL)).toBe(1);
    expect(pageFromParam("", TOTAL)).toBe(1);
    expect(pageFromParam("abc", TOTAL)).toBe(1);
    expect(pageFromParam("2; DROP TABLE", TOTAL)).toBe(1);
    expect(pageFromParam(["2", "5"], TOTAL)).toBe(2);
  });

  it("floors a fractional page rather than passing it to skip", () => {
    // `skip: (1.7 - 1) * 24` is 16.8, which Prisma rejects outright.
    expect(pageFromParam("1.7", TOTAL)).toBe(1);
    expect(pageFromParam("2.9", TOTAL)).toBe(2);
  });

  /**
   * An empty archive still has one page. Returning 0 would make the pager's
   * "page 1 of 0" read as broken, and `skip: -24` throws.
   */
  it("keeps page 1 valid when there is nothing to page through", () => {
    expect(pageFromParam("1", 0)).toBe(1);
    expect(pageFromParam("5", 0)).toBe(1);
    expect(pageFromParam(undefined, 1)).toBe(1);
  });

  it("pages in whole grid rows", () => {
    // Two columns on a laptop, so an even count keeps the last row from
    // straggling more often than not.
    expect(ARCHIVE_PAGE_SIZE % 2).toBe(0);
  });
});
