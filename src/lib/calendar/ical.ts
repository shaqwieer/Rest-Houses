/**
 * iCalendar (RFC 5545) — the narrow slice of it that calendar sync needs.
 *
 * Two directions:
 *   `parseICal`  — an .ics body from Airbnb/Booking.com → the days it holds
 *   `buildICal`  — this platform's own busy days → an .ics body they can import
 *
 * ─── Why this is hand-written rather than a dependency ──────────────────────
 * The input is not "any calendar". It is the export of a lodging platform, and
 * every event in one is an all-day VEVENT with a DTSTART, a DTEND and a UID.
 * There are no recurrence rules, no attendees, no alarms and no timezone
 * components — the parts of RFC 5545 that make a general parser large are
 * exactly the parts that never appear here. `node-ical` would bring rrule and a
 * timezone database to read four properties; this file reads them in ~200 lines
 * that the rest of the project can audit, matching how src/lib/dates.ts already
 * declines a date library for the same reason.
 *
 * What is NOT supported, stated so nobody assumes otherwise: RRULE/RDATE
 * (a recurring event is read as its first occurrence only), VTIMEZONE lookups
 * (a floating or TZID-qualified DATE-TIME is read as Gulf wall-clock — see
 * `dayOfValue`), and VALARM/VTODO/VJOURNAL, which are skipped.
 */

import {
  addDays,
  nightsBetween,
  toGulfISODate,
  isISODate,
  type ISODate,
} from "@/lib/dates";

/** One VEVENT, reduced to what a booking calendar actually carries. */
export type ICalEvent = {
  /** Stable id from the source. "" when the feed omits it. */
  uid: string;
  /** First day held, inclusive. */
  start: ISODate;
  /**
   * The morning the hold ends — EXCLUSIVE, matching both RFC 5545 and this
   * app's own `BookingRequest.checkOut`. See `daysOfEvent`.
   */
  end: ISODate;
  /** e.g. "Reserved", "Airbnb (Not available)", "CLOSED - Not available". */
  summary: string;
};

/**
 * The result of reading a feed body.
 *
 * `null` from `parseICal` means "this was not a calendar" and is the single
 * most important distinction in this module — see the note there.
 */
export type ICalCalendar = {
  events: ICalEvent[];
  /** Events seen but discarded for want of a usable DTSTART. */
  skipped: number;
};

/* -------------------------------------------------------------------------- */
/* Reading                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Undo RFC 5545 line folding.
 *
 * A content line longer than 75 octets is split, and each continuation begins
 * with a single space or tab which is NOT part of the value. Airbnb folds
 * routinely — a SUMMARY carrying a long rest-house name arrives in two or three
 * pieces — so a parser that reads line-by-line without this sees a truncated
 * summary and, worse, treats the continuation as a malformed property.
 *
 * Handles all three line endings: feeds are supposed to use CRLF and some use
 * bare LF, so splitting on CRLF alone leaves \n inside every value.
 */
function unfold(text: string): string[] {
  // Strip a UTF-8 BOM: it would otherwise become part of the first property
  // name, so the envelope check below would not recognise "BEGIN".
  const body = text.replace(/^﻿/, "");
  const out: string[] = [];

  for (const raw of body.split(/\r\n|\r|\n/)) {
    if (raw.startsWith(" ") || raw.startsWith("\t")) {
      // A continuation with nothing to continue is malformed; drop it rather
      // than starting a line with a stray space.
      if (out.length > 0) out[out.length - 1] += raw.slice(1);
      continue;
    }
    out.push(raw);
  }

  return out;
}

/** `DTSTART;VALUE=DATE:20260910` → name "DTSTART", params, value "20260910". */
function splitLine(line: string): { name: string; params: string[]; value: string } | null {
  const colon = line.indexOf(":");
  if (colon === -1) return null;

  const head = line.slice(0, colon);
  const value = line.slice(colon + 1);
  const [name, ...params] = head.split(";");

  return { name: name.trim().toUpperCase(), params, value };
}

