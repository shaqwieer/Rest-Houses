import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { leadingZeroBits } from "./sha256";

/**
 * The built-in human check — a signed, single-use proof-of-work challenge.
 *
 * SERVER ONLY: this imports `node:crypto`. The browser half lives in
 * `src/components/security/human-check.tsx` and shares only ./sha256.ts.
 *
 * ─── What this is, honestly ──────────────────────────────────────────────────
 * This is what protects the booking and owner-registration forms when no
 * reCAPTCHA/Turnstile keys are configured — i.e. out of the box. It is not
 * equivalent to Google's risk scoring and does not pretend to be. What it
 * actually buys:
 *
 *   • A submission must present a token this server signed, so a script that
 *     POSTs straight at the server action without ever loading a page is
 *     rejected outright.
 *   • The token carries a random nonce and a difficulty. To submit, the client
 *     must find a counter whose SHA-256 opens with `difficulty` zero bits —
 *     roughly 2^difficulty hashes. One guest pays this once, invisibly, while
 *     they type. A spam run pays it on every single attempt, which is precisely
 *     the asymmetry a captcha is for.
 *   • Each nonce is accepted once, so a solved token cannot be replayed.
 *   • The token is timestamped, so a submission that arrives implausibly fast
 *     (a bot filling and posting in the same tick) or implausibly late (a stale
 *     tab, a harvested token) is refused.
 *
 * It does NOT stop a determined attacker who is willing to run a headless
 * browser and pay the CPU. Nothing short of a real captcha does. That is why
 * `./captcha.ts` exists — set two environment variables and Turnstile or
 * reCAPTCHA takes over the same widget slot — and why `./rate-limit.ts` sits
 * underneath both regardless.
 *
 * ─── Why proof-of-work rather than "tick the box" ────────────────────────────
 * A checkbox whose only evidence is "the browser said the box was ticked" is a
 * decoration: a bot posts the same field. The work here is verified by the
 * server against a nonce the server generated, so the evidence is arithmetic
 * rather than assertion.
 */

/** Form field names. Shared between the widget and the actions that read them. */
export const CHALLENGE_FIELD = "securityToken";
export const SOLUTION_FIELD = "humanProof";
export const CAPTCHA_FIELD = "captchaToken";

/**
 * Honeypot. Named like something a form-filling bot wants to complete and left
 * out of the visible layout entirely — see the widget for how it is hidden
 * (off-screen, `tabIndex={-1}`, `aria-hidden`), which keeps it invisible to
 * screen readers and unreachable by keyboard while staying in the DOM for a
 * scraper to find.
 */
export const HONEYPOT_FIELD = "websiteUrl";

/** What a challenge is for. Bound into the signature, so tokens don't cross forms. */
export type ChallengePurpose = "booking" | "owner-register";

const PURPOSES: ChallengePurpose[] = ["booking", "owner-register"];

export function isChallengePurpose(v: unknown): v is ChallengePurpose {
  return typeof v === "string" && PURPOSES.includes(v as ChallengePurpose);
}

/**
 * Difficulty in leading zero bits. 12 bits ≈ 4,096 hashes ≈ well under a tenth
 * of a second on a mid-range phone, and 4,096× the cost per spam attempt.
 *
 * Raise it with HUMAN_CHECK_DIFFICULTY if the forms are being hammered; every
 * +1 doubles the attacker's cost *and* the guest's wait, so measure on a real
 * phone before going past 16.
 */
const DEFAULT_DIFFICULTY = 12;

export function challengeDifficulty(): number {
  const raw = Number(process.env.HUMAN_CHECK_DIFFICULTY);
  if (!Number.isFinite(raw)) return DEFAULT_DIFFICULTY;
  // Clamped rather than trusted: a typo'd 40 in .env would hang every visitor's
  // browser, and a 0 would silently disable the check.
  return Math.min(20, Math.max(8, Math.round(raw)));
}

/**
 * How long a minted challenge stays usable. Long enough for someone to open the
 * booking form, go and ask the family, and come back; short enough that a batch
 * of tokens harvested this morning is worthless tonight.
 */
const MAX_AGE_MS = 3 * 60 * 60 * 1000; // 3 hours

/**
 * The floor on how fast a submission may arrive after its challenge was minted.
 *
 * A guest types a name, a phone number and usually a note. Nobody does that in
 * under two seconds; a script does it in zero. Kept deliberately low so that a
 * password manager autofilling every field in one click still clears it.
 */
const MIN_AGE_MS = 2_000;

type ParsedToken = {
  purpose: ChallengePurpose;
  issuedAt: number;
  nonce: string;
  difficulty: number;
};

/**
 * The signing key.
 *
 * AUTH_SECRET is already required for the app to boot (NextAuth signs session
 * cookies with it), so reusing it means no new secret to generate, rotate or
 * forget. It is passed through a hash with a domain-separating label so this
 * key and the session key are not literally the same bytes.
 */
function signingKey(): Buffer {
  const secret = process.env.AUTH_SECRET ?? process.env.NEXTAUTH_SECRET ?? "";
  return createHash("sha256").update(`human-check:${secret}`).digest();
}

function sign(payload: string): string {
  return createHmac("sha256", signingKey()).update(payload).digest("base64url");
}

