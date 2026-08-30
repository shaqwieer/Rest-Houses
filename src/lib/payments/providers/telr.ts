import type { PaymentLifecycle, PaymentMethod } from "@/lib/constants";
import { telrConfig, type TelrConfig } from "../config";
import { eventKey, toInternalStatus } from "../status";
import type {
  CallbackRequest,
  CallbackResult,
  CheckoutRequest,
  CheckoutResult,
  PaymentProvider,
  ProviderError,
  RefundRequest,
  RefundResult,
  VerifyRequest,
  VerifyResult,
} from "../types";

/**
 * Telr — the UAE card gateway, and this platform's primary one.
 *
 * Written against Telr's documented Hosted Payment Page ("Order API") flow:
 *
 *   1. POST /gateway/order.json  with ivp_method=create  → an order reference
 *      and a hosted page URL
 *   2. the guest is redirected to that URL and enters their card THERE
 *   3. the guest comes back to `ivp_framed`/return URL, and Telr calls the
 *      transaction-advice URL
 *   4. POST /gateway/order.json  with ivp_method=check   → the authoritative
 *      status of that order reference
 *
 * Step 4 is the one that decides anything. Steps 2 and 3 are notifications;
 * this adapter treats both as "go and ask" and never as "it is paid".
 *
 * ─── STATUS: NOT EXERCISED AGAINST A MERCHANT ACCOUNT ───────────────────────
 * No Telr store id or auth key exists for this platform yet, so nothing in this
 * file has ever run against the real gateway — not in sandbox and not in
 * production. It is written to the documented contract and is structurally
 * complete, and that is a different claim from "it works".
 *
 * What will need checking on the day credentials arrive, because these are the
 * parts a contract cannot settle:
 *   * the exact field names in the `check` response (`order.status.code` vs a
 *     flat `status`) — see `readOrder` below, which is tolerant of both
 *   * whether the merchant account reports Apple Pay / Samsung Pay distinctly
 *     in `transaction.class`, or folds them into a card transaction
 *   * whether the advice callback is a form POST or JSON — `parseCallback`
 *     accepts either
 *   * the sandbox test card numbers, which are per-merchant
 *
 * Nothing else in this codebase needs to change when that happens. That is the
 * whole point of the adapter boundary.
 *
 * ─── Cards ──────────────────────────────────────────────────────────────────
 * This file never sees a card number. Telr hosts the payment page; what comes
 * back is a reference, a status and — at most — the last four digits, which is
 * what keeps this application out of PCI scope.
 */

const ORDER_API = "https://secure.telr.com/gateway/order.json";

/** Telr's currency for the UAE. */
const CURRENCY = "AED";

/**
 * Telr's order status codes → the internal lifecycle.
 *
 * Telr reports both a numeric `code` and a `text`, and different endpoints
 * favour different ones, so both spellings are mapped onto the same values. A
 * code this table does not know resolves to PROCESSING — never to PAID and
 * never to FAILED. See the note on `toInternalStatus`.
 */
const TELR_STATUS: Record<string, PaymentLifecycle> = {
  // -1 / 1 — the order exists and is waiting for the guest.
  "-1": "AWAITING_PAYMENT",
  "1": "AWAITING_PAYMENT",
  PENDING: "AWAITING_PAYMENT",
  // 2 — authorised. Money is committed but not captured; treated as PROCESSING
  // rather than PAID, because an authorisation that is never captured is not a
  // payment and a booking must not be confirmed on one.
  "2": "PROCESSING",
  AUTHORISED: "PROCESSING",
  AUTHORIZED: "PROCESSING",
  // 3 — paid / captured. The only route to PAID.
  "3": "PAID",
  PAID: "PAID",
  CAPTURED: "PAID",
  // -2 / -3 — cancelled or expired.
  "-2": "CANCELLED",
  "-3": "CANCELLED",
  CANCELLED: "CANCELLED",
  EXPIRED: "CANCELLED",
  // 0 / declined.
  "0": "FAILED",
  DECLINED: "FAILED",
  FAILED: "FAILED",
};

/** Telr's transaction class → what the guest paid with. */
function toMethod(raw: string | undefined): PaymentMethod | undefined {
  if (!raw) return undefined;
  const v = raw.toLowerCase();
  if (v.includes("apple")) return "APPLE_PAY";
  if (v.includes("samsung")) return "SAMSUNG_PAY";
  if (v.includes("google")) return "GOOGLE_PAY";
  if (v.includes("ecom") || v.includes("card") || v.includes("moto")) return "CARD";
  return "OTHER";
}

function notConfigured(): ProviderError {
  return {
    ok: false,
    code: "NOT_CONFIGURED",
    message: "TELR_STORE_ID / TELR_AUTH_KEY are not set in the environment.",
  };
}

/**
 * Telr quotes amounts as a decimal string ("1500.00").
 *
 * Every stored amount in this application is whole dirhams (see the schema's
 * note on `Payment`), and this is the ONLY place that conversion happens for
 * Telr. Keeping it here rather than at a call site is what stops two callers
 * rounding the same figure differently.
 */
function toTelrAmount(whole: number): string {
  return whole.toFixed(2);
}

