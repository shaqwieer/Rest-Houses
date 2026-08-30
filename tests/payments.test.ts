import { describe, expect, it } from "vitest";
import {
  PAYMENT_LIFECYCLE,
  PAYMENT_STATUSES,
  isPaymentLifecycle,
  isPaymentStatus,
  isTerminalPayment,
  PAYMENT_MODES_FIELD,
  type PaymentLifecycle,
} from "@/lib/constants";
import {
  canTransition,
  eventKey,
  rollUpPaymentReference,
  rollUpPaymentStatus,
  toInternalStatus,
  toPaymentLifecycle,
} from "@/lib/payments/status";
import {
  parseListingPaymentModes,
  platformPaymentModes,
  resolveListingPaymentModes,
  serializeListingPaymentModes,
  isModeAvailable,
} from "@/lib/payments/methods";
import {
  availableProviders,
  hasCredentials,
  onlinePaymentsEnabled,
  providerState,
  publicPaymentConfig,
} from "@/lib/payments/config";
import { isDepositPaymentEnabled, depositPaymentStatus } from "@/lib/payments";
import type { Settings } from "@/lib/settings";

/**
 * The payment layer's rules, tested without a database or a gateway.
 *
 * Everything here is a pure function over strings, numbers and a settings
 * object, which is the point of keeping status mapping, mode resolution and the
 * config gates free of Prisma: the rules that decide whether money moves can be
 * asserted directly rather than inferred from a mocked client.
 *
 * The database-backed half — idempotency, the ledger roll-up as actually
 * written, payment-link tokens — is in tests/payment-flow.test.ts.
 */

/** A settings row with every payment switch off — an unconfigured install. */
function settings(overrides: Partial<Settings> = {}): Settings {
  return {
    depositPaymentsEnabled: false,
    telrEnabled: false,
    tabbyEnabled: false,
    tamaraEnabled: false,
    paymentLinksEnabled: false,
    paymentLinkDays: 7,
    ...overrides,
  } as Settings;
}

describe("the payment vocabularies stay separate", () => {
  /**
   * The distinction the whole two-array design exists for. Folding the seven
   * lifecycle values into `PAYMENT_STATUSES` would make them storable on
   * `BookingRequest.paymentStatus`, and every `paymentStatus: "PAID"` query in
   * the codebase would start seeing values it has no idea about.
   */
  it("does not let a lifecycle value pass as a booking payment status", () => {
    expect(isPaymentStatus("AWAITING_PAYMENT")).toBe(false);
    expect(isPaymentStatus("PROCESSING")).toBe(false);
    expect(isPaymentStatus("FAILED")).toBe(false);
    expect(isPaymentStatus("CANCELLED")).toBe(false);

    // The four that ARE booking statuses.
    for (const v of PAYMENT_STATUSES) expect(isPaymentStatus(v)).toBe(true);
  });

  it("accepts every lifecycle value and nothing else", () => {
    for (const v of PAYMENT_LIFECYCLE) expect(isPaymentLifecycle(v)).toBe(true);
    expect(isPaymentLifecycle("NONE")).toBe(false);
    expect(isPaymentLifecycle("paid")).toBe(false);
    expect(isPaymentLifecycle(undefined)).toBe(false);
  });

  it("knows which statuses are settled for good", () => {
    expect(isTerminalPayment("PAID")).toBe(true);
    expect(isTerminalPayment("FAILED")).toBe(true);
    expect(isTerminalPayment("CANCELLED")).toBe(true);
    expect(isTerminalPayment("REFUNDED")).toBe(true);

    expect(isTerminalPayment("PENDING")).toBe(false);
    expect(isTerminalPayment("AWAITING_PAYMENT")).toBe(false);
    expect(isTerminalPayment("PROCESSING")).toBe(false);
  });
});

