"use client";

import { createContext, useCallback, useContext, useMemo, useState } from "react";
import type { DateRange } from "./availability-calendar";
import { quote, type Quote } from "@/lib/pricing";
import type { ISODate, WeekendMode } from "@/lib/dates";

/**
 * Shared booking selection for the listing detail page.
 *
 * The calendar sits in the main column while the price card sits in the sticky
 * sidebar, so they need one source of truth for the selected range and guest
 * count. A context provider keeps that state in the browser without forcing the
 * *rest* of the page — description, amenities, reviews, structured data — to
 * become client components: server-rendered content passes straight through as
 * `children`.
 *
 * The quote is derived here rather than in either consumer, so the total in the
 * sidebar and the total carried into the booking form can't disagree.
 *
 * ─── Two kinds of stay ───────────────────────────────────────────────────────
 * `stayType` is the mode the whole page runs in:
 *
 *   "overnight" — the original behaviour. Two clicks on the calendar pick a
 *                 check-in and a check-out, and the quote is per night.
 *   "dayUse"    — حجز بدون مبيت. ONE click picks the day; check-in and check-out
 *                 are the same date, there are no nights, and the quote comes
 *                 from the listing's day rate.
 *
 * Holding it here rather than on the calendar is what lets the price card, the
 * mobile bar and the link into the booking form all agree about which kind of
 * booking is being made — they read one flag instead of each inferring it from
 * whether the two dates happen to be equal, which is also what an incomplete
 * overnight selection looks like.
 *
 * The mode is only offered when the listing actually has a day rate;
 * `dayUseAvailable` carries that decision down from the server so no component
 * has to re-derive "is 0 the same as not offered" (it is — see
 * `Listing.dayUsePrice` in prisma/schema.prisma).
 */

export type StayType = "overnight" | "dayUse";

type BookingContextValue = {
  range: DateRange;
  setRange: (r: DateRange) => void;
  stayType: StayType;
  setStayType: (t: StayType) => void;
  /** False when this listing has no day rate — the toggle is not rendered. */
  dayUseAvailable: boolean;
  guests: number;
  setGuests: (n: number) => void;
  /** null until the selection is complete for the current stay type. */
  currentQuote: Quote | null;
  unavailableDates: ISODate[];
  /** Query string for the booking page, e.g. "?from=…&to=…&guests=30". */
  bookingQuery: string;
  /** True once the selection is enough to send a request. */
  ready: boolean;
  /**
   * The listing's weekend, passed down so the calendar shades the same days the
   * quote charges the weekend rate for. Held here rather than threaded through
   * `BookingCard` into `AvailabilityCalendar` by hand, because the calendar is
   * two components below the only place that knows it.
   */
  weekendMode: WeekendMode;
};

const BookingContext = createContext<BookingContextValue | null>(null);

export function BookingProvider({
  unavailableDates,
  pricePerNight,
  weekendPrice,
  weekendMode,
  dayUsePrice,
  dayUseWeekendPrice,
  serviceFeePercent,
  depositPercent,
  capacity,
  children,
}: {
  unavailableDates: ISODate[];
  pricePerNight: number;
  weekendPrice: number;
  weekendMode: WeekendMode;
  dayUsePrice: number;
  dayUseWeekendPrice: number;
  serviceFeePercent: number;
  depositPercent: number;
  capacity: number;
  children: React.ReactNode;
}) {
  const [range, setRangeState] = useState<DateRange>({ checkIn: null, checkOut: null });
  const [stayType, setStayTypeState] = useState<StayType>("overnight");
  // Default to a sensible share of the venue rather than 1 — these are group
  // venues, and the design's mock shows "٣٠ ضيفًا" pre-filled.
  const [guests, setGuests] = useState(() =>
    Math.min(capacity, Math.max(1, Math.round(capacity / 2))),
  );

  const dayUseAvailable = dayUsePrice > 0;

  const setStayType = useCallback((next: StayType) => {
    setStayTypeState(next);
    // Switching mode clears the dates. A range picked as an overnight stay
    // ("the 4th to the 7th") is not a day booking, and silently reinterpreting
    // it as "the 4th" would quietly change what the guest asked for while the
    // price on screen changed under them. Starting over is one extra tap and
    // leaves no room for that.
    setRangeState({ checkIn: null, checkOut: null });
  }, []);

  const isDayUse = stayType === "dayUse";

  const setRange = useCallback(
    (next: DateRange) => {
      // In day-use mode a single click is the whole selection, so check-out is
      // pinned to check-in here — one place, rather than trusting every caller
      // to remember. That equality is exactly what the server then requires.
      if (isDayUse) {
        setRangeState({ checkIn: next.checkIn, checkOut: next.checkIn });
        return;
      }
      setRangeState(next);
    },
    [isDayUse],
  );

  const ready = isDayUse
    ? Boolean(range.checkIn)
    : Boolean(range.checkIn && range.checkOut);

  const currentQuote = useMemo(() => {
    if (!range.checkIn) return null;
    if (!isDayUse && !range.checkOut) return null;

    return quote({
      checkIn: range.checkIn,
      // Same day on the day-use path, which is what `quote` prices from.
      checkOut: isDayUse ? range.checkIn : range.checkOut!,
      pricePerNight,
      weekendPrice,
      weekendMode,
      serviceFeePercent,
      depositPercent,
      dayUse: isDayUse,
      dayUsePrice,
      dayUseWeekendPrice,
    });
  }, [
    range,
    isDayUse,
    pricePerNight,
    weekendPrice,
    weekendMode,
    dayUsePrice,
    dayUseWeekendPrice,
    serviceFeePercent,
    depositPercent,
  ]);

  const bookingQuery = useMemo(() => {
    const p = new URLSearchParams();
    if (range.checkIn) p.set("from", range.checkIn);
    // Always sent, and equal to `from` for a day booking — the booking page
    // reads both and re-derives nothing.
    if (isDayUse ? range.checkIn : range.checkOut) {
      p.set("to", isDayUse ? range.checkIn! : range.checkOut!);
    }
    if (isDayUse) p.set("dayUse", "1");
    p.set("guests", String(guests));
    return `?${p.toString()}`;
  }, [range, guests, isDayUse]);

  const value = useMemo<BookingContextValue>(
    () => ({
      range,
      setRange,
      stayType,
      setStayType,
      dayUseAvailable,
      guests,
      setGuests: (n) => setGuests(Math.min(Math.max(1, n), capacity)),
      currentQuote,
      unavailableDates,
      bookingQuery,
      ready,
      weekendMode,
    }),
    [
      range,
      setRange,
      stayType,
      setStayType,
      dayUseAvailable,
      guests,
      currentQuote,
      unavailableDates,
      bookingQuery,
      ready,
      capacity,
      weekendMode,
    ],
  );

  return <BookingContext.Provider value={value}>{children}</BookingContext.Provider>;
}

export function useBooking(): BookingContextValue {
  const ctx = useContext(BookingContext);
  if (!ctx) throw new Error("useBooking must be used inside <BookingProvider>");
  return ctx;
}