/**
 * Mint a fresh challenge for a form.
 *
 * `issuedAt` is a parameter rather than always `Date.now()` so the test suite
 * can produce a token that is already old enough to clear MIN_AGE_MS without
 * every test sleeping two seconds. Nothing reachable from a request supplies it.
 */
export function mintChallenge(
  purpose: ChallengePurpose,
  issuedAt: number = Date.now(),
): {
  token: string;
  nonce: string;
  difficulty: number;
} {
  const nonce = randomBytes(12).toString("hex");
  const difficulty = challengeDifficulty();
  const payload = `v1.${purpose}.${issuedAt}.${nonce}.${difficulty}`;
  return { token: `${payload}.${sign(payload)}`, nonce, difficulty };
}

function parse(token: string): ParsedToken | null {
  const parts = token.split(".");
  if (parts.length !== 6) return null;
  const [version, purpose, issuedAtRaw, nonce, difficultyRaw, signature] = parts;
  if (version !== "v1" || !isChallengePurpose(purpose)) return null;

  const expected = sign(`${version}.${purpose}.${issuedAtRaw}.${nonce}.${difficultyRaw}`);
  // Constant-time: a byte-by-byte comparison that bails on the first mismatch
  // leaks how much of a forged signature was right.
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;

  const issuedAt = Number(issuedAtRaw);
  const difficulty = Number(difficultyRaw);
  if (!Number.isFinite(issuedAt) || !Number.isFinite(difficulty)) return null;

  return { purpose, issuedAt, nonce, difficulty };
}

/**
 * Nonces already spent, mapped to the moment they stop being worth remembering.
 *
 * In memory rather than in a table, matching ./rate-limit.ts — see the note
 * there on why a single Node process behind nginx makes that the right call for
 * this deployment. The consequence, stated plainly: a restart forgets which
 * nonces were spent, so an unexpired token could be replayed once across a
 * deploy. The rate limiter still applies to that attempt, and a booking that is
 * a genuine duplicate is caught by the duplicate-request guard in the action.
 */
const spentNonces = new Map<string, number>();

function pruneSpent(now: number) {
  if (spentNonces.size < 512) return;
  for (const [nonce, expiresAt] of spentNonces) {
    if (expiresAt <= now) spentNonces.delete(nonce);
  }
}

export type ChallengeFailure =
  | "missing" // no token at all — a direct POST, or the widget never loaded
  | "invalid" // bad signature, wrong purpose, malformed
  | "expired" // minted too long ago
  | "too-fast" // submitted implausibly soon after minting
  | "unsolved" // the proof of work is absent or wrong
  | "replayed"; // this nonce was already spent

export type ChallengeResult =
  | { ok: true; nonce: string; expiresAt: number }
  | { ok: false; reason: ChallengeFailure };

/**
 * Check a submitted challenge **without** spending it.
 *
 * Deliberately split from `spendChallenge`: a submission that fails Zod
 * validation comes back to the same form with the same token, and the guest
 * must be able to fix their phone number and press send again. Spending on
 * every attempt would turn a typo into "please reload the page".
 */
export function verifyChallenge(
  token: unknown,
  solution: unknown,
  purpose: ChallengePurpose,
  now: number = Date.now(),
): ChallengeResult {
  if (typeof token !== "string" || token.length === 0) return { ok: false, reason: "missing" };

  const parsed = parse(token);
  if (!parsed || parsed.purpose !== purpose) return { ok: false, reason: "invalid" };

  const age = now - parsed.issuedAt;
  if (age > MAX_AGE_MS || age < -60_000) return { ok: false, reason: "expired" };
  if (age < MIN_AGE_MS) return { ok: false, reason: "too-fast" };

  if (spentNonces.has(parsed.nonce)) return { ok: false, reason: "replayed" };

  const answer = typeof solution === "string" ? solution.trim() : "";
  if (!/^[0-9]{1,15}$/.test(answer)) return { ok: false, reason: "unsolved" };

  const digest = createHash("sha256").update(`${parsed.nonce}:${answer}`).digest("hex");
  if (leadingZeroBits(digest) < parsed.difficulty) return { ok: false, reason: "unsolved" };

  return { ok: true, nonce: parsed.nonce, expiresAt: parsed.issuedAt + MAX_AGE_MS };
}

/**
 * Spend a verified nonce. Call this once, immediately before the write it
 * authorises. Returns false if another submission got there first.
 */
export function spendChallenge(nonce: string, expiresAt: number, now: number = Date.now()): boolean {
  if (spentNonces.has(nonce)) return false;
  pruneSpent(now);
  spentNonces.set(nonce, expiresAt);
  return true;
}

/** Test hook — forget every spent nonce. */
export function resetSpentChallenges() {
  spentNonces.clear();
}

/**
 * Solve a challenge server-side.
 *
 * Exists for the test suite, which drives the server actions directly and so has
 * to produce the same evidence a browser would. Tests using this exercise the
 * real gate rather than a bypass, which is the point: an `NODE_ENV === "test"`
 * escape hatch would leave the one code path that guards these forms untested.
 */
export function solveChallenge(token: string): string {
  const parsed = parse(token);
  if (!parsed) throw new Error("solveChallenge: token is not valid");
  for (let counter = 0; counter < 50_000_000; counter++) {
    const digest = createHash("sha256").update(`${parsed.nonce}:${counter}`).digest("hex");
    if (leadingZeroBits(digest) >= parsed.difficulty) return String(counter);
  }
  throw new Error("solveChallenge: no solution found");
}
