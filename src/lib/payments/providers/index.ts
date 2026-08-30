import type { PaymentProviderId } from "@/lib/constants";
import type { PaymentProvider } from "../types";
import { telrProvider } from "./telr";
import { tabbyProvider } from "./tabby";
import { tamaraProvider } from "./tamara";

/**
 * The provider registry — the only place a gateway is named.
 *
 * Adding one is: a new file beside this, an entry in this map, a value in
 * `PAYMENT_PROVIDERS` (src/lib/constants.ts), a flag on `SiteSettings`, and a
 * credential block in ../config.ts. Nothing in the booking domain changes,
 * because nothing in the booking domain mentions a provider by name — it works
 * in internal lifecycle statuses and asks for "the provider for this payment".
 *
 * ─── "MANUAL" is deliberately absent ────────────────────────────────────────
 * Bank transfer is a real `PAYMENT_PROVIDERS` value and real `Payment` rows
 * carry it, but it has no adapter and cannot have one: there is no API to call,
 * no reference to verify and no webhook to receive. It is settled by a human —
 * the owner confirming at step 1 of the handover workflow — through
 * `recordManualPayment()` in ../service.ts.
 *
 * So `getProvider("MANUAL")` returns null, and that null is the point. Every
 * caller that means "call a gateway" has to handle its absence, which is what
 * stops the manual path ever being routed into an HTTP request that would fail
 * at runtime rather than at the type level.
 */
const REGISTRY: Partial<Record<PaymentProviderId, PaymentProvider>> = {
  TELR: telrProvider,
  TABBY: tabbyProvider,
  TAMARA: tamaraProvider,
};

/**
 * The adapter for a provider id, or null.
 *
 * Null for "MANUAL" (no gateway exists) and for any string a future build
 * writes that this one does not know — a row from a newer deploy must degrade
 * to "cannot be processed here" rather than throw inside a webhook handler.
 */
export function getProvider(id: string): PaymentProvider | null {
  return REGISTRY[id as PaymentProviderId] ?? null;
}

export { telrProvider, tabbyProvider, tamaraProvider };
