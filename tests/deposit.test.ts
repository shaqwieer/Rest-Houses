import { describe, expect, it } from "vitest";
import {
  clampPercent,
  isValidDepositPercent,
  quote,
  resolveDepositPercent,
  type QuoteInput,
} from "@/lib/pricing";

/**
 * Deposit resolution and rounding.
 *
 * The rounding cases here are the ones that produce an off-by-one dirham on a
 * receipt, which is exactly the class of bug a customer notices and an owner
 * has to argue about.
 */

describe("resolveDepositPercent", () => {
  it("uses the listing's own rate when it has one", () => {
    expect(resolveDepositPercent(50, 30)).toBe(50);
  });

  it("falls back to the platform default when the listing has none", () => {
    expect(resolveDepositPercent(null, 30)).toBe(30);
    expect(resolveDepositPercent(undefined, 30)).toBe(30);
  });

  /**
   * The distinction the whole nullable column exists for. A truthiness check
   * (`listing.depositPercent || platformDefault`) would collapse these two into
   * one and silently charge 30% on a listing whose owner set 0%.
   */
  it("treats an explicit 0 as 'no deposit', NOT as 'unset'", () => {
    expect(resolveDepositPercent(0, 30)).toBe(0);
    expect(resolveDepositPercent(null, 30)).toBe(30);
  });

  it("clamps a value that somehow bypassed validation", () => {
    expect(resolveDepositPercent(150, 30)).toBe(100);
    expect(resolveDepositPercent(-20, 30)).toBe(0);
    expect(resolveDepositPercent(Number.NaN, 30)).toBe(30);
    expect(resolveDepositPercent(Infinity, 30)).toBe(30);
  });
});

describe("deposit percentage validation", () => {
  it("accepts the whole valid range", () => {
    for (const v of [0, 1, 25, 30, 50, 99, 100]) {
      expect(isValidDepositPercent(v)).toBe(true);
    }
  });

  it("rejects out-of-range, fractional and non-numeric values", () => {
    for (const v of [-1, 101, 1000, 12.5, "30", null, undefined, Number.NaN, Infinity]) {
      expect(isValidDepositPercent(v)).toBe(false);
    }
  });

  it("clamps rather than throwing", () => {
    expect(clampPercent(-5)).toBe(0);
    expect(clampPercent(140)).toBe(100);
    expect(clampPercent(30.4)).toBe(30);
    expect(clampPercent(30.6)).toBe(31);
  });
});