/** And back — tolerant of "1500", "1500.00" and 1500. */
function fromTelrAmount(raw: unknown): number | undefined {
  const n = typeof raw === "number" ? raw : Number.parseFloat(String(raw ?? ""));
  return Number.isFinite(n) ? Math.round(n) : undefined;
}

/**
 * One call to the Order API.
 *
 * A network failure is a `NETWORK` result rather than a thrown error: this runs
 * on the webhook path, where an exception becomes a 500 and earns a retry storm
 * for something a retry will not fix.
 */
async function callOrderApi(
  config: TelrConfig,
  body: Record<string, unknown>,
): Promise<{ ok: true; data: Record<string, unknown> } | ProviderError> {
  let response: Response;
  try {
    response = await fetch(ORDER_API, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        ivp_store: config.storeId,
        ivp_authkey: config.authKey,
        // Telr's own sandbox switch. Defaults on — see `TelrConfig.testMode`.
        ivp_test: config.testMode ? "1" : "0",
        ...body,
      }),
      // Telr is a synchronous redirect gateway; a request that has not answered
      // in 20 seconds will not be answered. Without a timeout this would hold a
      // server action open until the platform's own request timeout.
      signal: AbortSignal.timeout(20_000),
    });
  } catch (error) {
    return {
      ok: false,
      code: "NETWORK",
      message: `Telr request failed: ${error instanceof Error ? error.message : "unknown"}`,
    };
  }

  let data: Record<string, unknown>;
  try {
    data = (await response.json()) as Record<string, unknown>;
  } catch {
    return {
      ok: false,
      code: "NETWORK",
      message: `Telr returned a non-JSON body (HTTP ${response.status}).`,
    };
  }

  // Telr reports business errors in a 200 body, so the HTTP status is not the
  // question — an `error` object is.
  const error = data.error as { message?: string; note?: string } | undefined;
  if (error) {
    return {
      ok: false,
      code: "REJECTED",
      message: `Telr rejected the request: ${error.message ?? ""} ${error.note ?? ""}`.trim(),
    };
  }

  return { ok: true, data };
}

/**
 * Pull the status, amount and method out of a `check` response.
 *
 * Written to accept both response shapes Telr's documentation shows — a nested
 * `order.status.{code,text}` and a flatter form — because which one a store
 * returns is exactly the sort of thing that differs per merchant and cannot be
 * settled without an account. Tolerating both here costs a few lines and means
 * the first live call does not fail on a field name.
 */
function readOrder(data: Record<string, unknown>) {
  const order = (data.order ?? data) as Record<string, unknown>;
  const status = order.status as { code?: unknown; text?: unknown } | undefined;

  const rawStatus =
    status?.code !== undefined && status.code !== null
      ? String(status.code)
      : status?.text !== undefined && status.text !== null
        ? String(status.text)
        : typeof order.status === "string"
          ? order.status
          : "";

  const transaction = order.transaction as Record<string, unknown> | undefined;
  const card = order.card as Record<string, unknown> | undefined;

  return {
    rawStatus,
    ref: typeof order.ref === "string" ? order.ref : undefined,
    amount: fromTelrAmount(order.amount),
    currency: typeof order.currency === "string" ? order.currency : undefined,
    method: toMethod(
      typeof transaction?.class === "string" ? transaction.class : undefined,
    ),
    // The last four digits only — never a PAN. Telr does not return one.
    last4: typeof card?.last4 === "string" ? card.last4 : undefined,
    cardType: typeof card?.type === "string" ? card.type : undefined,
    declineMessage:
      typeof transaction?.message === "string" ? transaction.message : undefined,
  };
}