/**
 * Unescape the text values RFC 5545 escapes: \n \, \; \\
 *
 * Only applied to SUMMARY. A date value contains none of these, and running the
 * replacement over one would be a way to corrupt it for no benefit.
 */
function unescapeText(value: string): string {
  return value
    .replace(/\\n/gi, " ")
    .replace(/\\([,;\\])/g, "$1")
    .trim();
}

/**
 * A DTSTART/DTEND value → the calendar day it names.
 *
 * Three forms appear in the wild:
 *   20260910                — VALUE=DATE. Airbnb and Booking.com use only this.
 *   20260910T140000Z        — UTC instant. Google Calendar and Vrbo emit these.
 *   20260910T140000         — floating, or qualified by a TZID parameter.
 *
 * The instant forms are resolved to the day they fall on **in the UAE**, via
 * `toGulfISODate`, not by slicing the first eight characters. That is the bug
 * this codebase's date handling exists to prevent: a hold ending 2026-09-10 at
 * 22:00 Gulf time is `20260910T180000Z`, and slicing is right there by luck —
 * but one ending at 01:00 Gulf time is `20260909T210000Z`, and slicing dates it
 * a day early, releasing a night that is still held.
 *
 * A floating or TZID-qualified time is read as Gulf wall-clock and its date
 * component used as-is. Resolving a real TZID needs a timezone database this
 * module deliberately does not carry; for a UAE audience the local reading is
 * both the common case and the one that errs toward keeping a day blocked.
 */
function dayOfValue(value: string, params: string[]): ISODate | null {
  const raw = value.trim();

  // VALUE=DATE — the only form Airbnb and Booking.com produce.
  const dateOnly = /^(\d{4})(\d{2})(\d{2})$/.exec(raw);
  if (dateOnly) {
    const iso = `${dateOnly[1]}-${dateOnly[2]}-${dateOnly[3]}`;
    return isISODate(iso) ? iso : null;
  }

  const dateTime = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z?)$/.exec(raw);
  if (dateTime) {
    const [, y, m, d, hh, mm, ss, zulu] = dateTime;
    const iso = `${y}-${m}-${d}`;
    if (!isISODate(iso)) return null;

    // Floating or TZID-qualified: take the wall-clock day as written.
    if (zulu !== "Z") return iso;

    return toGulfISODate(
      new Date(
        Date.UTC(Number(y), Number(m) - 1, Number(d), Number(hh), Number(mm), Number(ss)),
      ),
    );
  }

  // Anything else — a duration, a period, a malformed value — is not a day.
  void params;
  return null;
}

/**
 * An .ics body → the events in it, or `null` if it was not a calendar at all.
 *
 * ─── The null return is the whole safety story ──────────────────────────────
 * `syncFeed` reconciles by deleting a feed's imported days and re-inserting
 * what the feed now says. That is correct only when the feed genuinely spoke.
 * A captive portal, an expired token page, a 200-with-HTML error, a truncated
 * response — every one of those "parses" to zero events, and reconciling
 * against zero would free every night the other platform has sold. The next
 * guest then double-books, which is the exact harm this feature exists to
 * prevent.
 *
 * So a calendar is only a calendar if it has the RFC 5545 envelope:
 * BEGIN:VCALENDAR … END:VCALENDAR. Requiring the closing line as well as the
 * opening one is what rejects a response truncated mid-transfer, which would
 * otherwise present as a short but structurally valid calendar.
 *
 * A *valid* calendar with no events is a different thing entirely and returns
 * `{ events: [] }` — it legitimately means every booking was cancelled, and it
 * must reconcile.
 */
