/**
 * Optional third-party captcha — Cloudflare Turnstile or Google reCAPTCHA v2.
 *
 * ─── How this relates to the built-in check ──────────────────────────────────
 * The forms always render a human check. Which one depends purely on whether
 * keys are configured:
 *
 *   no keys   → the built-in proof-of-work checkbox (./challenge.ts)
 *   turnstile → Cloudflare's widget, verified against Cloudflare
 *   recaptcha → Google's "I'm not a robot" checkbox, verified against Google
 *
 * Both providers occupy the same slot in the same component, so switching is two
 * environment variables and a restart — no code change, no redeploy of anything
 * else, and the built-in check keeps the forms protected in the meantime.
 *
 * ─── Why provider-agnostic rather than just wiring reCAPTCHA ─────────────────
 * The operator may not have a Google account, and reCAPTCHA sends every visitor
 * to Google. Turnstile is a drop-in with the same UX and no such profile, so
 * offering both is a two-line switch rather than a decision baked into the code.
 *
 * ─── Failure policy: closed, but only when configured ────────────────────────
 * If keys ARE set and the provider cannot be reached, the submission is
 * rejected. That is deliberate: an operator who turned a captcha on expects it
 * to be load-bearing, and a network blip that silently disables it is exactly
 * the window a spam run wants. If keys are NOT set, nothing here runs at all and
 * the built-in check is what applies.
 */

export type CaptchaProvider = "none" | "turnstile" | "recaptcha";

export type CaptchaConfig =
  | { provider: "none" }
  | { provider: "turnstile" | "recaptcha"; siteKey: string; secretKey: string };

const VERIFY_URL: Record<"turnstile" | "recaptcha", string> = {
  turnstile: "https://challenges.cloudflare.com/turnstile/v0/siteverify",
  recaptcha: "https://www.google.com/recaptcha/api/siteverify",
};

/**
 * Read the configuration from the environment.
 *
 * A provider name with a missing key resolves to "none" rather than throwing:
 * a half-filled `.env` must degrade to the built-in check, not take the booking
 * form offline. The mismatch is logged once per call so it is visible in the
 * container logs rather than silent.
 */
export function captchaConfig(): CaptchaConfig {
  const raw = (process.env.CAPTCHA_PROVIDER ?? "").trim().toLowerCase();
  if (raw !== "turnstile" && raw !== "recaptcha") return { provider: "none" };

  const siteKey = (process.env.CAPTCHA_SITE_KEY ?? "").trim();
  const secretKey = (process.env.CAPTCHA_SECRET_KEY ?? "").trim();

  if (!siteKey || !secretKey) {
    console.warn(
      `CAPTCHA_PROVIDER="${raw}" is set but CAPTCHA_SITE_KEY/CAPTCHA_SECRET_KEY is missing — ` +
        "falling back to the built-in human check.",
    );
    return { provider: "none" };
  }

  return { provider: raw, siteKey, secretKey };
}

/** What the browser needs to render the right widget. Never includes the secret. */
export function publicCaptchaConfig(): { provider: CaptchaProvider; siteKey: string } {
  const config = captchaConfig();
  return config.provider === "none"
    ? { provider: "none", siteKey: "" }
    : { provider: config.provider, siteKey: config.siteKey };
}

export type CaptchaResult = { ok: true } | { ok: false; reason: "missing" | "rejected" | "error" };

/**
 * Verify a widget token with its provider.
 *
 * Both providers expose the same shape — a form POST returning `{ success }` —
 * so one function covers them. `remoteIp` is optional on both and improves their
 * scoring; it is omitted rather than faked when we could not determine it.
 */
export async function verifyCaptcha(
  token: unknown,
  remoteIp: string | null,
): Promise<CaptchaResult> {
  const config = captchaConfig();
  if (config.provider === "none") return { ok: true };

  if (typeof token !== "string" || token.trim().length === 0) {
    return { ok: false, reason: "missing" };
  }

  const body = new URLSearchParams({ secret: config.secretKey, response: token.trim() });
  if (remoteIp) body.set("remoteip", remoteIp);

  try {
    // A guest is waiting on this. If the provider is slow, fail rather than hold
    // the booking form open indefinitely.
    const response = await fetch(VERIFY_URL[config.provider], {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body,
      cache: "no-store",
      signal: AbortSignal.timeout(8_000),
    });

    if (!response.ok) {
      console.error(`captcha verify: ${config.provider} returned HTTP ${response.status}`);
      return { ok: false, reason: "error" };
    }

    const data = (await response.json()) as { success?: boolean; "error-codes"?: string[] };
    if (data.success === true) return { ok: true };

    console.warn(`captcha verify: rejected by ${config.provider}`, data["error-codes"] ?? []);
    return { ok: false, reason: "rejected" };
  } catch (error) {
    console.error("captcha verify: request failed", error);
    return { ok: false, reason: "error" };
  }
}
