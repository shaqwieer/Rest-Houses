import { createHmac, timingSafeEqual } from "node:crypto";
import type { PaymentLifecycle } from "@/lib/constants";
import { tabbyConfig, type TabbyConfig } from "../config";
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
 * Tabby — buy now, pay later, at the PLATFORM level.
 *
 * ─── Why this is Rihla's merchant account and not the owner's ───────────────
 * The obvious shape would have been a Tabby account per rest house, the way the
 * bank details on `SiteSettings` are per platform but the WhatsApp number is per
 * owner. It does not work here: a Tabby merchant account requires a commercial
 * registration, and a large part of this catalogue is individual owners who
 * simply do not have one. Requiring it per owner would exclude most of the rest
 * houses on the platform from ever offering instalments.
 *
 * So the guest pays *Rihla*, through Rihla's own approved account, and the
 * `Payment` row carries the `bookingId` that identifies which rest house the
 * money is for. Settlement to the owner then runs through the machinery that
 * already exists for exactly this — the handover workflow and the commission
 * at step 6 — rather than through a second money-movement system.
 *
 * There is deliberately no per-owner credential field anywhere in the schema.
 * What an owner controls is `Listing.paymentModes`: whether their rest house
 * takes online payment at all.
 *
 * ─── STATUS: BLOCKED ON COMMERCIAL APPROVAL ─────────────────────────────────
 * Rihla has no Tabby merchant account and no approval. Nothing in this file has
 * run. It is written to Tabby's documented Checkout API so that connecting one
 * later is a credential deployment rather than a development project, and it is
 * gated three ways (global switch, `SiteSettings.tabbyEnabled`, credentials
 * present) so that until then it cannot be reached at all — including by an
 * operator who ticks the box early.
 *
 * The parts that cannot be settled without an account, and must be checked on
 * the day one exists:
 *   * whether the merchant is on the pre-authorisation or the capture flow,
 *     which changes whether "AUTHORIZED" should map to PROCESSING or PAID —
 *     it is PROCESSING here, the safe direction
 *   * Tabby's rejection reasons, which are shown to the guest as a specific
 *     message and are not modelled here
 *   * whether the account is enabled for AED at these amounts
 */

const API_BASE = "https://api.tabby.ai/api/v2";

/**
 * Tabby's payment statuses → the internal lifecycle.
 *
 * AUTHORIZED maps to PROCESSING, not PAID, and that is the load-bearing line in
 * this table. On a capture-flow merchant an authorisation is a hold that has
 * not moved money; confirming a booking on one would give away a rest house for
 * a payment that can still fail at capture. If the account turns out to be on
 * the auto-capture flow, this is the single line to change.
 */
const TABBY_STATUS: Record<string, PaymentLifecycle> = {
  CREATED: "AWAITING_PAYMENT",
  NEW: "AWAITING_PAYMENT",
  AUTHORIZED: "PROCESSING",
  CLOSED: "PAID",
  CAPTURED: "PAID",
  REJECTED: "FAILED",
  EXPIRED: "CANCELLED",
  CANCELLED: "CANCELLED",
  REFUNDED: "REFUNDED",
};

function notConfigured(): ProviderError {
  return {
    ok: false,
    code: "NOT_CONFIGURED",
    message: "TABBY_PUBLIC_KEY / TABBY_SECRET_KEY are not set in the environment.",
  };
}

/**
 * Tabby quotes amounts as a decimal string in the major unit ("1500.00").
 *
 * The one place this conversion happens for Tabby, matching the note on the
 * same function in the Telr adapter.
 */
function toTabbyAmount(whole: number): string {
  return whole.toFixed(2);
}

