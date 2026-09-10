import { afterEach, describe, expect, it, vi } from "vitest";
import { EVENT_MAP, TRACKED_EVENTS } from "@/lib/tracking-events";

/**
 * The event fan-out.
 *
 * Every assertion here is about a mistake that produces *no error at all*: an
 * event sent under a name a platform does not recognise is dropped without a
 * word, a Purchase whose money is in the wrong field arrives worth zero, and a
 * pixel that throws inside a booking flow would take the booking with it.
 *
 * The globals are stubbed rather than the module mocked, because what is under
 * test is precisely which global gets called with what.
 */

type Platforms = {
  fbq: ReturnType<typeof vi.fn>;
  ttq: { track: ReturnType<typeof vi.fn> };
  snaptr: ReturnType<typeof vi.fn>;
  gtag: ReturnType<typeof vi.fn>;
  dataLayer: unknown[];
  sessionStorage: { getItem: ReturnType<typeof vi.fn>; setItem: ReturnType<typeof vi.fn> };
};

/** A browser with every platform loaded, unless `only` narrows it. */
function browser(only?: Partial<Platforms>): Platforms {
  const values = new Map<string, string>();
  return {
    fbq: vi.fn(),
    ttq: { track: vi.fn() },
    snaptr: vi.fn(),
    gtag: vi.fn(),
    dataLayer: [],
    sessionStorage: {
      getItem: vi.fn((key: string) => values.get(key) ?? null),
      setItem: vi.fn((key: string, value: string) => values.set(key, value)),
    },
    ...only,
  };
}