describe("provider status mapping", () => {
  const TELR: Record<string, PaymentLifecycle> = {
    "3": "PAID",
    "2": "PROCESSING",
    "0": "FAILED",
    "-2": "CANCELLED",
  };

  it("maps a known code onto the internal lifecycle", () => {
    expect(toInternalStatus("3", TELR)).toBe("PAID");
    expect(toInternalStatus("2", TELR)).toBe("PROCESSING");
    expect(toInternalStatus("0", TELR)).toBe("FAILED");
    expect(toInternalStatus("-2", TELR)).toBe("CANCELLED");
  });

  it("is case- and whitespace-insensitive", () => {
    const table: Record<string, PaymentLifecycle> = { CAPTURED: "PAID" };
    expect(toInternalStatus(" captured ", table)).toBe("PAID");
    expect(toInternalStatus("Captured", table)).toBe("PAID");
  });

  /**
   * The most important assertion in this file.
   *
   * A gateway that invents a status code this build has never seen must not
   * confirm a booking nobody paid for, and must not cancel one that has been
   * paid. "PROCESSING" is neither: the booking stays unconfirmed, the money
   * stays in flight, and a later delivery or a reconciliation poll can still
   * resolve it.
   */
  it("falls back to PROCESSING for anything unrecognised — never PAID, never FAILED", () => {
    for (const unknown of ["", "  ", "WAT", "99", "SUCCESS", "OK", "TRUE"]) {
      expect(toInternalStatus(unknown, TELR)).toBe("PROCESSING");
    }
    expect(toInternalStatus(null, TELR)).toBe("PROCESSING");
    expect(toInternalStatus(undefined, TELR)).toBe("PROCESSING");
  });

  it("normalises a stored value the same way", () => {
    expect(toPaymentLifecycle("PAID")).toBe("PAID");
    expect(toPaymentLifecycle("WRITTEN_BY_A_FUTURE_BUILD")).toBe("PROCESSING");
    expect(toPaymentLifecycle(null)).toBe("PROCESSING");
  });
});

describe("status transitions", () => {
  it("moves forward through the in-flight statuses", () => {
    expect(canTransition("PENDING", "AWAITING_PAYMENT")).toBe(true);
    expect(canTransition("AWAITING_PAYMENT", "PROCESSING")).toBe(true);
    expect(canTransition("PROCESSING", "PAID")).toBe(true);
    expect(canTransition("AWAITING_PAYMENT", "FAILED")).toBe(true);
  });

  /**
   * The rule that makes late and out-of-order deliveries safe.
   *
   * A gateway's "expired" notification arriving after a successful capture is
   * ordinary retry behaviour, and applying it would cancel a booking the guest
   * has already paid for and re-open the rest house to somebody else.
   */
  it("never overwrites a terminal status", () => {
    for (const from of ["PAID", "FAILED", "CANCELLED", "REFUNDED"]) {
      for (const to of PAYMENT_LIFECYCLE) {
        if (to === "REFUNDED") continue; // the one legal exception, below
        expect(canTransition(from, to)).toBe(false);
      }
    }
  });

  it("allows a refund, and only out of PAID", () => {
    expect(canTransition("PAID", "REFUNDED")).toBe(true);
    expect(canTransition("FAILED", "REFUNDED")).toBe(false);
    expect(canTransition("CANCELLED", "REFUNDED")).toBe(false);
    expect(canTransition("PROCESSING", "REFUNDED")).toBe(false);
    expect(canTransition("REFUNDED", "REFUNDED")).toBe(false);
  });

  it("treats a no-op as no transition, so a repeated delivery changes nothing", () => {
    for (const s of PAYMENT_LIFECYCLE) expect(canTransition(s, s)).toBe(false);
  });
});

describe("the booking-level roll-up", () => {
  it("is NONE when there are no attempts at all", () => {
    expect(rollUpPaymentStatus([])).toBe("NONE");
  });

  it("is PAID when any attempt settled", () => {
    expect(rollUpPaymentStatus([{ status: "PAID" }])).toBe("PAID");
  });

  /**
   * The sequence a guest produces by pressing "pay again" on a page they left
   * open: a successful charge, then a decline. Taking the latest attempt would
   * downgrade a paid booking to unpaid.
   */
  it("keeps PAID when a later attempt fails", () => {
    expect(rollUpPaymentStatus([{ status: "PAID" }, { status: "FAILED" }])).toBe("PAID");
    expect(rollUpPaymentStatus([{ status: "FAILED" }, { status: "PAID" }])).toBe("PAID");
  });

  it("reports PENDING only while money is actually in flight", () => {
    expect(rollUpPaymentStatus([{ status: "AWAITING_PAYMENT" }])).toBe("PENDING");
    expect(rollUpPaymentStatus([{ status: "PROCESSING" }])).toBe("PENDING");
    expect(rollUpPaymentStatus([{ status: "PENDING" }])).toBe("PENDING");
  });

  /**
   * A declined card is not money on its way. An operator chasing the pending
   * list should not find a booking whose only attempt bounced.
   */
  it("reports NONE — not PENDING — for a booking whose attempts all failed", () => {
    expect(rollUpPaymentStatus([{ status: "FAILED" }])).toBe("NONE");
    expect(rollUpPaymentStatus([{ status: "CANCELLED" }])).toBe("NONE");
    expect(rollUpPaymentStatus([{ status: "FAILED" }, { status: "CANCELLED" }])).toBe("NONE");
  });

  it("lets a refund outrank the payment it reversed", () => {
    expect(rollUpPaymentStatus([{ status: "PAID" }, { status: "REFUNDED" }])).toBe("REFUNDED");
  });

  it("picks the settled attempt's reference, not the most recent one", () => {
    const older = new Date("2026-01-01T00:00:00Z");
    const newer = new Date("2026-02-01T00:00:00Z");

    expect(
      rollUpPaymentReference([
        { status: "FAILED", providerRef: "decline-ref", createdAt: newer },
        { status: "PAID", providerRef: "settled-ref", createdAt: older },
      ]),
    ).toBe("settled-ref");
  });

  it("falls back to the newest reference when nothing has settled", () => {
    const older = new Date("2026-01-01T00:00:00Z");
    const newer = new Date("2026-02-01T00:00:00Z");

    expect(
      rollUpPaymentReference([
        { status: "FAILED", providerRef: "old", createdAt: older },
        { status: "AWAITING_PAYMENT", providerRef: "new", createdAt: newer },
      ]),
    ).toBe("new");

    expect(rollUpPaymentReference([])).toBeNull();
  });
});

