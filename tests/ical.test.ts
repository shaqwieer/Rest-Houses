import { describe, expect, it } from "vitest";
import {
  buildICal,
  daysOfCalendar,
  daysOfEvent,
  parseICal,
} from "@/lib/calendar/ical";
import { groupIntoRanges } from "@/lib/calendar/export";
import { isBlockedAddress, validateFeedUrl } from "@/lib/calendar/fetch";

/**
 * The iCal layer, in isolation — no database and no network.
 *
 * These are the assertions that decide whether the sync is *correct* rather
 * than merely working: which days an event holds, and whether a response is a
 * calendar at all. Both have a wrong answer that silently sells an occupied
 * night, so they are tested against the literal bytes the platforms send.
 */

/** A feed shaped like Airbnb's, including the CRLF endings and the folding. */
function airbnbFeed(body: string): string {
  return ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Airbnb Inc//Hosting//EN", body, "END:VCALENDAR"].join("\r\n");
}

describe("parseICal — envelope", () => {
  it("reads a normal all-day reservation", () => {
    const calendar = parseICal(
      airbnbFeed(
        [
          "BEGIN:VEVENT",
          "DTSTART;VALUE=DATE:20260910",
          "DTEND;VALUE=DATE:20260913",
          "UID:abc123@airbnb.com",
          "SUMMARY:Reserved",
          "END:VEVENT",
        ].join("\r\n"),
      ),
    );

    expect(calendar).not.toBeNull();
    expect(calendar!.events).toEqual([
      { uid: "abc123@airbnb.com", start: "2026-09-10", end: "2026-09-13", summary: "Reserved" },
    ]);
  });

  it("returns null for an HTML error page that happens to arrive with a 200", () => {
    // The case that matters most: this must NOT read as an empty calendar, or
    // reconciliation would free every night the platform has sold.
    expect(parseICal("<!DOCTYPE html><html><body>Sign in to continue</body></html>")).toBeNull();
    expect(parseICal("")).toBeNull();
    expect(parseICal("Not Found")).toBeNull();
  });

  it("returns null for a response truncated mid-transfer", () => {
    // Opening line present, closing line missing. Structurally this looks like
    // a short calendar; requiring END:VCALENDAR is what rejects it.
    const truncated = [
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      "BEGIN:VEVENT",
      "DTSTART;VALUE=DATE:20260910",
    ].join("\r\n");

    expect(parseICal(truncated)).toBeNull();
  });

  it("distinguishes a valid empty calendar from a broken one", () => {
    // Everything was cancelled. Legitimate, and it must reconcile.
    const empty = parseICal(["BEGIN:VCALENDAR", "VERSION:2.0", "END:VCALENDAR"].join("\r\n"));
    expect(empty).not.toBeNull();
    expect(empty!.events).toEqual([]);
  });
});

describe("parseICal — line folding", () => {
  it("rejoins a SUMMARY folded across three lines", () => {
    // RFC 5545 folds at 75 octets and each continuation begins with one space
    // that is not part of the value. Airbnb folds routinely on long names.
    const calendar = parseICal(
      airbnbFeed(
        [
          "BEGIN:VEVENT",
          "DTSTART;VALUE=DATE:20260910",
          "DTEND;VALUE=DATE:20260911",
          "UID:folded@airbnb.com",
          "SUMMARY:Reserved — Al Badia Desert Rest House and Majlis with the very",
          "  long name that Airbnb writes out in full",
          " , plus a tail",
          "END:VEVENT",
        ].join("\r\n"),
      ),
    );

    expect(calendar!.events[0].summary).toBe(
      "Reserved — Al Badia Desert Rest House and Majlis with the very long name that Airbnb writes out in full, plus a tail",
    );
  });

  it("unfolds tab continuations and bare-LF feeds", () => {
    // The fold character itself is NOT a space in the value: RFC 5545 strips it
    // and joins directly, so a real folder splits mid-word or leaves the space
    // as the first content character of the continuation. Both forms here.
    const calendar = parseICal(
      [
        "BEGIN:VCALENDAR",
        "BEGIN:VEVENT",
        "DTSTART;VALUE=DATE:20260910",
        "DTEND;VALUE=DATE:20260911",
        "SUMMARY:Blocked fo",
        "\tr mainten",
        " ance",
        "END:VEVENT",
        "END:VCALENDAR",
      ].join("\n"),
    );

    expect(calendar!.events[0].summary).toBe("Blocked for maintenance");
  });

  it("survives a BOM, which would otherwise hide BEGIN:VCALENDAR", () => {
    const calendar = parseICal("﻿" + airbnbFeed("X-NOTE:none"));
    expect(calendar).not.toBeNull();
  });
});

