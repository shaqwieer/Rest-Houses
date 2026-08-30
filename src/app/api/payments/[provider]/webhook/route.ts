import { readCallback, settleAndConfirm } from "../shared";

/**
 * The provider webhook — `/api/payments/<provider>/webhook`.
 *
 * Called by the gateway's server, not by a browser. Telr calls it the
 * "transaction advice" URL, Tabby a webhook, Tamara a notification; all three
 * are the same thing here and all three are handled by one route, because
 * everything provider-specific — the signature scheme, the field names, the
 * status vocabulary — lives in that provider's adapter.
 *
 * ─── What this route may and may not conclude ───────────────────────────────
 * It concludes nothing. `applyCallback` authenticates the delivery, records it
 * under a unique index, and then makes its own outbound call to the provider to
 * ask what actually happened. The body of this request never decides whether a
 * booking is paid, however emphatically it says so — see the note at the top of
 * src/lib/payments/service.ts.
 *
 * ─── Status codes are part of the contract ──────────────────────────────────
 * Gateways retry on anything that is not a 2xx, so what is returned here
 * decides whether a delivery comes back:
 *
 *   200  applied, or already applied. A duplicate is a 200 — the work is done,
 *        and telling the provider otherwise would make it retry something that
 *        has already taken effect.
 *   200  unknown reference. Also a success, deliberately: this platform has no
 *        row for it and never will, so retrying can only repeat the miss. The
 *        delivery is recorded either way, which is what makes the miss
 *        investigable.
 *   401  the delivery failed its authenticity check. Not retryable, and the one
 *        answer that should be noisy.
 *   502  the gateway could not be reached for verification. THIS one wants a
 *        retry — the payment may well be fine and this server simply could not
 *        confirm it, which is exactly the case a provider's retry schedule
 *        exists for.
 *
 * The body is deliberately terse. A webhook response is read by a machine, and
 * detail in it is detail handed to whoever is probing the endpoint.
 */

export const runtime = "nodejs";
// A payment confirmed a second ago must be applied on this request. Nothing
// here is cacheable.
export const dynamic = "force-dynamic";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ provider: string }> },
) {
  const { provider } = await params;
  const callback = await readCallback(request, "WEBHOOK");

  const result = await settleAndConfirm(provider, callback);

  if (result.ok) {
    return Response.json(
      { received: true, duplicate: result.duplicate },
      { headers: { "Cache-Control": "no-store" } },
    );
  }

  if (result.reason === "UNVERIFIED") {
    return Response.json({ received: false }, { status: 401 });
  }

  if (result.reason === "UNKNOWN_REFERENCE") {
    // Recorded, not actionable. 200 so the provider stops.
    return Response.json({ received: true, matched: false });
  }

  // Everything else — a network failure reaching the provider, a gateway
  // error — is worth a retry.
  return Response.json({ received: false }, { status: 502 });
}

/**
 * Some gateways probe the URL with a GET before enabling it.
 *
 * Answering 200 with nothing is enough for that, and it deliberately reveals
 * nothing about whether the provider name in the path is one this platform
 * knows — an endpoint that 404s only for unknown providers is a way to
 * enumerate which gateways are configured.
 */
export async function GET() {
  return Response.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
}
