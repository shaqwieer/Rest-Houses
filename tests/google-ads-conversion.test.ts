import { afterEach, describe, expect, it, vi } from "vitest";

/** The value assembled by `googleAdsSendTo` from the settings row. */
const SEND_TO = "AW-950802645/dVoECJ30sOQcENWxsMUD";

function browserWith(gtag?: ReturnType<typeof vi.fn>, alreadyReported = false) {
  const values = new Map<string, string>();
  if (alreadyReported) values.set("gads-booking-request:RQ-1001", "1");

  return {
    gtag,
    sessionStorage: {
      getItem: vi.fn((key: string) => values.get(key) ?? null),
      setItem: vi.fn((key: string, value: string) => values.set(key, value)),
    },
  };
}

async function reporter() {
  vi.resetModules();
  return (await import("@/components/booking/google-ads-conversion"))
    .reportBookingRequestConversion;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("Booking Request Google Ads conversion", () => {
  it("sends the exact conversion once for one successful booking reference", async () => {
    const gtag = vi.fn();
    vi.stubGlobal("window", browserWith(gtag));
    const report = await reporter();

    expect(report("RQ-1001", SEND_TO)).toBe(true);
    expect(report("RQ-1001", SEND_TO)).toBe(false);
    expect(gtag).toHaveBeenCalledTimes(1);
    expect(gtag).toHaveBeenCalledWith("event", "conversion", { send_to: SEND_TO });
  });

  /**
   * The reason `sendTo` is a parameter at all.
   *
   * It used to be a string literal in the module, so a site that had configured
   * its own tag and label in the dashboard — and was shown a green "tracking is
   * live" line for it — reported its conversions to a completely different
   * Google Ads account. Nothing about that failure is visible from the product.
   */
  it("reports to whichever account the settings row names", async () => {
    const gtag = vi.fn();
    vi.stubGlobal("window", browserWith(gtag));
    const report = await reporter();

    report("RQ-1001", "AW-111111111/someOtherLabel");

    expect(gtag).toHaveBeenCalledWith("event", "conversion", {
      send_to: "AW-111111111/someOtherLabel",
    });
  });

  /**
   * "" is what `googleAdsSendTo` returns when either half is missing, and a
   * `send_to` of "AW-950802645/" is a value Google accepts and attributes to
   * nothing at all.
   */
  it("reports nothing when the conversion is not configured", async () => {
    const gtag = vi.fn();
    vi.stubGlobal("window", browserWith(gtag));
    const report = await reporter();

    expect(report("RQ-1001", "")).toBe(false);
    expect(gtag).not.toHaveBeenCalled();
  });

  it("does nothing safely when window.gtag is unavailable", async () => {
    const browser = browserWith();
    vi.stubGlobal("window", browser);
    const report = await reporter();

    expect(report("RQ-1001", SEND_TO)).toBe(false);
    expect(browser.sessionStorage.setItem).not.toHaveBeenCalled();
  });

  it("does not report a booking already recorded in this tab", async () => {
    const gtag = vi.fn();
    vi.stubGlobal("window", browserWith(gtag, true));
    const report = await reporter();

    expect(report("RQ-1001", SEND_TO)).toBe(false);
    expect(gtag).not.toHaveBeenCalled();
  });

  it("allows one event for each distinct successful booking", async () => {
    const gtag = vi.fn();
    vi.stubGlobal("window", browserWith(gtag));
    const report = await reporter();

    expect(report("RQ-1001", SEND_TO)).toBe(true);
    expect(report("RQ-1002", SEND_TO)).toBe(true);
    expect(gtag).toHaveBeenCalledTimes(2);
  });
});
