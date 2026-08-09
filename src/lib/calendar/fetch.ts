/**
 * Fetching an owner-supplied calendar URL, safely.
 *
 * ─── The threat, stated plainly ─────────────────────────────────────────────
 * Everywhere else in this application the server fetches URLs *it* chose. Here
 * an owner types one in and the server requests it, on a schedule, from inside
 * the production network. That is server-side request forgery by construction,
 * and on the VPS this deploys to (see DEPLOYMENT.md) the interesting targets
 * are one hop away: the PostgreSQL container on the compose network, anything
 * else bound to 127.0.0.1 behind nginx, and — on a cloud host — the metadata
 * endpoint at 169.254.169.254, which hands out credentials to anyone who asks.
 *
 * A blocklist of hostnames does not close this. `localhost` has a hundred
 * spellings, a DNS record can simply resolve to 127.0.0.1, and a URL that
 * passes validation can redirect to one that would not. So the check is on the
 * **resolved IP addresses**, it is repeated on **every redirect hop**, and the
 * request is made against the address that was checked.
 *
 * Four other limits, each closing a way a hostile or broken feed could hurt the
 * server rather than the data: a total timeout, a response size cap, a redirect
 * cap, and a content sniff that refuses obvious HTML before it reaches the
 * parser.
 */

import dns from "node:dns/promises";
import net from "node:net";

/** Ten seconds for the whole exchange, redirects included. */
const TIMEOUT_MS = 10_000;

/**
 * 4 MB. A year of a busy listing's bookings is perhaps 60 KB, so this is three
 * orders of magnitude of headroom and still small enough that a feed answering
 * with a disk image cannot exhaust memory.
 */
const MAX_BYTES = 4 * 1024 * 1024;

/** Airbnb answers 302 to a signed CDN URL, so redirects have to be followed. */
const MAX_REDIRECTS = 3;

/**
 * Why a fetch failed, as a code the UI can translate.
 *
 * Codes rather than messages because the reason is shown to an owner in their
 * own language, and because the underlying error text can contain the URL —
 * which is a credential for their account on the other platform and must not be
 * echoed into `CalendarFeed.lastError`, a page, or a log.
 */
export type FetchFailure =
  | "INVALID_URL"
  | "NOT_HTTPS"
  | "PRIVATE_ADDRESS"
  | "DNS"
  | "TIMEOUT"
  | "TOO_MANY_REDIRECTS"
  | "HTTP_ERROR"
  | "TOO_LARGE"
  | "NOT_CALENDAR"
  | "NETWORK";

export type FetchResult =
  | { ok: true; body: string }
  | { ok: false; failure: FetchFailure; status?: number };

/**
 * Is this address one the server must never be talked into reaching?
 *
 * Covers loopback, RFC1918 private space, link-local (which is where cloud
 * metadata lives), carrier-grade NAT, and the IPv6 equivalents — including
 * IPv4-mapped IPv6 (`::ffff:127.0.0.1`), which is how a check that only looked
 * at the textual family gets walked straight past.
 */
export function isBlockedAddress(address: string): boolean {
  const family = net.isIP(address);
  if (family === 0) return true; // not an IP at all — refuse rather than guess

  if (family === 4) return isBlockedIPv4(address);

  const lower = address.toLowerCase();

  // IPv4-mapped and IPv4-compatible forms carry a v4 address in a v6 skin.
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(lower);
  if (mapped) return isBlockedIPv4(mapped[1]);

  if (lower === "::" || lower === "::1") return true; // unspecified, loopback
  if (lower.startsWith("fe80")) return true; // link-local
  if (/^f[cd]/.test(lower)) return true; // fc00::/7 unique local
  if (lower.startsWith("64:ff9b:")) return true; // NAT64 — reaches v4 space

  return false;
}

function isBlockedIPv4(address: string): boolean {
  const parts = address.split(".").map(Number);
  if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) {
    return true;
  }
  const [a, b] = parts;

  if (a === 0) return true; // "this network"
  if (a === 10) return true; // private
  if (a === 127) return true; // loopback
  if (a === 169 && b === 254) return true; // link-local, incl. cloud metadata
  if (a === 172 && b >= 16 && b <= 31) return true; // private
  if (a === 192 && b === 168) return true; // private
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
  if (a === 192 && b === 0) return true; // IETF protocol assignments
  if (a >= 224) return true; // multicast, reserved, broadcast

  return false;
}

/**
 * Validate a URL for storage, without fetching it.
 *
 * HTTPS only. An http:// feed would let anyone between this server and the
 * other platform rewrite the calendar in transit — and *removing* events from
 * that response is enough to re-open a night that is actually sold. Both
 * platforms publish https URLs, so this rejects nothing real.
 */
export function validateFeedUrl(raw: string): { ok: true; url: URL } | { ok: false; failure: FetchFailure } {
  // Some platforms hand out a webcal:// link — https with a different scheme
  // name, and what the "Add to calendar" button copies. Accept it rather than
  // making an owner hand-edit a URL they copied from a button.
  //
  // Rewritten on the STRING, before `new URL`, and not with the `protocol`
  // setter afterwards. `webcal:` is a non-special scheme to the URL standard,
  // and the setter refuses to move a URL between non-special and special
  // schemes — it fails silently, leaving `webcal:` in place, so the check below
  // then rejected every webcal link as "not https".
  const trimmed = raw.trim().replace(/^webcal:\/\//i, "https://");

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return { ok: false, failure: "INVALID_URL" };
  }

  if (url.protocol !== "https:") return { ok: false, failure: "NOT_HTTPS" };
  if (!url.hostname) return { ok: false, failure: "INVALID_URL" };

  // A literal private address needs no DNS to reject.
  if (net.isIP(url.hostname) !== 0 && isBlockedAddress(url.hostname)) {
    return { ok: false, failure: "PRIVATE_ADDRESS" };
  }

  return { ok: true, url };
}

