import { timingSafeEqual } from "node:crypto";
import type { PaymentLifecycle } from "@/lib/constants";
import { tamaraConfig, type TamaraConfig } from "../config";
import { eventKey, toInternalStatus } from "../status";
import type {
  CallbackRequest,
  CallbackResult,
  CheckoutRequest,
  CheckoutResult,
  PaymentProvider,
  ProviderError,
  VerifyRequest,
  VerifyResult,
} from "../types";

/**
 * Tamara — the second buy-now-pay-later provider, also at the PLATFORM level.
 *
 * The reasoning is identical to Tabby's and is written out in full at the top
 * of ./tabby.ts: a Tamara merchant account needs a commercial registration,
 * most rest house owners here do not have one, so the guest pays Rihla through
 * Rihla's own approved account and the `Payment` row's `bookingId` is what ties
 * the money to the right rest house. There is no per-owner credential anywhere.
 *
 * ─── STATUS: BLOCKED ON COMMERCIAL APPROVAL ─────────────────────────────────
 * No merchant account, no approval, never executed. Written to Tamara's
 * documented Checkout API and gated three ways so it cannot be reached until
 * credentials exist.
 *
 * `TAMARA_API_URL` defaults to the sandbox host rather than production, so a
 * deployment that acquires a token but has not decided which environment it is
 * in points at the sandbox — the same direction every other default in this
 * subsystem leans.
 *
 * What needs checking on the day an account exists:
 *   * Tamara's notification token is a shared bearer value rather than an HMAC
 *     over the body, so `parseCallback` compares tokens in constant time; if
 *     the account is provisioned for signed webhooks instead, that check
 *     changes shape
 *   * whether the merchant is on authorise-then-capture, which decides whether
 *     "authorised" should stay PROCESSING (it does here — the safe direction)
 *   * the minimum and maximum order values the account is approved for
 */

/** Tamara's order statuses → the internal lifecycle. */
const TAMARA_STATUS: Record<string, PaymentLifecycle> = {
  NEW: "AWAITING_PAYMENT",
  APPROVED: "PROCESSING",
  AUTHORISED: "PROCESSING",
  AUTHORIZED: "PROCESSING",
  FULLY_CAPTURED: "PAID",
  CAPTURED: "PAID",
  DECLINED: "FAILED",
  EXPIRED: "CANCELLED",
  CANCELED: "CANCELLED",
  CANCELLED: "CANCELLED",
  FULLY_REFUNDED: "REFUNDED",
  REFUNDED: "REFUNDED",
};

function notConfigured(): ProviderError {
  return {
    ok: false,
    code: "NOT_CONFIGURED",
    message: "TAMARA_API_TOKEN is not set in the environment.",
  };
}

/**
 * Tamara wants `{ amount: "1500.00", currency: "AED" }`.
 *
 * The one place this conversion happens for Tamara — see the same note in the
 * Telr and Tabby adapters.
 */
function money(whole: number, currency: string) {
  return { amount: whole.toFixed(2), currency };
}