describe("quote()", () => {
  // Mon 27 → Wed 29 July 2026: two weekday nights, no weekend uplift.
  const twoWeekdayNights = {
    checkIn: "2026-07-27",
    checkOut: "2026-07-29",
    pricePerNight: 1800,
    weekendPrice: 2300,
    weekendMode: "short",
    serviceFeePercent: 5,
  } satisfies Partial<QuoteInput>;

  it("computes subtotal, fee and total", () => {
    const q = quote({ ...twoWeekdayNights, depositPercent: 30 });
    expect(q.nights).toBe(2);
    expect(q.subtotal).toBe(3600);
    expect(q.serviceFee).toBe(180);
    expect(q.total).toBe(3780);
  });

  /**
   * The deposit is a share of the TOTAL, fee included — not of the subtotal.
   * 30% of 3780 is 1134; 30% of the 3600 subtotal would be 1080. Getting this
   * wrong under-charges every booking by the fee's share.
   */
  it("takes the deposit from the total, not the subtotal", () => {
    const q = quote({ ...twoWeekdayNights, depositPercent: 30 });
    expect(q.depositDue).toBe(1134);
    expect(q.depositDue).not.toBe(1080);
  });

  it("returns the rate that produced the amount, for the snapshot", () => {
    const q = quote({ ...twoWeekdayNights, depositPercent: 25 });
    expect(q.depositPercent).toBe(25);
    expect(q.depositDue).toBe(945); // 25% of 3780
  });

  it("charges nothing at 0% and the whole total at 100%", () => {
    expect(quote({ ...twoWeekdayNights, depositPercent: 0 }).depositDue).toBe(0);
    const full = quote({ ...twoWeekdayNights, depositPercent: 100 });
    expect(full.depositDue).toBe(full.total);
  });

  it("clamps an out-of-range percentage instead of producing a nonsense amount", () => {
    const over = quote({ ...twoWeekdayNights, depositPercent: 250 });
    expect(over.depositPercent).toBe(100);
    expect(over.depositDue).toBe(over.total);

    const under = quote({ ...twoWeekdayNights, depositPercent: -10 });
    expect(under.depositPercent).toBe(0);
    expect(under.depositDue).toBe(0);
  });

  describe("rounding", () => {
    /**
     * A total of 1001 at 50% is exactly 500.5 — the half-way case. `Math.round`
     * goes up, matching the service-fee rounding on the line above it, so the
     * two figures on a receipt round the same direction.
     */
    it("rounds a .5 boundary up, consistently with the service fee", () => {
      const q = quote({
        checkIn: "2026-07-27",
        checkOut: "2026-07-28",
        pricePerNight: 953,
        weekendPrice: 0,
        weekendMode: "short",
        serviceFeePercent: 5,
        depositPercent: 50,
      });
      // 953 + round(47.65)=48 → total 1001; 50% of 1001 = 500.5 → 501
      expect(q.serviceFee).toBe(48);
      expect(q.total).toBe(1001);
      expect(q.depositDue).toBe(501);
    });

    it("never returns a fractional dirham", () => {
      for (const price of [333, 777, 1001, 1234, 9999]) {
        for (const pct of [7, 13, 33, 66, 99]) {
          const q = quote({
            checkIn: "2026-07-27",
            checkOut: "2026-07-30",
            pricePerNight: price,
            weekendPrice: 0,
            weekendMode: "short",
            serviceFeePercent: 5,
            depositPercent: pct,
          });
          expect(Number.isInteger(q.depositDue)).toBe(true);
          expect(Number.isInteger(q.serviceFee)).toBe(true);
          expect(Number.isInteger(q.total)).toBe(true);
        }
      }
    });

    it("never exceeds the total", () => {
      for (const pct of [0, 1, 50, 99, 100]) {
        const q = quote({ ...twoWeekdayNights, depositPercent: pct });
        expect(q.depositDue).toBeGreaterThanOrEqual(0);
        expect(q.depositDue).toBeLessThanOrEqual(q.total);
      }
    });
  });

  describe("interaction with existing pricing rules", () => {
    it("applies the weekend rate before the deposit is taken", () => {
      // Thu 30 + Fri 31 (both weekdays on the UAE weekend) + Sat 01 (weekend)
      // = 1800 + 1800 + 2300
      const q = quote({
        checkIn: "2026-07-30",
        checkOut: "2026-08-02",
        pricePerNight: 1800,
        weekendPrice: 2300,
        weekendMode: "short",
        serviceFeePercent: 5,
        depositPercent: 30,
      });
      expect(q.subtotal).toBe(5900);
      expect(q.serviceFee).toBe(295);
      expect(q.total).toBe(6195);
      expect(q.depositDue).toBe(1859); // 30% of 6195 = 1858.5, rounded up
    });

    /**
     * The same three nights on a Sharjah listing. Friday is a day off there, so
     * it carries the uplift and the deposit rises with it — the deposit is a
     * share of the total, so the weekend setting reaches all the way through.
     */
    it("charges Friday at the weekend rate on a long-weekend listing", () => {
      const q = quote({
        checkIn: "2026-07-30",
        checkOut: "2026-08-02",
        pricePerNight: 1800,
        weekendPrice: 2300,
        weekendMode: "long",
        serviceFeePercent: 5,
        depositPercent: 30,
      });
      expect(q.subtotal).toBe(6400);
      expect(q.serviceFee).toBe(320);
      expect(q.total).toBe(6720);
      expect(q.depositDue).toBe(2016); // 30% of 6720
    });

    it("still works when the service fee is zero", () => {
      const q = quote({ ...twoWeekdayNights, serviceFeePercent: 0, depositPercent: 30 });
      expect(q.serviceFee).toBe(0);
      expect(q.total).toBe(3600);
      expect(q.depositDue).toBe(1080);
    });

    it("treats a zero weekend price as 'same as weekday'", () => {
      const q = quote({
        checkIn: "2026-08-01", // a Saturday — a weekend night on both modes
        checkOut: "2026-08-02",
        pricePerNight: 1000,
        weekendPrice: 0,
        weekendMode: "short",
        serviceFeePercent: 5,
        depositPercent: 30,
      });
      expect(q.subtotal).toBe(1000);
    });
  });
});
