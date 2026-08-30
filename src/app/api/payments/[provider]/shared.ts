import { applyCallback, type CallbackRequest } from "@/lib/payments";
import { confirmBookingForPayment } from "@/app/actions/requests";

/**
 * Turn an incoming `Request` into the shape an adapter reads.
 *
 * Shared by the webhook and the return route so the two cannot drift — a
 * signature verified over a differently-assembled body in one of them is the
 * kind of bug that only shows up in production, on one provider, intermittently.
 *
 * ─── The body is read as TEXT, once ─────────────────────────────────────────
 * Not `request.json()`. Signature schemes are computed over the exact bytes the
 * provider sent, and `JSON.parse` followed by `JSON.stringify` is not
 * byte-identical to its input — key order, whitespace and number formatting all
 * move. Parsing therefore happens inside the adapter, *after* the signature has
 * been checked against this string.
 *
 * A body can only be consumed once, which is the other reason this exists in
 * one place.
 */
export async function readCallback(
  request: Request,
  kind: "WEBHOOK" | "RETURN",
): Promise<CallbackRequest> {
  const headers: Record<string, string> = {};
  request.headers.forEach((value, key) => {
    headers[key.toLowerCase()] = value;
  });

  const query: Record<string, string> = {};
  for (const [key, value] of new URL(request.url).searchParams) {
    query[key] = value;
  }

  // A GET return leg has no body, and reading one from a request that cannot
  // have it throws on some runtimes.
  let rawBody = "";
  if (request.method !== "GET" && request.method !== "HEAD") {
    try {
      rawBody = await request.text();
    } catch {
      rawBody = "";
    }
  }

  return { headers, rawBody, query, kind };
}

/**
 * Apply a delivery, and then confirm the booking if the money is really in.
 *
 * The two halves are separate on purpose, and the seam is where the layering
 * lives: `applyCallback` owns the payment (authenticate, record, verify,
 * settle) and knows nothing about calendars; `confirmBookingForPayment` owns
 * the booking (clash re-check, availability, stage, revalidation) and knows
 * nothing about gateways. This function is the only place the two meet, and it
 * is route-adjacent rather than inside either library so that neither has to
 * import the other — a cycle between the payment service and the booking
 * actions would be the alternative.
 *
 * Confirmation is attempted only for a DEPOSIT that verified as PAID. A balance
 * payment arrives against an already-confirmed booking, and a link payment was
 * confirmed before the link was ever issued.
 *
 * A duplicate delivery does nothing here either. It carries no booking id,
 * because `applyCallback` short-circuits before looking one up — the work was
 * done the first time.
 */
export async function settleAndConfirm(
  provider: string,
  callback: CallbackRequest,
) {
  const result = await applyCallback(provider.toUpperCase(), callback);

  if (
    result.ok &&
    !result.duplicate &&
    result.status === "PAID" &&
    result.kind === "DEPOSIT" &&
    result.paymentId
  ) {
    // Only the payment id is handed over. `confirmBookingForPayment` re-reads
    // that row and refuses anything that is not already PAID, so the booking
    // and the amount it acts on are derived from the settled payment rather
    // than asserted by this caller.
    //
    // Its failure is recorded in the audit log as PAYMENT_NEEDS_REVIEW and is
    // deliberately NOT propagated: the payment itself succeeded and is settled,
    // so telling the provider this delivery failed would earn a retry of work
    // that is already done. The queue entry is how a human hears about it.
    await confirmBookingForPayment(result.paymentId);
  }

  return result;
}
