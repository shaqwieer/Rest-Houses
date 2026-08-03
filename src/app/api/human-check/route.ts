import { NextResponse } from "next/server";
import {
  clientIp,
  consume,
  isChallengePurpose,
  mintChallenge,
  publicCaptchaConfig,
} from "@/lib/security";

/**
 * Issues a fresh human-check challenge to a form.
 *
 * ─── Why the widget fetches this instead of being handed a token ─────────────
 * A token could have been minted in the page's server component and passed down
 * as a prop. Fetching it has three concrete advantages:
 *
 *   • the pages stay cacheable in principle — a challenge baked into the HTML
 *     would be shared by everyone served the same cached document, and would
 *     expire while that document was still being served
 *   • the widget can replace a spent or expired challenge without a page
 *     reload, so a guest whose booking failed validation, or who left the tab
 *     open over lunch, can simply press send again
 *   • the whole configuration — which provider, which site key, what difficulty
 *     — arrives in one response, so switching to Turnstile or reCAPTCHA changes
 *     nothing on the page that renders the widget
 *
 * Anyone can call this. That is true of every captcha's challenge endpoint: the
 * challenge is public, the *solution* is what costs, and the nonce inside it is
 * single-use and short-lived. The rate limit below is only to stop the endpoint
 * being used as a free HMAC oracle.
 */

// Never prerendered, never cached: every response contains a fresh nonce.
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const purposeParam = new URL(request.url).searchParams.get("purpose");
  const purpose = isChallengePurpose(purposeParam) ? purposeParam : null;

  if (!purpose) {
    return NextResponse.json({ error: "unknown purpose" }, { status: 400 });
  }

  const ip = await clientIp();
  const verdict = consume({ name: "human-check:mint", limit: 60, windowMs: 10 * 60_000 }, ip);
  if (!verdict.allowed) {
    return NextResponse.json(
      { error: "too many requests" },
      { status: 429, headers: { "retry-after": String(verdict.retryAfter) } },
    );
  }

  const { token, nonce, difficulty } = mintChallenge(purpose);
  const captcha = publicCaptchaConfig();

  return NextResponse.json(
    {
      token,
      // The nonce is repeated outside the token purely so the browser does not
      // have to parse the token to know what to hash.
      nonce,
      difficulty,
      provider: captcha.provider,
      siteKey: captcha.siteKey,
    },
    { headers: { "cache-control": "no-store" } },
  );
}