describe("event keys", () => {
  it("is stable for the same delivery, so a retry is recognised", () => {
    expect(eventKey("TELR", "ref-1", "3", "WEBHOOK")).toBe(
      eventKey("TELR", "ref-1", "3", "WEBHOOK"),
    );
  });

  it("differs for a genuine progression on the same payment", () => {
    expect(eventKey("TELR", "ref-1", "2", "WEBHOOK")).not.toBe(
      eventKey("TELR", "ref-1", "3", "WEBHOOK"),
    );
  });

  it("differs across providers and across delivery kinds", () => {
    expect(eventKey("TELR", "ref-1", "3", "WEBHOOK")).not.toBe(
      eventKey("TABBY", "ref-1", "3", "WEBHOOK"),
    );
    expect(eventKey("TELR", "ref-1", "3", "WEBHOOK")).not.toBe(
      eventKey("TELR", "ref-1", "3", "RETURN"),
    );
  });

  /**
   * The separator matters: without it, ("a","bc") and ("ab","c") would collide,
   * and two different payments could share one event key — which under the
   * unique index means the second one is silently dropped.
   */
  it("does not collide across differently-split parts", () => {
    expect(eventKey("a", "bc")).not.toBe(eventKey("ab", "c"));
  });
});

describe("the three gates", () => {
  /**
   * The state of every deployment today, and the assertion that matters most
   * for shipping this: no credentials are set anywhere in the environment, so
   * nothing can be reached however the switches are set.
   */
  it("offers no gateway without credentials, whatever the switches say", () => {
    const all = settings({
      depositPaymentsEnabled: true,
      telrEnabled: true,
      tabbyEnabled: true,
      tamaraEnabled: true,
      paymentLinksEnabled: true,
    });

    expect(hasCredentials("TELR")).toBe(false);
    expect(hasCredentials("TABBY")).toBe(false);
    expect(hasCredentials("TAMARA")).toBe(false);
    expect(availableProviders(all)).toEqual([]);
    expect(isDepositPaymentEnabled(all)).toBe(false);
    expect(depositPaymentStatus(all)).toBe("MISCONFIGURED");
  });

  it("reports which gate each provider is stuck on", () => {
    expect(providerState(settings(), "TELR")).toBe("OFF_GLOBALLY");

    const globalOn = settings({ depositPaymentsEnabled: true });
    expect(providerState(globalOn, "TELR")).toBe("DISABLED");

    const telrOn = settings({ depositPaymentsEnabled: true, telrEnabled: true });
    expect(providerState(telrOn, "TELR")).toBe("MISCONFIGURED");
  });

  it("treats the global switch as a hard stop", () => {
    const providerOnly = settings({ telrEnabled: true, tabbyEnabled: true });
    expect(onlinePaymentsEnabled(providerOnly)).toBe(false);
    expect(availableProviders(providerOnly)).toEqual([]);
    expect(depositPaymentStatus(providerOnly)).toBe("DISABLED");
  });

  /**
   * MANUAL needs no credentials and is never gated — it is the owner's own bank
   * account, and it is what this platform has always done.
   */
  it("never gates the manual path", () => {
    expect(hasCredentials("MANUAL")).toBe(true);
    expect(platformPaymentModes(settings())).toEqual(["MANUAL"]);
  });
});

