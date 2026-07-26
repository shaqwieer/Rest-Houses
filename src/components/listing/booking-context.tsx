"use client";

import { createContext, useContext, useMemo, useState } from "react";
import type { DateRange } from "./availability-calendar";
import { quote, type Quote } from "@/lib/pricing";
import type { ISODate } from "@/lib/dates";

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
 */

type BookingContextValue = {
  range: DateRange;
  setRange: (r: DateRange) => void;
  guests: number;
  setGuests: (n: number) => void;
  /** null until a full range is selected. */
  currentQuote: Quote | null;
  unavailableDates: ISODate[];
  /** Query string for the booking page, e.g. "?from=…&to=…&guests=30". */
  bookingQuery: string;
};

const BookingContext = createContext<BookingContextValue | null>(null);

export function BookingProvider({
  unavailableDates,
  pricePerNight,
  weekendPrice,
  serviceFeePercent,
  depositPercent,
  capacity,
  children,
}: {
  unavailableDates: ISODate[];
  pricePerNight: number;
  weekendPrice: number;
  serviceFeePercent: number;
  depositPercent: number;
  capacity: number;
  children: React.ReactNode;
}) {
  const [range, setRange] = useState<DateRange>({ checkIn: null, checkOut: null });
  // Default to a sensible share of the venue rather than 1 — these are group
  // venues, and the design's mock shows "٣٠ ضيفًا" pre-filled.
  const [guests, setGuests] = useState(() => Math.min(capacity, Math.max(1, Math.round(capacity / 2))));

  const currentQuote = useMemo(() => {
    if (!range.checkIn || !range.checkOut) return null;
    return quote({
      checkIn: range.checkIn,
      checkOut: range.checkOut,
      pricePerNight,
      weekendPrice,
      serviceFeePercent,
      depositPercent,
    });
  }, [range, pricePerNight, weekendPrice, serviceFeePercent, depositPercent]);

  const bookingQuery = useMemo(() => {
    const p = new URLSearchParams();
    if (range.checkIn) p.set("from", range.checkIn);
    if (range.checkOut) p.set("to", range.checkOut);
    p.set("guests", String(guests));
    return `?${p.toString()}`;
  }, [range, guests]);

  const value = useMemo<BookingContextValue>(
    () => ({
      range,
      setRange,
      guests,
      setGuests: (n) => setGuests(Math.min(Math.max(1, n), capacity)),
      currentQuote,
      unavailableDates,
      bookingQuery,
    }),
    [range, guests, currentQuote, unavailableDates, bookingQuery, capacity],
  );

  return <BookingContext.Provider value={value}>{children}</BookingContext.Provider>;
}

export function useBooking(): BookingContextValue {
  const ctx = useContext(BookingContext);
  if (!ctx) throw new Error("useBooking must be used inside <BookingProvider>");
  return ctx;
}
