import { absoluteUrl } from "@/lib/settings";
import { readCallback, settleAndConfirm } from "../shared";

/**
 * Where the guest's browser lands after the provider's hosted page —
 * `/api/payments/<provider>/return`.
 *
 * ─── This redirect proves nothing, and is treated accordingly ───────────────
 * A guest arriving here means the provider's page sent them somewhere. It does
 * not mean a payment succeeded: the URL can be typed, bookmarked, shared, or
 * reached after pressing "back" on a failed card entry. Query parameters on it
 * are attacker-controllable in the most literal sense — the attacker is the
 * person holding the browser.
 *
 * So this route does exactly what the webhook does: hands the delivery to
 * `applyCallback`, which takes only the *reference* from it and then asks the
 * provider directly, server to server, what actually happened. The two paths
 * share one implementation precisely so the browser-facing one cannot end up
 * with a shortcut the machine-facing one does not have.
 *
 * The practical consequence, and the point of the whole arrangement: a guest
 * who hand-crafts `…/return?status=paid&ref=X` gets their booking page and no
 * payment, because nothing in that URL was ever consulted for a status.
 *
 * ─── Why it redirects rather than renders ───────────────────────────────────
 * The guest should end up on their own booking page — the one with the
 * reference, the totals and the WhatsApp hand-off they already know. Rendering a
 * second confirmation here would mean two pages that say a booking is
 * confirmed, which is one more than can be kept correct.
 *
 * A guest whose payment could not be matched to anything still lands on
 * /booking or the home page rather than on an error: they have possibly just
 * paid, and a dead end is the worst thing to show them. What went wrong is in
 * `PaymentEvent` and the audit log, where an operator can act on it.
 *
 * ─── Both verbs ────────────────────────────────────────────────────────────
 * Telr posts the return leg as a form; Tabby and Tamara redirect with a query
 * string. Both are accepted, and both hand off to the same function.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function handle(
  request: Request,
  params: Promise<{ provider: string }>,
): Promise<Response> {
  const { provider } = await params;
  const callback = await readCallback(request, "RETURN");

  const result = await settleAndConfirm(provider, callback);

  const reference = result.ok ? result.bookingReference : null;

  // `?paid=1` is a HINT TO THE UI ONLY — it decides which sentence the
  // confirmation page opens with, never what that page reads out of the
  // database. The booking's own `paymentStatus` is the source of truth there,
  // and a guest who edits this parameter changes a heading and nothing else.
  const destination = reference
    ? absoluteUrl(
        `/booking/${encodeURIComponent(reference)}${
          result.ok && result.status === "PAID" ? "?paid=1" : ""
        }`,
      )
    : absoluteUrl("/");

  // 303, not 302: the return leg may arrive as a POST, and 303 is the status
  // that tells the browser to follow it with a GET. A 302 leaves the method up
  // to the client, and a POST to the booking page would 405.
  return Response.redirect(destination, 303);
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ provider: string }> },
) {
  return handle(request, params);
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ provider: string }> },
) {
  return handle(request, params);
}