export function parseICal(text: string): ICalCalendar | null {
  if (typeof text !== "string" || text.length === 0) return null;

  const lines = unfold(text);

  let sawBegin = false;
  let sawEnd = false;
  for (const line of lines) {
    const upper = line.trim().toUpperCase();
    if (upper === "BEGIN:VCALENDAR") sawBegin = true;
    else if (upper === "END:VCALENDAR") sawEnd = true;
  }
  if (!sawBegin || !sawEnd) return null;

  const events: ICalEvent[] = [];
  let skipped = 0;

  // Only VEVENT is read. A feed carrying VTODO or VALARM (some channel managers
  // attach reminders) must not have those counted as holds, and a VALARM nested
  // inside a VEVENT carries its own DTSTART that would otherwise overwrite the
  // event's — hence tracking the component we are actually inside.
  let inEvent = false;
  let depth = 0;
  let current: { uid: string; start: ISODate | null; end: ISODate | null; summary: string } | null =
    null;

  for (const line of lines) {
    const parsed = splitLine(line);
    if (!parsed) continue;
    const { name, params, value } = parsed;

    if (name === "BEGIN") {
      const component = value.trim().toUpperCase();
      if (component === "VEVENT" && !inEvent) {
        inEvent = true;
        depth = 0;
        current = { uid: "", start: null, end: null, summary: "" };
      } else if (inEvent) {
        // A nested component (VALARM). Ignore its properties.
        depth += 1;
      }
      continue;
    }

    if (name === "END") {
      const component = value.trim().toUpperCase();
      if (inEvent && component === "VEVENT" && depth === 0) {
        if (current?.start) {
          events.push({
            uid: current.uid,
            start: current.start,
            // A feed may omit DTEND entirely. RFC 5545 says an all-day event
            // with no DTEND lasts one day, so the exclusive end is the morning
            // after — which is also what a same-day DTEND (start === end, seen
            // from some channel managers) has to mean.
            end: current.end && current.end > current.start ? current.end : addDays(current.start, 1),
            summary: current.summary,
          });
        } else if (current) {
          skipped += 1;
        }
        inEvent = false;
        current = null;
      } else if (inEvent && depth > 0) {
        depth -= 1;
      }
      continue;
    }

    if (!inEvent || depth > 0 || !current) continue;

    switch (name) {
      case "UID":
        current.uid = value.trim().slice(0, 255);
        break;
      case "DTSTART":
        current.start = dayOfValue(value, params);
        break;
      case "DTEND":
        current.end = dayOfValue(value, params);
        break;
      case "SUMMARY":
        current.summary = unescapeText(value).slice(0, 200);
        break;
      default:
        break;
    }
  }

  return { events, skipped };
}

/**
 * The calendar days one event actually holds.
 *
 * DTEND is exclusive, exactly like `BookingRequest.checkOut`: a guest arriving
 * on the 10th and leaving on the 12th occupies the nights of the 10th and 11th,
 * and the 12th is free for the next arrival. So this is `nightsInRange`'s
 * question, and the answer is deliberately the same — an off-by-one here either
 * sells an occupied night or holds an empty one every single booking.
 *
 * Capped: a feed advertising a ten-year block would otherwise expand to
 * thousands of rows per event. Anything longer than two years is truncated,
 * which still covers every real booking horizon.
 */
const MAX_EVENT_DAYS = 750;

export function daysOfEvent(event: ICalEvent): ISODate[] {
  const span = Math.min(nightsBetween(event.start, event.end), MAX_EVENT_DAYS);
  const days: ISODate[] = [];
  for (let i = 0; i < span; i++) days.push(addDays(event.start, i));
  return days;
}

/**
 * How far ahead an imported day may land.
 *
 * Mirrors `HORIZON_DAYS` in ./export.ts deliberately: importing further than
 * this platform will ever publish is asymmetric for no benefit. Two years
 * covers every real booking horizon.
 *
 * Without a ceiling, a feed carrying a far-future placeholder — some channel
 * managers emit a "closed until further notice" event ending in 2099 — writes
 * rows for every day between now and then, which no query will ever read and
 * every calendar scan has to step over. `MAX_EVENT_DAYS` bounds one event; this
 * bounds where the days may fall.
 */
const IMPORT_HORIZON_DAYS = 730;