describe("parseICal — dates", () => {
  it("treats a same-day DTEND as a one-day hold", () => {
    const calendar = parseICal(
      airbnbFeed(
        [
          "BEGIN:VEVENT",
          "DTSTART;VALUE=DATE:20260910",
          "DTEND;VALUE=DATE:20260910",
          "END:VEVENT",
        ].join("\r\n"),
      ),
    );
    expect(daysOfEvent(calendar!.events[0])).toEqual(["2026-09-10"]);
  });

  it("treats a missing DTEND as a one-day hold", () => {
    const calendar = parseICal(
      airbnbFeed(["BEGIN:VEVENT", "DTSTART;VALUE=DATE:20260910", "END:VEVENT"].join("\r\n")),
    );
    expect(daysOfEvent(calendar!.events[0])).toEqual(["2026-09-10"]);
  });

  it("resolves a UTC DATE-TIME to the Gulf calendar day", () => {
    // 21:00 UTC on the 9th is 01:00 on the 10th in Dubai. Slicing the first
    // eight characters would date this a day early and release a held night.
    const calendar = parseICal(
      airbnbFeed(
        [
          "BEGIN:VEVENT",
          "DTSTART:20260909T210000Z",
          "DTEND:20260910T210000Z",
          "END:VEVENT",
        ].join("\r\n"),
      ),
    );
    expect(calendar!.events[0].start).toBe("2026-09-10");
    expect(calendar!.events[0].end).toBe("2026-09-11");
  });

  it("ignores a VALARM's own DTSTART nested inside the event", () => {
    const calendar = parseICal(
      airbnbFeed(
        [
          "BEGIN:VEVENT",
          "DTSTART;VALUE=DATE:20260910",
          "DTEND;VALUE=DATE:20260912",
          "BEGIN:VALARM",
          "TRIGGER:-PT1H",
          "DTSTART;VALUE=DATE:19990101",
          "END:VALARM",
          "END:VEVENT",
        ].join("\r\n"),
      ),
    );
    expect(calendar!.events[0].start).toBe("2026-09-10");
    expect(calendar!.events).toHaveLength(1);
  });

  it("skips an event with no usable DTSTART rather than dropping the feed", () => {
    const calendar = parseICal(
      airbnbFeed(
        [
          "BEGIN:VEVENT",
          "SUMMARY:No dates here",
          "END:VEVENT",
          "BEGIN:VEVENT",
          "DTSTART;VALUE=DATE:20260910",
          "DTEND;VALUE=DATE:20260911",
          "END:VEVENT",
        ].join("\r\n"),
      ),
    );
    expect(calendar!.events).toHaveLength(1);
    expect(calendar!.skipped).toBe(1);
  });
});

describe("DTEND is exclusive", () => {
  it("holds the nights of the stay and leaves the checkout morning free", () => {
    // 10th → 13th is three nights: 10, 11, 12. The 13th is free for the next
    // arrival, exactly as `nightsInRange` treats BookingRequest.checkOut.
    expect(
      daysOfEvent({ uid: "", start: "2026-09-10", end: "2026-09-13", summary: "" }),
    ).toEqual(["2026-09-10", "2026-09-11", "2026-09-12"]);
  });

  it("collapses two events that touch the same day", () => {
    const calendar = parseICal(
      airbnbFeed(
        [
          "BEGIN:VEVENT",
          "DTSTART;VALUE=DATE:20260910",
          "DTEND;VALUE=DATE:20260912",
          "END:VEVENT",
          "BEGIN:VEVENT",
          "DTSTART;VALUE=DATE:20260911",
          "DTEND;VALUE=DATE:20260913",
          "END:VEVENT",
        ].join("\r\n"),
      ),
    );

    expect([...daysOfCalendar(calendar!, "2026-01-01")].sort()).toEqual([
      "2026-09-10",
      "2026-09-11",
      "2026-09-12",
    ]);
  });

  it("drops days before the cutoff", () => {
    const calendar = parseICal(
      airbnbFeed(
        [
          "BEGIN:VEVENT",
          "DTSTART;VALUE=DATE:20260908",
          "DTEND;VALUE=DATE:20260912",
          "END:VEVENT",
        ].join("\r\n"),
      ),
    );

    expect([...daysOfCalendar(calendar!, "2026-09-10")].sort()).toEqual([
      "2026-09-10",
      "2026-09-11",
    ]);
  });
});

