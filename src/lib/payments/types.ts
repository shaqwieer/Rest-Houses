import type {
  PaymentKind,
  PaymentLifecycle,
  PaymentMethod,
  PaymentProviderId,
} from "@/lib/constants";

/**
 * The payment provider contract.
 *
 * ─── What this interface is for ─────────────────────────────────────────────
 * The booking domain must never learn a gateway's vocabulary. `createBookingRequest`,
 * the handover workflow and the admin tables all deal in `PAYMENT_LIFECYCLE`
 * values and whole dirhams; everything a provider says — Telr's single-letter
 * status codes, Tabby's minor units, Tamara's ISO-8601 expiry — is translated
 * inside that provider's adapter and stops there.
 *
 * Concretely, that means adding a gateway later is: one new file under
 * `providers/`, one entry in `providers/index.ts`, one flag on `SiteSettings`
 * and one credential block in `config.ts`. No booking code changes, because no
 * booking code names a provider.
 *
 * ─── Every method returns a discriminated result, never throws ──────────────
 * A gateway being down, a credential being wrong and a card being declined are
 * all normal operating conditions on a booking site, not exceptions. They come
 * back as `{ ok: false, code }` so the caller has to handle them; a thrown error
 * on the webhook path would return 500 to the provider and earn a retry storm
 * for something a retry cannot fix.
 *
 * ─── Codes, not sentences ───────────────────────────────────────────────────
 * `code` is a stable identifier and `message` is English diagnostic text for the
 * server log. Neither is ever shown to a guest. This module is imported by
 * server code with no request scope and therefore no locale — the same reason
 * `depositPaymentStatus` has always returned a code. The caller resolves the
 * code against the dictionary where the reader's language is known.
 *
 * ─── Card data ─────────────────────────────────────────────────────────────
 * No method here accepts a card number, and none ever should. Every provider in
 * this directory is a *redirect* integration: this platform creates an order,
 * the guest is sent to the provider's own hosted page, and the PAN is entered
 * there. What comes back is a reference and, at most, the last four digits.
 * That is what keeps this application out of PCI scope, and it is a property of
 * the interface rather than of any one adapter — there is no parameter through
 * which card data could arrive.
 */

/** A stable, loggable failure. Never rendered to a guest. */
export type ProviderError = {
  ok: false;
  /**
   * One of a small set, so callers can branch:
   *   NOT_CONFIGURED   credentials missing — an operator problem
   *   NETWORK          the gateway could not be reached
   *   REJECTED         the gateway refused the request (bad data, bad key)
   *   NOT_FOUND        the gateway has no record of this reference
   *   UNVERIFIED       a callback failed its authenticity check
   *   UNSUPPORTED      this provider does not implement the operation
   */
  code:
    | "NOT_CONFIGURED"
    | "NETWORK"
    | "REJECTED"
    | "NOT_FOUND"
    | "UNVERIFIED"
    | "UNSUPPORTED";
  /** English, for the server log. */
  message: string;
};

/**
 * What a provider needs in order to open a checkout.
 *
 * Note what is NOT here: no price list, no listing, no deposit percentage.
 * `amount` has already been computed from the database by
 * `startPayment()` and is authoritative by the time it reaches an adapter —
 * an adapter that could recompute it would be a second place for the number
 * to be wrong.
 */
export type CheckoutRequest = {
  /** Our own `Payment.id`. Round-trips through the provider as the merchant
   *  reference, which is how a callback finds its way back to one row. */
  paymentId: string;
  /** Whole dirhams. Converted to whatever units the provider wants inside the
   *  adapter, and nowhere else. */
  amount: number;
  currency: string;
  kind: PaymentKind;
  /** The booking's human reference (RQ-2419) — shown on the provider's page and
   *  on the guest's card statement where the gateway supports it. */
  bookingReference: string;
  listingName: string;
  customerName: string;
  /** Canonical digits, no "+" — see src/lib/phone.ts. */
  customerPhone: string;
  customerEmail: string | null;
  /** Where the guest's browser comes back to. Verification happens there
   *  server-side; the redirect itself proves nothing. */
  returnUrl: string;
  /** Where the guest is sent if they abandon the hosted page. */
  cancelUrl: string;
  /** Where the provider should call us. */
  webhookUrl: string;
  /** Language for the hosted page. */
  locale: "ar" | "en";
};