async function callApi(
  config: TabbyConfig,
  path: string,
  init: { method: string; body?: unknown },
): Promise<{ ok: true; data: Record<string, unknown> } | ProviderError> {
  let response: Response;
  try {
    response = await fetch(`${API_BASE}${path}`, {
      method: init.method,
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${config.secretKey}`,
      },
      body: init.body ? JSON.stringify(init.body) : undefined,
      signal: AbortSignal.timeout(20_000),
    });
  } catch (error) {
    return {
      ok: false,
      code: "NETWORK",
      message: `Tabby request failed: ${error instanceof Error ? error.message : "unknown"}`,
    };
  }

  if (response.status === 404) {
    return { ok: false, code: "NOT_FOUND", message: `Tabby has no record at ${path}.` };
  }

  let data: Record<string, unknown>;
  try {
    data = (await response.json()) as Record<string, unknown>;
  } catch {
    return {
      ok: false,
      code: "NETWORK",
      message: `Tabby returned a non-JSON body (HTTP ${response.status}).`,
    };
  }

  if (!response.ok) {
    return {
      ok: false,
      code: "REJECTED",
      message: `Tabby rejected the request (HTTP ${response.status}): ${JSON.stringify(data).slice(0, 300)}`,
    };
  }

  return { ok: true, data };
}

export const tabbyProvider: PaymentProvider = {
  id: "TABBY",

  async createCheckout(input: CheckoutRequest): Promise<CheckoutResult> {
    const config = tabbyConfig();
    if (!config) return notConfigured();

    const result = await callApi(config, "/checkout", {
      method: "POST",
      body: {
        payment: {
          amount: toTabbyAmount(input.amount),
          currency: input.currency,
          description: `${input.listingName} — ${input.bookingReference}`,
          buyer: {
            phone: input.customerPhone,
            email: input.customerEmail ?? "",
            name: input.customerName,
          },
          order: {
            // Our own `Payment.id`, so a webhook resolves to exactly one row
            // and therefore to exactly one booking.
            reference_id: input.paymentId,
          },
        },
        lang: input.locale,
        merchant_code: config.publicKey,
        merchant_urls: {
          success: input.returnUrl,
          cancel: input.cancelUrl,
          failure: input.returnUrl,
        },
      },
    });
    if (!result.ok) return result;

    const payment = result.data.payment as { id?: unknown; status?: unknown } | undefined;
    const configuration = result.data.configuration as
      | { available_products?: { installments?: { web_url?: unknown }[] } }
      | undefined;

    const id = typeof payment?.id === "string" ? payment.id : "";
    const url = configuration?.available_products?.installments?.[0]?.web_url;

    if (!id || typeof url !== "string" || !url) {
      // Tabby answers 200 with no checkout URL when it declines the *shopper*
      // rather than the request — an ordinary BNPL outcome, not an error.
      return {
        ok: false,
        code: "REJECTED",
        message: "Tabby did not offer an instalment plan for this order.",
      };
    }

    return {
      ok: true,
      providerRef: id,
      checkoutUrl: url,
      providerStatus: typeof payment?.status === "string" ? payment.status : "CREATED",
      metadata: { testMode: config.testMode },
    };
  },

  async verifyPayment(input: VerifyRequest): Promise<VerifyResult> {
    const config = tabbyConfig();
    if (!config) return notConfigured();

    const result = await callApi(config, `/payments/${encodeURIComponent(input.providerRef)}`, {
      method: "GET",
    });
    if (!result.ok) return result;

    const raw = typeof result.data.status === "string" ? result.data.status : "";
    const amount = Number.parseFloat(String(result.data.amount ?? ""));

    return {
      ok: true,
      status: toInternalStatus(raw, TABBY_STATUS),
      providerStatus: raw || "UNKNOWN",
      // Tabby is instalments; there is no card to report and folding it into
      // "CARD" would misreport the mix in any reconciliation.
      method: "BNPL",
      paidAmount: Number.isFinite(amount) ? Math.round(amount) : undefined,
      paidCurrency: typeof result.data.currency === "string" ? result.data.currency : undefined,
      metadata: { testMode: config.testMode },
    };
  },

  /**
   * Verify Tabby's webhook signature before believing which payment it is
   * about.
   *
   * Note what is being protected: not the *status* — that is re-fetched from
   * Tabby regardless — but the identity of the payment. An unauthenticated
   * webhook endpoint that accepts any reference is a way to make this server
   * issue arbitrary lookups, so the delivery has to be established as Tabby's
   * before it is acted on at all.
   *
   * Without `TABBY_WEBHOOK_SECRET` deployed, this refuses every webhook rather
   * than falling back to trusting the body. A signature check that can be
   * skipped by omitting configuration is not a signature check.
   */
  async parseCallback(input: CallbackRequest): Promise<CallbackResult> {
    const config = tabbyConfig();
    if (!config) return notConfigured();

    if (input.kind === "WEBHOOK") {
      if (!config.webhookSecret) {
        return {
          ok: false,
          code: "NOT_CONFIGURED",
          message: "TABBY_WEBHOOK_SECRET is not set; refusing to trust the delivery.",
        };
      }
      const signature = input.headers["x-tabby-signature"] ?? "";
      if (!verifyHmac(input.rawBody, signature, config.webhookSecret)) {
        return { ok: false, code: "UNVERIFIED", message: "Tabby webhook signature mismatch." };
      }
    }

    let body: Record<string, unknown> = {};
    try {
      body = input.rawBody ? (JSON.parse(input.rawBody) as Record<string, unknown>) : {};
    } catch {
      body = {};
    }

    const ref =
      (typeof body.id === "string" ? body.id : undefined) ??
      input.query.payment_id ??
      input.query.paymentId;

    if (!ref) {
      return { ok: false, code: "NOT_FOUND", message: "Tabby callback carried no payment id." };
    }

    const claimed = typeof body.status === "string" ? body.status : "";

    return {
      ok: true,
      providerRef: ref,
      eventId: eventKey("TABBY", ref, claimed, input.kind),
      providerStatus: claimed || undefined,
    };
  },

  async queryStatus(input: VerifyRequest): Promise<VerifyResult> {
    return tabbyProvider.verifyPayment(input);
  },
};

/**
 * Constant-time HMAC-SHA256 comparison.
 *
 * `timingSafeEqual` throws on a length mismatch, which is itself a leak of
 * information about the expected digest, so the lengths are compared first and
 * a mismatch returns false without calling it.
 */
function verifyHmac(body: string, signature: string, secret: string): boolean {
  if (!signature) return false;
  const expected = createHmac("sha256", secret).update(body).digest("hex");
  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(signature.trim().toLowerCase(), "utf8");
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
