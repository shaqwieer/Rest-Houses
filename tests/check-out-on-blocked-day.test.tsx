import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import {
  AvailabilityCalendar,
  canCheckOutOn,
  nextRange,
  type DateRange,
} from "@/components/listing/availability-calendar";
import { ar } from "@/lib/i18n/ar";
import { addDays, todayISO } from "@/lib/dates";

/**
 * Reported on F20: the owner blocks the 14th, meaning the night of the 14th
 * (check-in 14, check-out 15). A guest then tries to stay the 13th and leave
 * on the morning of the 14th, and cannot. The night they want is free.
 *
 * The server always accepted that stay. `isRangeAvailable` walks
 * `nightsInRange`, and the check-out day is not a night. Only the calendar
 * refused it: every closed day's cell was disabled, so the 14th could not be
 * clicked even as a check-out.
 */

const DAY_13 = "2026-11-13";
const DAY_14 = "2026-11-14";
const blocked14 = new Set([DAY_14]);

describe("canCheckOutOn", () => {
  it("lets a stay end on a blocked day when the night before it is free", () => {
    expect(canCheckOutOn(DAY_13, DAY_14, blocked14)).toBe(true);
    expect(canCheckOutOn("2026-11-12", DAY_14, blocked14)).toBe(true);
  });

  it("refuses a stay that would sleep through a blocked night", () => {
    const blocked13and14 = new Set(["2026-11-13", DAY_14]);
    expect(canCheckOutOn("2026-11-12", DAY_14, blocked13and14)).toBe(false);
    // ...but the same stay can still end on the 13th.
    expect(canCheckOutOn("2026-11-12", "2026-11-13", blocked13and14)).toBe(true);
    expect(canCheckOutOn(DAY_13, "2026-11-15", blocked14)).toBe(false);
  });

  it("refuses a check-out on or before the check-in", () => {
    expect(canCheckOutOn(DAY_14, DAY_14, new Set())).toBe(false);
    expect(canCheckOutOn(DAY_14, DAY_13, new Set())).toBe(false);
  });
});

describe("nextRange — a tap on the calendar", () => {
  const none: DateRange = { checkIn: null, checkOut: null };

  it("completes 13 → 14 when the 14th is blocked", () => {
    expect(nextRange({ checkIn: DAY_13, checkOut: null }, DAY_14, blocked14)).toEqual({
      checkIn: DAY_13,
      checkOut: DAY_14,
    });
  });

  it("never starts a stay on a blocked day", () => {
    // Nothing picked yet.
    expect(nextRange(none, DAY_14, blocked14)).toBeNull();
    // Picking backwards would otherwise restart on the blocked day.
    expect(nextRange({ checkIn: "2026-11-20", checkOut: null }, DAY_14, blocked14)).toBeNull();
  });

  it("ignores a second tap on a blocked check-out once the range is complete", () => {
    // Without the guard this fell into "complete range → start over" and made
    // the closed 14th the new check-in.
    const complete: DateRange = { checkIn: DAY_13, checkOut: DAY_14 };
    expect(nextRange(complete, DAY_14, blocked14)).toEqual(complete);
  });

  it("does not let a stay jump over the blocked night", () => {
    // 13 → 15 sleeps through the 14th: restart from the 15th instead.
    expect(nextRange({ checkIn: DAY_13, checkOut: null }, "2026-11-15", blocked14)).toEqual({
      checkIn: "2026-11-15",
      checkOut: null,
    });
  });

  it("keeps the ordinary rules for open days", () => {
    expect(nextRange(none, DAY_13, blocked14)).toEqual({ checkIn: DAY_13, checkOut: null });
    expect(nextRange({ checkIn: DAY_13, checkOut: null }, "2026-11-11", blocked14)).toEqual({
      checkIn: "2026-11-11",
      checkOut: null,
    });
    expect(
      nextRange({ checkIn: "2026-11-10", checkOut: "2026-11-12" }, DAY_13, blocked14),
    ).toEqual({ checkIn: DAY_13, checkOut: null });
  });
});

describe("the calendar renders the blocked day as a check-out", () => {
  // Relative to today, so the cells are never in the past.
  const checkIn = addDays(todayISO(), 10);
  const closed = addDays(checkIn, 1);
  const dayNumber = Number(closed.slice(8));

  /** The <button …> opening tag for the closed day's cell. */
  function closedCell(value: DateRange, singleDay = false): string {
    const html = renderToStaticMarkup(
      <AvailabilityCalendar
        unavailableDates={[closed]}
        value={value}
        onChange={() => {}}
        months={2}
        singleDay={singleDay}
      />,
    );
    const tag = html.match(new RegExp(`<button[^>]*aria-label="${dayNumber} — [^"]*"[^>]*>`));
    expect(tag).not.toBeNull();
    return tag![0];
  }

  it("is enabled and labelled check-out only while a check-out is being picked", () => {
    const tag = closedCell({ checkIn, checkOut: null });
    expect(tag).toContain(ar.listing.checkOutOnly);
    expect(tag).not.toMatch(/\sdisabled=""/);
  });

  it("stays enabled as the chosen check-out", () => {
    const tag = closedCell({ checkIn, checkOut: closed });
    expect(tag).toContain(ar.listing.checkOutOnly);
    expect(tag).not.toMatch(/\sdisabled=""/);
  });

  it("is still booked and disabled with no check-in picked", () => {
    const tag = closedCell({ checkIn: null, checkOut: null });
    expect(tag).toContain(ar.listing.dayBooked);
    expect(tag).toMatch(/\sdisabled=""/);
  });

  it("is still booked and disabled for a day booking", () => {
    // A day booking occupies the day itself; a closed day is closed.
    // A half-picked value with `singleDay` on isolates the `!singleDay` guard.
    const tag = closedCell({ checkIn, checkOut: null }, true);
    expect(tag).toMatch(/\sdisabled=""/);
  });
});