/** A fresh module, so the in-memory `trackOnce` guard starts empty. */
async function tracker() {
  vi.resetModules();
  return import("@/lib/tracking-events");
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("one moment, four vocabularies", () => {
  it("sends each platform its own name for a rest-house view", async () => {
    const w = browser();
    vi.stubGlobal("window", w);
    const { track } = await tracker();

    track("ViewProperty", { id: "استراحة-الرمال", name: "استراحة الرمال", value: 1200 });

    expect(w.fbq).toHaveBeenCalledWith("track", "ViewContent", expect.anything());
    expect(w.ttq.track).toHaveBeenCalledWith("ViewContent", expect.anything());
    expect(w.snaptr).toHaveBeenCalledWith("track", "VIEW_CONTENT", expect.anything());
    expect(w.gtag).toHaveBeenCalledWith("event", "view_item", expect.anything());
  });

  /**
   * Snapchat's money field is `price`; everyone else's is `value`. Sending
   * `value` to Snapchat produces a conversion worth nothing, which is the
   * single most common way a Snap pixel ends up under-reporting.
   */
  it("puts the money in each platform's own field", async () => {
    const w = browser();
    vi.stubGlobal("window", w);
    const { track } = await tracker();

    track("Purchase", { id: "villa", value: 500, transactionId: "RQ-1001" });

    expect(w.fbq).toHaveBeenCalledWith(
      "track",
      "Purchase",
      expect.objectContaining({ value: 500, currency: "AED" }),
    );
    expect(w.ttq.track).toHaveBeenCalledWith(
      "CompletePayment",
      expect.objectContaining({ value: 500, currency: "AED" }),
    );
    expect(w.snaptr).toHaveBeenCalledWith(
      "track",
      "PURCHASE",
      expect.objectContaining({ price: 500, currency: "AED" }),
    );
    expect(w.gtag).toHaveBeenCalledWith(
      "event",
      "purchase",
      expect.objectContaining({ value: 500, transaction_id: "RQ-1001" }),
    );
  });

  /**
   * Meta silently drops an unrecognised name sent through `track`. A custom
   * event MUST go through `trackCustom`, and getting this wrong is invisible
   * from the product — the event simply never appears in Events Manager.
   */
  it("routes a custom Meta event through trackCustom", async () => {
    const w = browser();
    vi.stubGlobal("window", w);
    const { track } = await tracker();

    track("AvailabilityCheck", { id: "villa" });

    expect(w.fbq).toHaveBeenCalledWith("trackCustom", "AvailabilityCheck", expect.anything());
  });

  /** `null` in the map means "this platform has no name for it" — send nothing. */
  it("sends nothing to a platform with no name for the moment", async () => {
    const w = browser();
    vi.stubGlobal("window", w);
    const { track } = await tracker();

    track("AddProperty", { id: "villa" });

    expect(w.snaptr).not.toHaveBeenCalled();
    expect(w.fbq).toHaveBeenCalled();
  });

  /** A container sees none of the calls above, so it is fed the dataLayer. */
  it("pushes a prefixed dataLayer event for Tag Manager", async () => {
    const w = browser();
    vi.stubGlobal("window", w);
    const { track } = await tracker();

    track("ContactWhatsapp", { id: "villa" });

    expect(w.dataLayer).toContainEqual({ event: "rihla_ContactWhatsapp", id: "villa" });
  });
});

describe("a pixel can never break the product", () => {
  it("keeps reporting to the others when one platform throws", async () => {
    const w = browser({
      fbq: vi.fn(() => {
        throw new Error("blocked by an extension");
      }),
    });
    vi.stubGlobal("window", w);
    const { track } = await tracker();

    expect(() => track("BookingRequested", { value: 900 })).not.toThrow();
    expect(w.ttq.track).toHaveBeenCalled();
    expect(w.snaptr).toHaveBeenCalled();
    expect(w.gtag).toHaveBeenCalled();
  });

  it("does nothing at all when no pixel is loaded", async () => {
    vi.stubGlobal("window", { sessionStorage: browser().sessionStorage });
    const { track } = await tracker();

    expect(() => track("ViewProperty", { id: "villa" })).not.toThrow();
  });
});

describe("trackOnce", () => {
  it("reports a key once and every distinct key separately", async () => {
    const w = browser();
    vi.stubGlobal("window", w);
    const { trackOnce } = await tracker();

    expect(trackOnce("RQ-1001", "Purchase", { value: 100 })).toBe(true);
    expect(trackOnce("RQ-1001", "Purchase", { value: 100 })).toBe(false);
    expect(trackOnce("RQ-1002", "Purchase", { value: 100 })).toBe(true);

    expect(w.gtag).toHaveBeenCalledTimes(2);
  });

  /** A refresh is a new page load, so only the stored flag can stop it. */
  it("honours a flag left in storage by an earlier page load", async () => {
    const w = browser();
    w.sessionStorage.getItem.mockReturnValue("1");
    vi.stubGlobal("window", w);
    const { trackOnce } = await tracker();

    expect(trackOnce("RQ-1001", "Purchase")).toBe(false);
    expect(w.gtag).not.toHaveBeenCalled();
  });

  /** Private modes throw on storage; the event must still be reported once. */
  it("falls back to the in-memory guard when storage is unavailable", async () => {
    const w = browser();
    w.sessionStorage.getItem.mockImplementation(() => {
      throw new Error("storage disabled");
    });
    w.sessionStorage.setItem.mockImplementation(() => {
      throw new Error("storage disabled");
    });
    vi.stubGlobal("window", w);
    const { trackOnce } = await tracker();

    expect(trackOnce("RQ-1001", "Purchase")).toBe(true);
    expect(trackOnce("RQ-1001", "Purchase")).toBe(false);
    expect(w.gtag).toHaveBeenCalledTimes(1);
  });
});

/**
 * The map is printed on /admin/tracking for the media buyer to copy into Ads
 * Manager, so a blank cell there has to mean "deliberately not sent" rather
 * than "somebody forgot a line".
 */
describe("the event map", () => {
  it("names at least one platform for every moment the site reports", () => {
    for (const event of TRACKED_EVENTS) {
      const names = EVENT_MAP[event];
      const any = [names.meta?.name, names.tiktok, names.snapchat, names.google].some(Boolean);
      expect(any, `${event} reports to nobody`).toBe(true);
    }
  });

  /**
   * A booking request is a lead, not a sale. Reporting it as a purchase teaches
   * every platform's optimiser to buy enquiries that never become stays.
   */
  it("keeps a booking request separate from a paid deposit", () => {
    expect(EVENT_MAP.BookingRequested.meta?.name).toBe("Lead");
    expect(EVENT_MAP.Purchase.meta?.name).toBe("Purchase");
    expect(EVENT_MAP.BookingRequested.google).not.toBe(EVENT_MAP.Purchase.google);
  });
});