describe("buildICal", () => {
  const body = buildICal({
    name: "استراحة الواحة",
    dtstamp: "20260809T120000Z",
    events: [
      { uid: "booked-2026-09-10-2026-09-13@rest-houses", start: "2026-09-10", end: "2026-09-13", summary: "Booked" },
    ],
  });

  it("emits a well-formed all-day event with CRLF endings", () => {
    expect(body).toContain("BEGIN:VCALENDAR\r\n");
    expect(body).toContain("DTSTART;VALUE=DATE:20260910\r\n");
    expect(body).toContain("DTEND;VALUE=DATE:20260913\r\n");
    expect(body.endsWith("END:VCALENDAR\r\n")).toBe(true);
  });

  it("round-trips through the parser to the same days", () => {
    const reparsed = parseICal(body);
    expect(daysOfEvent(reparsed!.events[0])).toEqual([
      "2026-09-10",
      "2026-09-11",
      "2026-09-12",
    ]);
  });

  it("folds a long Arabic calendar name without splitting a character", () => {
    const long = buildICal({
      name: "استراحة".repeat(30),
      dtstamp: "20260809T120000Z",
      events: [],
    });
    // Folded — and still valid UTF-8, which a byte-wise split would break.
    expect(long).toContain("\r\n ");
    expect(long).not.toContain("�");
    expect(parseICal(long)).not.toBeNull();
  });
});

describe("groupIntoRanges", () => {
  it("merges consecutive days and splits at a gap", () => {
    expect(
      groupIntoRanges(["2026-09-10", "2026-09-11", "2026-09-12", "2026-09-20"]),
    ).toEqual([
      { start: "2026-09-10", end: "2026-09-13" },
      { start: "2026-09-20", end: "2026-09-21" },
    ]);
  });

  it("crosses a month boundary as one range", () => {
    expect(groupIntoRanges(["2026-09-30", "2026-10-01"])).toEqual([
      { start: "2026-09-30", end: "2026-10-02" },
    ]);
  });
});

/**
 * SSRF guards. The owner supplies these URLs and the server fetches them from
 * inside the production network, where the database container and the cloud
 * metadata endpoint are both one hop away.
 */
describe("feed URL validation", () => {
  it("accepts the real platform URLs", () => {
    expect(validateFeedUrl("https://www.airbnb.com/calendar/ical/123.ics?s=abc").ok).toBe(true);
    expect(validateFeedUrl("https://ical.booking.com/v1/export?t=abc").ok).toBe(true);
  });

  it("rewrites webcal:// rather than making an owner edit what they copied", () => {
    const result = validateFeedUrl("webcal://ical.booking.com/v1/export?t=abc");
    expect(result.ok).toBe(true);
    expect(result.ok && result.url.protocol).toBe("https:");
  });

  it("refuses plaintext http, which would let the calendar be rewritten in transit", () => {
    expect(validateFeedUrl("http://www.airbnb.com/calendar/ical/1.ics")).toEqual({
      ok: false,
      failure: "NOT_HTTPS",
    });
  });

  it("refuses non-http schemes outright", () => {
    expect(validateFeedUrl("file:///etc/passwd").ok).toBe(false);
    expect(validateFeedUrl("gopher://127.0.0.1:5432/").ok).toBe(false);
    expect(validateFeedUrl("not a url at all").ok).toBe(false);
  });

  it("refuses a literal private address without needing DNS", () => {
    expect(validateFeedUrl("https://127.0.0.1/cal.ics")).toEqual({
      ok: false,
      failure: "PRIVATE_ADDRESS",
    });
    expect(validateFeedUrl("https://169.254.169.254/latest/meta-data/")).toEqual({
      ok: false,
      failure: "PRIVATE_ADDRESS",
    });
  });
});

describe("isBlockedAddress", () => {
  it("blocks loopback, private space, CGNAT and cloud metadata", () => {
    for (const address of [
      "127.0.0.1",
      "10.1.2.3",
      "172.16.0.1",
      "172.31.255.255",
      "192.168.1.1",
      "169.254.169.254", // AWS/GCP/Azure metadata
      "100.64.0.1", // carrier-grade NAT
      "0.0.0.0",
      "255.255.255.255",
    ]) {
      expect(isBlockedAddress(address), address).toBe(true);
    }
  });

  it("blocks the IPv6 forms, including IPv4-mapped", () => {
    for (const address of ["::1", "::", "fe80::1", "fc00::1", "fd12:3456::1", "::ffff:127.0.0.1"]) {
      expect(isBlockedAddress(address), address).toBe(true);
    }
  });

  it("allows ordinary public addresses", () => {
    expect(isBlockedAddress("151.101.1.140")).toBe(false);
    expect(isBlockedAddress("2606:4700::1111")).toBe(false);
  });

  it("blocks anything that is not an IP at all, rather than guessing", () => {
    expect(isBlockedAddress("localhost")).toBe(true);
    expect(isBlockedAddress("")).toBe(true);
  });

  it("blocks 172.32.x, which is public and adjacent to the private block", () => {
    // Guards the off-by-one in the 172.16–172.31 range check.
    expect(isBlockedAddress("172.32.0.1")).toBe(false);
    expect(isBlockedAddress("172.15.0.1")).toBe(false);
  });
});
