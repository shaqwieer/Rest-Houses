import type { Dictionary } from "@/lib/i18n";
import {
  CAPTCHA_FIELD,
  CHALLENGE_FIELD,
  HONEYPOT_FIELD,
  SOLUTION_FIELD,
  spendChallenge,
  verifyChallenge,
  type ChallengePurpose,
} from "./challenge";
import { verifyCaptcha } from "./captcha";
import { clientIp, consumeAll, type RateLimitRule } from "./rate-limit";

/**
 * The one gate every public write path goes through.
 *
 * Four independent layers, cheapest first, so a spam run is refused before it
 * costs a database read or a call to a captcha provider:
 *
 *   1. honeypot     — a field no human can see, so anything in it is a bot
 *   2. rate limit   — per IP, and where it makes sense per phone/email too
 *   3. human check  — the signed proof-of-work token, or the configured captcha
 *   4. single use   — the nonce is spent at the moment of the write
 *
 * They are layers rather than alternatives on purpose. The honeypot catches the
 * crude scrapers, the rate limit caps what any one source can do regardless of
 * how clever it is, and the human check makes each individual attempt cost
 * something. Removing any one of them leaves a gap the others do not cover.
 */

export {
  CAPTCHA_FIELD,
  CHALLENGE_FIELD,
  HONEYPOT_FIELD,
  SOLUTION_FIELD,
  mintChallenge,
  resetSpentChallenges,
  solveChallenge,
  isChallengePurpose,
  type ChallengePurpose,
} from "./challenge";
export { publicCaptchaConfig, type CaptchaProvider } from "./captcha";
export { clientIp, consume, consumeAll, resetRateLimits, type RateLimitRule } from "./rate-limit";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/**
 * Budgets per form.
 *
 * Set from what a real household does, with room to spare. A family comparing
 * three rest houses submits maybe three requests in an evening; six in fifteen
 * minutes from one address is already unusual, and twenty in a day is not a
 * customer. Registration is rarer still — nobody legitimately signs up as an
 * owner three times in an hour.
 */
export const RATE_RULES: Record<ChallengePurpose, { ip: RateLimitRule[]; identity: RateLimitRule[] }> =
  {
    booking: {
      ip: [
        { name: "booking:ip:short", limit: 6, windowMs: 15 * MINUTE },
        { name: "booking:ip:day", limit: 20, windowMs: DAY },
      ],
      identity: [{ name: "booking:phone", limit: 5, windowMs: HOUR }],
    },
    "owner-register": {
      ip: [
        { name: "register:ip:hour", limit: 3, windowMs: HOUR },
        { name: "register:ip:day", limit: 8, windowMs: DAY },
      ],
      identity: [],
    },
  };

/** Login is not a `ChallengePurpose` — there is no widget on it — but it is a
 *  public write path that guesses passwords, so it gets the same treatment. */
export const LOGIN_RATE_RULES: RateLimitRule[] = [
  { name: "login:ip:short", limit: 8, windowMs: 10 * MINUTE },
  { name: "login:ip:hour", limit: 25, windowMs: HOUR },
];

export type GuardResult =
  | {
      ok: true;
      /**
       * Spend the challenge. Call once, immediately before the write it
       * authorises — see the note on `verifyChallenge` for why verification and
       * spending are separate steps.
       */
      spend: () => boolean;
      ip: string | null;
    }
  | { ok: false; error: string };

/**
 * Run every layer for one submission.
 *
 * `identity` is the caller's own handle on themselves — the phone number on a
 * booking — used for a second budget alongside the IP one. Someone on a shared
 * mobile network shares an IP with a whole neighbourhood; someone re-posting the
 * same phone number thirty times does not.
 */
export async function guardSubmission({
  purpose,
  formData,
  identity,
  t,
}: {
  purpose: ChallengePurpose;
  formData: FormData;
  identity?: string | null;
  t: Dictionary;
}): Promise<GuardResult> {
  // --- 1. honeypot --------------------------------------------------------
  //
  // Nothing that reaches this field is a person, so the response is the generic
  // failure message. Telling a bot *which* check it failed is free tuning advice.
  const honeypot = formData.get(HONEYPOT_FIELD);
  if (typeof honeypot === "string" && honeypot.trim().length > 0) {
    return { ok: false, error: t.security.checkFailed };
  }

  const ip = await clientIp();
  const rules = RATE_RULES[purpose];

  // --- 2. rate limit ------------------------------------------------------
  const byIp = consumeAll(rules.ip, ip);
  if (!byIp.allowed) {
    return { ok: false, error: t.security.tooManyAttempts };
  }

  const identityKey = identity?.replace(/[^0-9a-z@.]/gi, "").toLowerCase() || null;
  if (identityKey && rules.identity.length > 0) {
    const byIdentity = consumeAll(rules.identity, identityKey);
    if (!byIdentity.allowed) {
      return { ok: false, error: t.security.tooManyAttempts };
    }
  }

  // --- 3. human check -----------------------------------------------------
  const captcha = await verifyCaptcha(formData.get(CAPTCHA_FIELD), ip);
  if (!captcha.ok) {
    return {
      ok: false,
      error: captcha.reason === "error" ? t.security.checkUnavailable : t.security.checkFailed,
    };
  }

  const challenge = verifyChallenge(
    formData.get(CHALLENGE_FIELD),
    formData.get(SOLUTION_FIELD),
    purpose,
  );

  if (!challenge.ok) {
    // "expired" and "replayed" are the two an ordinary guest can hit — a tab left
    // open since morning, or a double-tapped submit button — so they get a
    // message that says what to do. Everything else is generic.
    const error =
      challenge.reason === "expired" || challenge.reason === "replayed"
        ? t.security.challengeExpired
        : t.security.checkFailed;
    return { ok: false, error };
  }

  return {
    ok: true,
    ip,
    spend: () => spendChallenge(challenge.nonce, challenge.expiresAt),
  };
}