async function callApi(
  config: TamaraConfig,
  path: string,
  init: { method: string; body?: unknown },
): Promise<{ ok: true; data: Record<string, unknown> } | ProviderError> {
  let response: Response;
  try {
    response = await fetch(`${config.apiUrl}${path}`, {
      method: init.method,
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${config.apiToken}`,
      },
      body: init.body ? JSON.stringify(init.body) : undefined,
      signal: AbortSignal.timeout(20_000),
    });
  } catch (error) {
    return {
      ok: false,
      code: "NETWORK",
      message: `Tamara request failed: ${error instanceof Error ? error.message : "unknown"}`,
    };
  }

  if (response.status === 404) {
    return { ok: false, code: "NOT_FOUND", message: `Tamara has no record at ${path}.` };
  }

  let data: Record<string, unknown>;
  try {
    data = (await response.json()) as Record<string, unknown>;
  } catch {
    return {
      ok: false,
      code: "NETWORK",
      message: `Tamara returned a non-JSON body (HTTP ${response.status}).`,
    };
  }

  if (!response.ok) {
    return {
      ok: false,
      code: "REJECTED",
      message: `Tamara rejected the request (HTTP ${response.status}): ${JSON.stringify(data).slice(0, 300)}`,
    };
  }

  return { ok: true, data };
}

export const tamaraProvider: PaymentProvider = {
  id: "TAMARA",

  async createCheckout(input: CheckoutRequest): Promise<CheckoutResult> {
    const config = tamaraConfig();
    if (!config) return notConfigured();

    const result = await callApi(config, "/checkout", {
      method: "POST",
      body: {
        // Our own `Payment.id` — the merchant reference a notification carries
        // back, and what binds this money to one booking.
        order_reference_id: input.paymentId,
        order_number: input.bookingReference,
        total_amount: money(input.amount, input.currency),
        description: input.listingName,
        country_code: "AE",
        payment_type: "PAY_BY_INSTALMENTS",
        locale: input.locale === "ar" ? "ar_AE" : "en_US",
        items: [
          {
            name: input.listingName,
            type: "Accommodation",
            reference_id: input.bookingReference,
            sku: input.bookingReference,
            quantity: 1,
            unit_price: money(input.amount, input.currency),
            total_amount: money(input.amount, input.currency),
          },
        ],
        consumer: {
          // Tamara wants the name split; rest house guests give one field, so
          // the whole name goes in `first_name` rather than being guessed at.
          // A wrong surname on a credit application is worse than an empty one.
          first_name: input.customerName,
          last_name: "",
          phone_number: input.customerPhone,
          email: input.customerEmail ?? "",
        },
        merchant_url: {
          success: input.returnUrl,
          failure: input.returnUrl,
          cancel: input.cancelUrl,
          notification: input.webhookUrl,
        },
      },
    });
    if (!result.ok) return result;

    const orderId = typeof result.data.order_id === "string" ? result.data.order_id : "";
    const url = typeof result.data.checkout_url === "string" ? result.data.checkout_url : "";

    if (!orderId || !url) {
      return {
        ok: false,
        code: "REJECTED",
        message: "Tamara accepted the order but returned no order_id/checkout_url.",
      };
    }

    return {
      ok: true,
      providerRef: orderId,
      checkoutUrl: url,
      providerStatus: "NEW",
      metadata: { testMode: config.testMode },
    };
  },

  async verifyPayment(input: VerifyRequest): Promise<VerifyResult> {
    const config = tamaraConfig();
    if (!config) return notConfigured();

    const result = await callApi(
      config,
      `/orders/${encodeURIComponent(input.providerRef)}`,
      { method: "GET" },
    );
    if (!result.ok) return result;

    const raw = typeof result.data.status === "string" ? result.data.status : "";
    const total = result.data.total_amount as { amount?: unknown; currency?: unknown } | undefined;
    const amount = Number.parseFloat(String(total?.amount ?? ""));

    return {
      ok: true,
      status: toInternalStatus(raw, TAMARA_STATUS),
      providerStatus: raw || "UNKNOWN",
      method: "BNPL",
      paidAmount: Number.isFinite(amount) ? Math.round(amount) : undefined,
      paidCurrency: typeof total?.currency === "string" ? total.currency : undefined,
      metadata: { testMode: config.testMode },
    };
  },

  /**
   * Authenticate a Tamara notification.
   *
   * Tamara's notification token is a shared bearer value rather than an HMAC
   * over the body, so what is compared is the token itself — in constant time,
   * because a naive `===` on a secret is a timing oracle. As with Tabby, a
   * missing token refuses the delivery rather than waving it through: a check
   * that configuration can switch off is not a check.
   *
   * And as with every provider here, the payload's claimed status is advisory.
   * The reference is taken from it and `verifyPayment` decides what actually
   * happened.
   */
  async parseCallback(input: CallbackRequest): Promise<CallbackResult> {
    const config = tamaraConfig();
    if (!config) return notConfigured();

    if (input.kind === "WEBHOOK") {
      if (!config.notificationToken) {
        return {
          ok: false,
          code: "NOT_CONFIGURED",
          message: "TAMARA_NOTIFICATION_TOKEN is not set; refusing to trust the delivery.",
        };
      }
      const presented = (input.headers["authorization"] ?? "").replace(/^Bearer\s+/i, "").trim();
      if (!constantTimeEquals(presented, config.notificationToken)) {
        return { ok: false, code: "UNVERIFIED", message: "Tamara notification token mismatch." };
      }
    }

    let body: Record<string, unknown> = {};
    try {
      body = input.rawBody ? (JSON.parse(input.rawBody) as Record<string, unknown>) : {};
    } catch {
      body = {};
    }

    const ref =
      (typeof body.order_id === "string" ? body.order_id : undefined) ??
      input.query.orderId ??
      input.query.order_id;

    if (!ref) {
      return { ok: false, code: "NOT_FOUND", message: "Tamara callback carried no order_id." };
    }

    const claimed =
      (typeof body.order_status === "string" ? body.order_status : undefined) ??
      (typeof body.status === "string" ? body.status : "");

    return {
      ok: true,
      providerRef: ref,
      eventId: eventKey("TAMARA", ref, claimed, input.kind),
      providerStatus: claimed || undefined,
    };
  },

  async queryStatus(input: VerifyRequest): Promise<VerifyResult> {
    return tamaraProvider.verifyPayment(input);
  },
};

function constantTimeEquals(a: string, b: string): boolean {
  if (!a || !b) return false;
  const bufA = Buffer.from(a, "utf8");
  const bufB = Buffer.from(b, "utf8");
  // Length is compared first because `timingSafeEqual` throws on a mismatch,
  // and the throw would itself reveal the expected length.
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}
