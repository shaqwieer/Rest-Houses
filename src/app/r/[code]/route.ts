import { NextResponse } from "next/server";
import { getPublicSlugByShortId } from "@/lib/listings";

/**
 * /r/<shortId> — the short, shareable form of a listing URL.
 *
 * ─── Why this route exists ───────────────────────────────────────────────────
 * A listing's canonical URL is its Arabic slug, and that is the right choice:
 * Google decodes the path and matches an Arabic query against it, which a
 * transliteration would lose (see the note at the top of src/lib/slug.ts).
 *
 * The cost is that copying it out of a browser's address bar yields the
 * percent-encoded form — /listings/%D8%A7%D8%B3%D8%AA%D8%B1%D8%A7%D8%AD%D9%87…
 * — and that is what a guest pastes into WhatsApp. So the share button copies
 * this instead: an ASCII link short enough to read, which lands the recipient on
 * the canonical page.
 *
 * ─── Why a redirect rather than rendering the listing here ───────────────────
 * Two URLs serving the same page is a duplicate, and the one that accumulates
 * links should be the one search engines index. A permanent redirect makes /r/
 * a pointer with no content of its own: crawlers follow it to the Arabic URL and
 * credit that, and the address bar ends up showing the real page.
 *
 * It is deliberately NOT disallowed in robots.txt. Blocking it would stop a
 * crawler from following a short link somebody posted on another site, and the
 * listing would lose the credit for it — the opposite of the intent.
 */

// Reads the database on every request; there is nothing here to prerender.
export const dynamic = "force-dynamic";

export async function GET(_request: Request, { params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;

  // `getPublicSlugByShortId` applies the same public predicate as every other
  // read path, so a short link to a listing whose owner has lapsed 404s exactly
  // as the listing's own URL does rather than becoming a side door into hidden
  // inventory.
  const slug = await getPublicSlugByShortId(code);
  if (!slug) return new NextResponse(null, { status: 404 });

  /**
   * A RELATIVE Location, and not `NextResponse.redirect()`.
   *
   * `redirect()` demands an absolute URL, and the obvious way to build one —
   * `new URL(path, request.url)` — is wrong behind a reverse proxy. In the
   * container `request.url` is derived from the address the server is bound to,
   * so production served `Location: https://0.0.0.0:3000/listings/…` and the
   * short link was broken for every visitor. It passed local testing precisely
   * because a dev server binds to the host the browser is already talking to.
   *
   * Reading `Host` instead would work but means trusting a client-supplied
   * header to decide where to send that client. A relative Location needs
   * neither: RFC 7231 §7.1.2 has the client resolve it against the request URI,
   * so this is correct on the production domain, behind any proxy, and on
   * localhost, with nothing to configure. It is also what Next's own
   * `permanentRedirect` emits for the slug-history redirect on the detail page.
   */
  return new NextResponse(null, {
    status: 301,
    headers: { Location: `/listings/${encodeURIComponent(slug)}` },
  });
}