describe("what crosses to the browser", () => {
  /**
   * `publicPaymentConfig` is handed to a client component, so its shape is the
   * security boundary. Booleans and state codes — never a key, never a partial
   * key, never a hint at one.
   */
  it("carries booleans and state codes only", () => {
    const config = publicPaymentConfig(
      settings({ depositPaymentsEnabled: true, telrEnabled: true }),
    );

    expect(config).toEqual({
      onlinePayments: true,
      paymentLinks: false,
      providers: {
        TELR: "MISCONFIGURED",
        TABBY: "DISABLED",
        TAMARA: "DISABLED",
      },
    });

    // Nothing anywhere in it looks like a credential.
    const serialised = JSON.stringify(config);
    for (const secret of ["KEY", "SECRET", "TOKEN", "AUTH", "storeId"]) {
      expect(serialised.toUpperCase()).not.toContain(secret.toUpperCase());
    }
  });
});

describe("per-listing payment modes", () => {
  /**
   * With a gateway configured, so there is something for a listing to narrow.
   * `availableProviders` still returns [] in this process — no credentials — so
   * the platform list is built here from a stub that reports one.
   */
  const twoModes = ["MANUAL", "ONLINE"];

  it("inherits the platform list when the column is null", () => {
    expect(resolveListingPaymentModes(null, settings())).toEqual(["MANUAL"]);
    expect(resolveListingPaymentModes(undefined, settings())).toEqual(["MANUAL"]);
  });

  /**
   * The distinction the nullable column exists for, and the exact trap
   * `resolveDepositPercent` documents: a truthiness check would treat "[]" as
   * unset and silently re-enable a checkout the owner switched off.
   */
  it("treats null and [] as different answers", () => {
    expect(parseListingPaymentModes(null)).toBeNull();
    expect(parseListingPaymentModes("[]")).toEqual([]);
    expect(parseListingPaymentModes('["MANUAL","ONLINE"]')).toEqual(["MANUAL", "ONLINE"]);
  });

  it("drops ids it does not recognise rather than storing them", () => {
    expect(parseListingPaymentModes('["MANUAL","CRYPTO","ONLINE"]')).toEqual([
      "MANUAL",
      "ONLINE",
    ]);
    expect(parseListingPaymentModes("not json at all")).toEqual([]);
  });

  /**
   * A listing cannot widen the platform's list. A stale column written while a
   * gateway was live must not keep offering a checkout after it is switched
   * off — which is why the resolution intersects rather than trusting the
   * stored value.
   */
  it("can only ever narrow the platform's list, never widen it", () => {
    const s = settings();
    expect(resolveListingPaymentModes('["MANUAL","ONLINE","LINK"]', s)).toEqual(["MANUAL"]);
    expect(isModeAvailable("ONLINE", '["ONLINE"]', s)).toBe(false);
  });

  /** A rest house that can be booked by nobody is not a reachable state. */
  it("always leaves the manual path open", () => {
    expect(resolveListingPaymentModes("[]", settings())).toEqual(["MANUAL"]);
    expect(isModeAvailable("MANUAL", "[]", settings())).toBe(true);
  });

  /**
   * Ticking every box stores null, not the list — so a gateway connected next
   * month reaches the listings whose owners already said "all of them".
   */
  it("stores null when the choice is everything currently offered", () => {
    expect(serializeListingPaymentModes(["MANUAL"], settings())).toBeNull();
    expect(serializeListingPaymentModes(twoModes, settings())).toBeNull();
  });

  it("rejects a mode the platform does not offer, even when posted directly", () => {
    // A hand-crafted POST naming ONLINE on a site with no gateway.
    expect(serializeListingPaymentModes(["ONLINE"], settings())).toBe("[]");
    expect(isModeAvailable("ONLINE", null, settings())).toBe(false);
  });

  /**
   * The regression that made this marker necessary.
   *
   * While the platform offers one mode the editor draws no checkbox group, so
   * the form posts nothing — and unticking every box posts nothing either.
   * Serialising the empty post would have written "[]" ("takes nothing online")
   * onto every listing anyone edited, and those listings alone would then have
   * refused online payment on the day a gateway was switched on.
   */
  it("distinguishes 'nothing was posted' from 'the owner chose none'", () => {
    const s = settings();

    // The owner deliberately unticked everything — a real choice.
    expect(serializeListingPaymentModes([], s)).toBe("[]");

    // And the marker is what tells the save path which case it is looking at.
    expect(PAYMENT_MODES_FIELD).toBe("paymentModesPresent");
  });

  it("refuses an id that is not a payment mode at all", () => {
    expect(isModeAvailable("BITCOIN", null, settings())).toBe(false);
    expect(isModeAvailable("", null, settings())).toBe(false);
  });
});
