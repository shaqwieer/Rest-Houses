import { afterEach, describe, expect, it, vi } from "vitest";

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

    expect(report("RQ-1001")).toBe(true);
    expect(report("RQ-1001")).toBe(false);
    expect(gtag).toHaveBeenCalledTimes(1);
    expect(gtag).toHaveBeenCalledWith("event", "conversion", {
      send_to: "AW-950802645/v8J9CO7Sk-wcENWxsMUD",
    });
  });

  it("does nothing safely when window.gtag is unavailable", async () => {
    const browser = browserWith();
    vi.stubGlobal("window", browser);
    const report = await reporter();

    expect(report("RQ-1001")).toBe(false);
    expect(browser.sessionStorage.setItem).not.toHaveBeenCalled();
  });

  it("does not report a booking already recorded in this tab", async () => {
    const gtag = vi.fn();
    vi.stubGlobal("window", browserWith(gtag, true));
    const report = await reporter();

    expect(report("RQ-1001")).toBe(false);
    expect(gtag).not.toHaveBeenCalled();
  });

  it("allows one event for each distinct successful booking", async () => {
    const gtag = vi.fn();
    vi.stubGlobal("window", browserWith(gtag));
    const report = await reporter();

    expect(report("RQ-1001")).toBe(true);
    expect(report("RQ-1002")).toBe(true);
    expect(gtag).toHaveBeenCalledTimes(2);
  });
});