export const telrProvider: PaymentProvider = {
  id: "TELR",

  async createCheckout(input: CheckoutRequest): Promise<CheckoutResult> {
    const config = telrConfig();
    if (!config) return notConfigured();

    // Telr's cart id is the merchant's own reference and is what comes back on
    // every subsequent call. Our `Payment.id` goes here, so a callback resolves
    // to exactly one row — and to one BOOKING, since a payment row belongs to
    // one booking and nothing can move it.
    const result = await callOrderApi(config, {
      ivp_method: "create",
      ivp_cart: input.paymentId,
      ivp_amount: toTelrAmount(input.amount),
      ivp_currency: input.currency || CURRENCY,
      ivp_desc: `${input.listingName} — ${input.bookingReference}`,
      ivp_lang: input.locale === "ar" ? "ar" : "en",
      return_auth: input.returnUrl,
      return_can: input.cancelUrl,
      return_decl: input.returnUrl,
      // Telr's server-to-server advice. The route it names verifies before it
      // believes anything — see src/app/api/payments/[provider]/webhook/route.ts.
      ivp_trantype: "sale",
      ivp_trancurr: input.currency || CURRENCY,
      tran_url: input.webhookUrl,
      bill_fname: input.customerName,
      bill_phone1: input.customerPhone,
      ...(input.customerEmail ? { bill_email: input.customerEmail } : {}),
      bill_country: "AE",
    });

    if (!result.ok) return result;

    const order = result.data.order as { ref?: unknown; url?: unknown } | undefined;
    const ref = typeof order?.ref === "string" ? order.ref : "";
    const url = typeof order?.url === "string" ? order.url : "";

    if (!ref || !url) {
      return {
        ok: false,
        code: "REJECTED",
        message: "Telr accepted the order but returned no ref/url.",
      };
    }

    return {
      ok: true,
      providerRef: ref,
      checkoutUrl: url,
      providerStatus: "CREATED",
      metadata: { testMode: config.testMode },
    };
  },

  /**
   * Ask Telr what actually happened.
   *
   * The only thing in this adapter whose answer is allowed to mark a booking
   * paid. `expectedAmount` is passed through to the caller rather than enforced
   * here — the adapter reports what the gateway said, and `settlePayment()` in
   * ../service.ts is the single place that decides whether that matches what
   * was owed. One decision point, not one per gateway.
   */
  async verifyPayment(input: VerifyRequest): Promise<VerifyResult> {
    const config = telrConfig();
    if (!config) return notConfigured();

    const result = await callOrderApi(config, {
      ivp_method: "check",
      order_ref: input.providerRef,
    });
    if (!result.ok) return result;

    const order = readOrder(result.data);
    if (!order.rawStatus) {
      return {
        ok: false,
        code: "NOT_FOUND",
        message: `Telr returned no status for order ${input.providerRef}.`,
      };
    }

    return {
      ok: true,
      status: toInternalStatus(order.rawStatus, TELR_STATUS),
      providerStatus: order.rawStatus,
      method: order.method,
      paidAmount: order.amount,
      paidCurrency: order.currency,
      failureReason: order.declineMessage,
      metadata: {
        last4: order.last4,
        cardType: order.cardType,
        testMode: config.testMode,
      },
    };
  },

  /**
   * Read a delivery — Telr's transaction advice, or the guest's browser on the
   * return URL.
   *
   * Extracts the order reference and stops. It does NOT report a status, even
   * though the payload carries one, because neither delivery is authenticated:
   * Telr's advice call has no signature, and the return URL is a plain
   * redirect anyone can type. The service layer takes the reference from here
   * and calls `verifyPayment` — which is an outbound call to Telr with our own
   * auth key, and is the only thing that can be trusted.
   *
   * `eventId` is a digest of the reference and the claimed status, so the same
   * advice retried is one event while a genuine progression (authorised, then
   * captured) is two.
   */
  async parseCallback(input: CallbackRequest): Promise<CallbackResult> {
    const fields = readCallbackFields(input);

    const ref =
      fields.order_ref ??
      fields.tran_ref ??
      fields.ref ??
      // Telr echoes the merchant cart id; useful as a fallback but NOT as the
      // primary key, because `providerRef` is what the unique index is on.
      undefined;

    if (!ref) {
      return {
        ok: false,
        code: "NOT_FOUND",
        message: "Telr callback carried no order reference.",
      };
    }

    const claimed = fields.status ?? fields.tran_status ?? "";

    return {
      ok: true,
      providerRef: ref,
      eventId: eventKey("TELR", ref, claimed, input.kind),
      providerStatus: claimed || undefined,
    };
  },

  async queryStatus(input: VerifyRequest): Promise<VerifyResult> {
    return telrProvider.verifyPayment(input);
  },

  /**
   * Telr supports refunds through the same Order API.
   *
   * Implemented to the documented contract and, like everything else here,
   * never executed. A refund also has a business side this function does not
   * touch — the `Payment` row moves to REFUNDED through `refundPayment()` in
   * ../service.ts, which is where the booking roll-up and the audit entry
   * happen.
   */
  async refund(input: RefundRequest): Promise<RefundResult> {
    const config = telrConfig();
    if (!config) return notConfigured();

    const result = await callOrderApi(config, {
      ivp_method: "refund",
      order_ref: input.providerRef,
      ivp_amount: toTelrAmount(input.amount),
      ivp_currency: input.currency || CURRENCY,
      ivp_desc: input.reason.slice(0, 120),
    });
    if (!result.ok) return result;

    const order = readOrder(result.data);
    return { ok: true, providerRef: input.providerRef, providerStatus: order.rawStatus };
  },
};

/**
 * Flatten a delivery into plain fields.
 *
 * Telr's advice has been documented as both a form POST and a JSON body, and
 * the return leg is a query string, so all three are read into one map rather
 * than branching at the call site on a content type that may be absent.
 */
function readCallbackFields(input: CallbackRequest): Record<string, string> {
  const out: Record<string, string> = { ...input.query };

  if (input.rawBody) {
    const contentType = input.headers["content-type"] ?? "";
    if (contentType.includes("json")) {
      try {
        const parsed: unknown = JSON.parse(input.rawBody);
        if (parsed && typeof parsed === "object") {
          for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
            if (typeof v === "string" || typeof v === "number") out[k] = String(v);
          }
        }
      } catch {
        // A malformed body is not an exception — the query string may still
        // carry the reference, and an unusable delivery is reported by the
        // absence of one rather than by a throw.
      }
    } else {
      for (const [k, v] of new URLSearchParams(input.rawBody)) out[k] = v;
    }
  }

  return out;
}