export type CheckoutResult =
  | {
      ok: true;
      /** The provider's reference for this attempt. Stored on `Payment.providerRef`,
       *  and unique per provider — see the index in prisma/schema.prisma. */
      providerRef: string;
      /** Where to send the guest. */
      checkoutUrl: string;
      /** The provider's own status string at creation, kept verbatim. */
      providerStatus?: string;
      /** Anything worth keeping on `Payment.metadata`. Never card data. */
      metadata?: Record<string, unknown>;
    }
  | ProviderError;

/**
 * The authoritative answer to "did this actually get paid?".
 *
 * This is the ONLY thing that may move a payment to PAID. A browser arriving at
 * the return URL is a hint that something happened; this is an outbound call
 * from this server to the provider, and the difference between the two is the
 * difference between a booking system and a free rest house.
 */
export type VerifyRequest = {
  providerRef: string;
  /** What we believe is owed, so the adapter can report a mismatch rather than
   *  the caller having to know each provider's amount encoding. */
  expectedAmount: number;
  expectedCurrency: string;
};

export type VerifyResult =
  | {
      ok: true;
      /** Mapped onto the internal lifecycle by the adapter. */
      status: PaymentLifecycle;
      /** The provider's raw status, stored beside the mapped one so an
       *  unrecognised value is recoverable rather than lost. */
      providerStatus: string;
      /** What the guest actually paid with, where the provider says. */
      method?: PaymentMethod;
      /** What the provider says was charged, in whole dirhams. Compared against
       *  the expected amount by the caller — an adapter reports, it does not
       *  decide. */
      paidAmount?: number;
      paidCurrency?: string;
      failureReason?: string;
      metadata?: Record<string, unknown>;
    }
  | ProviderError;

/**
 * A delivery from a provider: a webhook, or the guest's browser on the return
 * URL.
 *
 * `parseCallback` does exactly two things — authenticate the delivery, and
 * extract which payment it is about. It deliberately does NOT decide the
 * payment's status, even when the payload states one: a return URL is
 * attacker-controllable and a webhook body is only as trustworthy as its
 * signature. The service layer takes the reference from here and then calls
 * `verifyPayment` to ask the provider directly.
 */
export type CallbackRequest = {
  /** Lower-cased header names. */
  headers: Record<string, string>;
  /** The body exactly as received — signature checks are computed over bytes,
   *  and re-serialising parsed JSON changes them. */
  rawBody: string;
  /** Parsed query string, for GET returns. */
  query: Record<string, string>;
  kind: "WEBHOOK" | "RETURN";
};

export type CallbackResult =
  | {
      ok: true;
      /** Which attempt this is about. */
      providerRef: string;
      /**
       * A stable id for THIS DELIVERY, unique per provider.
       *
       * The provider's own delivery id where it sends one; otherwise a digest
       * of the fields that identify the delivery. It becomes
       * `PaymentEvent.eventId`, whose unique index is what makes a retried
       * webhook a no-op instead of a double-apply.
       */
      eventId: string;
      /** What the delivery claimed, for the record. Advisory only. */
      providerStatus?: string;
    }
  | ProviderError;

export type RefundRequest = {
  providerRef: string;
  /** Whole dirhams. Equal to the payment for a full refund. */
  amount: number;
  currency: string;
  reason: string;
};

export type RefundResult =
  | { ok: true; providerRef: string; providerStatus?: string }
  | ProviderError;

/**
 * One gateway.
 *
 * `refund` is optional because not every provider this platform may add
 * supports one through an API, and a caller that has to check is a caller that
 * cannot silently do nothing. `queryStatus` is separate from `verifyPayment`
 * only in intent — reconciliation polls the former on a schedule, a callback
 * drives the latter — so an adapter may point both at one implementation.
 */
export type PaymentProvider = {
  readonly id: PaymentProviderId;
  createCheckout(input: CheckoutRequest): Promise<CheckoutResult>;
  verifyPayment(input: VerifyRequest): Promise<VerifyResult>;
  parseCallback(input: CallbackRequest): Promise<CallbackResult>;
  queryStatus(input: VerifyRequest): Promise<VerifyResult>;
  refund?(input: RefundRequest): Promise<RefundResult>;
};
