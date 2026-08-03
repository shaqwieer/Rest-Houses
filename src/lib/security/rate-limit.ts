import { headers } from "next/headers";

/**
 * Rate limiting for the public write paths — booking, owner registration, login.
 *
 * ─── Why in memory and not a table ───────────────────────────────────────────
 * This deploys as a single Next.js process behind nginx (see DEPLOYMENT.md), so
 * one process holds the whole picture: a Map is exactly as accurate as a table
 * would be, and costs no migration. That matters more than usual here, because
 * a failed migration stops the deploy outright — see the note at the top of
 * prisma/schema.prisma.
 *
 * The two things given up, stated plainly:
 *   • a restart forgets every counter, so a deploy briefly resets everyone's
 *     budget. For spam control that is a non-event.
 *   • it does not survive being scaled to a second container. If that day comes,
 *     swap the Map for Redis behind `consume()` — nothing else changes.
 *
 * ─── Fail open, always ───────────────────────────────────────────────────────
 * Every path here refuses to block when it cannot positively identify the
 * caller. A limiter that guesses is a limiter that eventually locks a real guest
 * out of a booking, and this whole file exists to stop *spam*, not to be the
 * thing that takes the site down when nginx is reconfigured and stops sending
 * `x-forwarded-for`.
 */

type Bucket = { count: number; resetAt: number };

const buckets = new Map<string, Bucket>();

/** Keep the Map from growing without bound on a long-lived process. */
function prune(now: number) {
  if (buckets.size < 2_000) return;
  for (const [key, bucket] of buckets) {
    if (bucket.resetAt <= now) buckets.delete(key);
  }
}

export type RateLimitRule = {
  /** Distinguishes one budget from another, e.g. "booking:ip". */
  name: string;
  /** How many attempts are allowed inside the window. */
  limit: number;
  /** Window length in milliseconds. */
  windowMs: number;
};

export type RateLimitVerdict = {
  allowed: boolean;
  /** Seconds until the caller may try again. 0 when allowed. */
  retryAfter: number;
};

/**
 * Take one unit from `subject`'s budget under `rule`.
 *
 * A fixed window, not a sliding one: at this traffic level the extra precision
 * of a sliding window buys nothing, and a counter with a reset time is something
 * a reader can hold in their head.
 *
 * A null/empty subject is unidentifiable — see the fail-open note above.
 */
export function consume(
  rule: RateLimitRule,
  subject: string | null | undefined,
  now: number = Date.now(),
): RateLimitVerdict {
  if (!subject) return { allowed: true, retryAfter: 0 };

  const key = `${rule.name}:${subject}`;
  const bucket = buckets.get(key);

  if (!bucket || bucket.resetAt <= now) {
    prune(now);
    buckets.set(key, { count: 1, resetAt: now + rule.windowMs });
    return { allowed: true, retryAfter: 0 };
  }

  if (bucket.count >= rule.limit) {
    return { allowed: false, retryAfter: Math.max(1, Math.ceil((bucket.resetAt - now) / 1000)) };
  }

  bucket.count += 1;
  return { allowed: true, retryAfter: 0 };
}

/**
 * Apply several rules at once — typically a tight short window plus a loose
 * daily ceiling. The first refusal wins, and rules after it are not consumed, so
 * one blocked attempt costs the caller one unit rather than several.
 */
export function consumeAll(
  rules: RateLimitRule[],
  subject: string | null | undefined,
  now: number = Date.now(),
): RateLimitVerdict {
  for (const rule of rules) {
    const verdict = consume(rule, subject, now);
    if (!verdict.allowed) return verdict;
  }
  return { allowed: true, retryAfter: 0 };
}

/** Test hook — clear every counter. */
export function resetRateLimits() {
  buckets.clear();
}

/**
 * The caller's IP address, or null when it cannot be established.
 *
 * ─── Reading `x-forwarded-for` correctly ─────────────────────────────────────
 * nginx appends to this header, so behind one proxy it is a single address and
 * behind two it is "client, proxy1". The **first** entry is the client. It is
 * also entirely attacker-controlled if nothing strips it, which is why this is
 * used only to rate limit and never to authorise anything.
 *
 * Returns null rather than a placeholder when the header is missing or
 * unparseable: `consume()` treats null as "cannot identify" and lets the request
 * through, which is the behaviour we want if the reverse proxy is ever
 * misconfigured.
 */
export async function clientIp(): Promise<string | null> {
  try {
    const h = await headers();
    const forwarded = h.get("x-forwarded-for");
    if (forwarded) {
      const first = forwarded.split(",")[0]?.trim();
      if (first) return normalizeIp(first);
    }
    const real = h.get("x-real-ip")?.trim();
    if (real) return normalizeIp(real);
    return null;
  } catch {
    // `headers()` throws outside a request scope — during a static prerender, or
    // in the test suite, which calls the server actions directly.
    return null;
  }
}

/**
 * Strip a port and IPv6 brackets, and fold IPv4-mapped IPv6 to plain IPv4, so
 * the same visitor is one bucket rather than several.
 */
function normalizeIp(raw: string): string | null {
  let ip = raw;
  if (ip.startsWith("[")) {
    const close = ip.indexOf("]");
    if (close > 0) ip = ip.slice(1, close);
  } else if (ip.split(":").length === 2) {
    // "1.2.3.4:5678" — a port on an IPv4 address. A bare IPv6 has many colons.
    ip = ip.split(":")[0];
  }
  if (ip.startsWith("::ffff:")) ip = ip.slice(7);
  return ip.length > 0 && ip.length <= 45 ? ip : null;
}