/**
 * Every day held by a whole calendar, from `fromISO` forward.
 *
 * A Set, so two events touching the same day — an overlap the source platform
 * allowed, or a checkout and a check-in it modelled as separate blocks —
 * collapse to one imported day rather than colliding on insert.
 *
 * Past days are dropped. They cannot affect a bookable night, and importing
 * years of a busy listing's history would add thousands of rows that every
 * calendar query then has to skip.
 */
export function daysOfCalendar(calendar: ICalCalendar, fromISO: ISODate): Set<ISODate> {
  const until = addDays(fromISO, IMPORT_HORIZON_DAYS);
  const days = new Set<ISODate>();

  for (const event of calendar.events) {
    for (const day of daysOfEvent(event)) {
      // Lexicographic compare is correct for YYYY-MM-DD.
      if (day >= fromISO && day < until) days.add(day);
    }
  }

  return days;
}

/* -------------------------------------------------------------------------- */
/* Writing                                                                    */
/* -------------------------------------------------------------------------- */

/** Fold a content line at 75 octets, as RFC 5545 requires. */
function fold(line: string): string {
  if (Buffer.byteLength(line, "utf8") <= 75) return line;

  const out: string[] = [];
  let chunk = "";
  let bytes = 0;

  // Walk by code point rather than by UTF-16 unit: splitting an Arabic
  // character or an emoji in half would emit invalid UTF-8, and a rest house's
  // name is routinely Arabic.
  for (const char of line) {
    const size = Buffer.byteLength(char, "utf8");
    // 74 not 75: the continuation line adds a leading space, which counts.
    if (bytes + size > 74) {
      out.push(chunk);
      chunk = "";
      bytes = 0;
    }
    chunk += char;
    bytes += size;
  }
  if (chunk) out.push(chunk);

  return out.join("\r\n ");
}

/** Escape a value for a TEXT property. */
function escapeText(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r?\n/g, "\\n");
}

/** `2026-09-10` → `20260910`, the VALUE=DATE form. */
function icalDate(iso: ISODate): string {
  return iso.replace(/-/g, "");
}

export type ExportEvent = {
  uid: string;
  /** Inclusive first day held. */
  start: ISODate;
  /** Exclusive — the morning the hold ends. */
  end: ISODate;
  summary: string;
};

/**
 * Build an .ics body other platforms can import.
 *
 * All-day VALUE=DATE events, because that is what a night is and what every
 * lodging platform expects to read. `DTSTAMP` is required by RFC 5545 and is
 * passed in rather than read from the clock so the output is deterministic —
 * which is what lets a test assert on the whole body.
 *
 * ─── What is deliberately absent ────────────────────────────────────────────
 * No guest name, no phone number, no email, no price, no booking reference.
 * This URL is unauthenticated by design — it is handed to another company's
 * crawler — so the body is treated as public. Every event says only that the
 * rest house is unavailable, which is the entire fact the other platform needs.
 */
export function buildICal(input: {
  /** Shown as the calendar name in most clients. */
  name: string;
  dtstamp: string;
  events: ExportEvent[];
}): string {
  const lines: string[] = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Desert Chalets//Rest House Calendar//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    `X-WR-CALNAME:${escapeText(input.name)}`,
  ];

  for (const event of input.events) {
    lines.push(
      "BEGIN:VEVENT",
      `UID:${escapeText(event.uid)}`,
      `DTSTAMP:${input.dtstamp}`,
      `DTSTART;VALUE=DATE:${icalDate(event.start)}`,
      `DTEND;VALUE=DATE:${icalDate(event.end)}`,
      `SUMMARY:${escapeText(event.summary)}`,
      "TRANSP:OPAQUE",
      "END:VEVENT",
    );
  }

  lines.push("END:VCALENDAR");

  // CRLF throughout and a trailing one: RFC 5545 requires it, and some importers
  // reject a body whose final line is unterminated.
  return lines.map(fold).join("\r\n") + "\r\n";
}
