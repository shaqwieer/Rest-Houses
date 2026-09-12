import { describe, expect, it } from "vitest";
import { googleMapsDirectionsUrl, googleMapsSearchUrl } from "@/lib/maps";
import { ar, en } from "@/lib/i18n";

/**
 * The guest's complaint these links exist for: the embedded map shows a pin in
 * open desert with nothing recognisable around it, so they cannot tell whether
 * the rest house is twenty minutes away or two hours. Handing the coordinates
 * to Google Maps answers that — but only if the URL survives a round trip
 * through Google's parser, and both ways it can fail here are silent.
 */
describe("Google Maps links", () => {
  /** Al Ajban, Abu Dhabi — the listing in the guest's screenshot. */
  const spot = { lat: 24.60471, lng: 55.05123 };

  it("uses the URL API, not the iframe embed spelling", () => {
    // `maps?q=…&output=embed` (admin/settings-form.tsx) renders a bare embed
    // with no app hand-off and no Directions button — the exact thing the guest
    // could not get from the page already.
    for (const url of [googleMapsSearchUrl(spot), googleMapsDirectionsUrl(spot)]) {
      expect(url).toContain("api=1");
      expect(url).not.toContain("output=embed");
      expect(new URL(url).origin).toBe("https://www.google.com");
    }
  });

  it("points the search link at the coordinates", () => {
    const params = new URL(googleMapsSearchUrl(spot)).searchParams;
    expect(params.get("query")).toBe("24.60471,55.05123");
  });

  it("makes the rest house the destination, leaving the origin to Google", () => {
    // No `origin` parameter: Google fills in "Your location" itself, so the
    // guest's position never travels through this server.
    const url = new URL(googleMapsDirectionsUrl(spot));
    expect(url.searchParams.get("destination")).toBe("24.60471,55.05123");
    expect(url.searchParams.get("origin")).toBeNull();
  });

  /**
   * The trap worth a test of its own. Every user-facing number in this project
   * goes through `arNum`, and a coordinate that followed that habit would be
   * spelled ٢٤٫٦٠٤٧١ — which looks right in the JSX and lands the guest
   * nowhere.
   */
  it("writes coordinates in ASCII digits on an Arabic page", () => {
    for (const url of [googleMapsSearchUrl(spot), googleMapsDirectionsUrl(spot)]) {
      expect(url).toMatch(/^[\x20-\x7E]+$/);
    }
  });

  /**
   * The popup in listing-map.tsx is built as an HTML string and runs the URL
   * through `escapeHtml` on the way into the `href` — correct there, since a
   * bare `&` in an attribute is invalid HTML. It must not already be escaped
   * when it leaves here, or the popup would emit `&amp;amp;` and Google would
   * read the second parameter as part of the first.
   */
  it("returns a bare URL, not an HTML-escaped one", () => {
    for (const url of [googleMapsSearchUrl(spot), googleMapsDirectionsUrl(spot)]) {
      expect(url).toContain("&");
      expect(url).not.toContain("&amp;");
    }
  });

  it("keeps negative and whole-number coordinates intact", () => {
    // Not the UAE, but nothing in the schema stops an owner from typing it, and
    // a mangled minus sign would put the pin on the wrong side of the equator.
    const url = new URL(googleMapsSearchUrl({ lat: -33, lng: 151.2 }));
    expect(url.searchParams.get("query")).toBe("-33,151.2");
  });

  it("labels the links in both languages", () => {
    // Blank link text is what a missing dictionary key renders as.
    for (const d of [ar, en]) {
      expect(d.listing.openInGoogleMaps.trim()).not.toBe("");
      expect(d.listing.directionsFromYou.trim()).not.toBe("");
    }
  });
});