/**
 * Resolve a hostname and refuse it if any address it answers with is private.
 *
 * *Any*, not *the first*: a name that resolves to both a public and a private
 * address would otherwise be a coin flip, and an attacker controlling the zone
 * gets to call it. Refusing the whole name is the only stable answer.
 *
 * This still leaves a DNS-rebinding window — the name could resolve differently
 * between this check and the socket connect. Closing it completely means
 * pinning the connection to the vetted IP with a custom agent and carrying the
 * original host in the SNI/Host header, which undici's `fetch` does not expose
 * cleanly. The residual risk is small here (the attacker must already be a
 * signed-in, approved owner, and the reward is one HTTPS GET whose body is
 * parsed as a calendar and discarded), and it is documented rather than hidden.
 */
async function resolveAndCheck(hostname: string): Promise<FetchFailure | null> {
  if (net.isIP(hostname) !== 0) {
    return isBlockedAddress(hostname) ? "PRIVATE_ADDRESS" : null;
  }

  let addresses: { address: string }[];
  try {
    addresses = await dns.lookup(hostname, { all: true, verbatim: true });
  } catch {
    return "DNS";
  }

  if (addresses.length === 0) return "DNS";
  if (addresses.some((a) => isBlockedAddress(a.address))) return "PRIVATE_ADDRESS";

  return null;
}

/**
 * GET a calendar feed, following redirects by hand so each hop is re-validated.
 *
 * `redirect: "manual"` rather than letting fetch follow: an automatic redirect
 * is exactly the hole the address check would otherwise leave open, since the
 * URL that was vetted is not the URL that gets requested.
 */
export async function fetchCalendar(rawUrl: string): Promise<FetchResult> {
  const validated = validateFeedUrl(rawUrl);
  if (!validated.ok) return { ok: false, failure: validated.failure };

  let url = validated.url;
  const controller = new AbortController();
  // One deadline for the whole exchange. A per-hop timeout would let three
  // redirects hold a worker for three times as long.
  const deadline = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      const blocked = await resolveAndCheck(url.hostname);
      if (blocked) return { ok: false, failure: blocked };

      let response: Response;
      try {
        response = await fetch(url, {
          method: "GET",
          redirect: "manual",
          signal: controller.signal,
          headers: {
            // Some feeds content-negotiate and will answer HTML to a browser
            // Accept header.
            Accept: "text/calendar, text/plain;q=0.9, */*;q=0.5",
            "User-Agent": "DesertChalets-CalendarSync/1.0",
          },
          // Never send cookies or credentials to a URL an owner supplied.
          cache: "no-store",
        });
      } catch (error) {
        if (error instanceof Error && error.name === "AbortError") {
          return { ok: false, failure: "TIMEOUT" };
        }
        return { ok: false, failure: "NETWORK" };
      }

      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get("location");
        if (!location) return { ok: false, failure: "HTTP_ERROR", status: response.status };

        let next: URL;
        try {
          next = new URL(location.replace(/^webcal:\/\//i, "https://"), url);
        } catch {
          return { ok: false, failure: "INVALID_URL" };
        }
        // A redirect to http:// downgrades the transport the whole check rests
        // on, and a redirect to file:// or gopher:// is not a mistake.
        if (next.protocol !== "https:") return { ok: false, failure: "NOT_HTTPS" };

        url = next;
        continue;
      }

      if (!response.ok) {
        return { ok: false, failure: "HTTP_ERROR", status: response.status };
      }

      // Trust the header when it is present and obviously wrong — cheaper than
      // downloading 4 MB of HTML to have the parser reject it.
      const contentType = response.headers.get("content-type") ?? "";
      if (/\b(text\/html|application\/xhtml)\b/i.test(contentType)) {
        return { ok: false, failure: "NOT_CALENDAR" };
      }

      const declared = Number(response.headers.get("content-length") ?? "0");
      if (declared > MAX_BYTES) return { ok: false, failure: "TOO_LARGE" };

      const body = await readCapped(response);
      if (body === null) return { ok: false, failure: "TOO_LARGE" };

      return { ok: true, body };
    }

    return { ok: false, failure: "TOO_MANY_REDIRECTS" };
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      return { ok: false, failure: "TIMEOUT" };
    }
    return { ok: false, failure: "NETWORK" };
  } finally {
    clearTimeout(deadline);
  }
}

/**
 * Read a body, giving up once it exceeds the cap.
 *
 * Streamed rather than `await response.text()`: a `Content-Length` header is a
 * claim, not a fact, and a server that omits it can send bytes until the
 * process runs out of memory. Counting as the chunks arrive is the only version
 * of this limit that a hostile server cannot opt out of.
 */
async function readCapped(response: Response): Promise<string | null> {
  if (!response.body) return null;

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;

      total += value.byteLength;
      if (total > MAX_BYTES) {
        await reader.cancel().catch(() => {});
        return null;
      }
      chunks.push(value);
    }
  } catch {
    return null;
  }

  return Buffer.concat(chunks).toString("utf8");
}
