import { revalidatePath } from "next/cache";
import { timingSafeEqual } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { syncDueFeeds, SYNC_INTERVAL_MINUTES } from "@/lib/calendar/sync";

/**
 * The scheduled pull — every active feed that has gone stale.
 *
 * There is no scheduler inside this application and deliberately so: the app
 * runs as one or more Next.js containers behind nginx (see docker-compose.yml),
 * and a `setInterval` in module scope would fire once per container, racing
 * itself, and would restart its clock on every deploy. A cron on the host
 * calling this endpoint has one timer, survives a container restart, and can be
 * run by hand when something looks wrong. DEPLOYMENT.md carries the crontab
 * line; it runs every 15 minutes, matching SYNC_INTERVAL_MINUTES.
 *
 * ─── Why this is a POST that requires a secret ──────────────────────────────
 * It writes to the database and makes outbound HTTP requests to every feed URL
 * on the platform. Unauthenticated, it would be an amplifier: one request from
 * anyone on the internet, N outbound fetches from this server. The shared
 * secret is compared in constant time — a plain `!==` leaks its length and
 * content through timing, which is worth avoiding on a value that is the only
 * thing guarding the endpoint.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const configured = process.env.CRON_SECRET ?? "";

  // Refuse rather than run open. An unset secret in production would otherwise
  // silently publish the endpoint, and the failure would be invisible until
  // somebody found it.
  if (configured.length === 0) {
    return Response.json(
      { ok: false, error: "CRON_SECRET is not configured" },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }

  if (!presentedSecretMatches(request, configured)) {
    return Response.json(
      { ok: false, error: "unauthorized" },
      { status: 401, headers: { "Cache-Control": "no-store" } },
    );
  }

  const results = await syncDueFeeds();

  // Every write here changes what a visitor may book, and listing pages are
  // cached. Without this an imported block would stay invisible on the public
  // calendar until something else happened to revalidate that path — which for
  // a quiet listing could be days.
  const touched = new Set(results.filter((r) => r.ok).map((r) => r.listingId));
  if (touched.size > 0) {
    const slugs = await prisma.listing.findMany({
      where: { id: { in: [...touched] } },
      select: { slug: true },
    });
    for (const { slug } of slugs) revalidatePath(`/listings/${slug}`);
    revalidatePath("/listings");
    revalidatePath("/admin/calendar");
    revalidatePath("/admin");
    revalidatePath("/owner");
  }

  const failed = results.filter((r) => !r.ok);

  return Response.json(
    {
      ok: true,
      intervalMinutes: SYNC_INTERVAL_MINUTES,
      synced: results.length,
      succeeded: results.length - failed.length,
      failed: failed.length,
      days: results.reduce((sum, r) => sum + r.days, 0),
      // Enough to diagnose from a cron log without exposing a feed URL. The
      // listing id identifies which rest house; the failure is a code.
      failures: failed.map((r) => ({
        listingId: r.listingId,
        platform: r.platform,
        failure: r.failure,
      })),
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}

/**
 * Accepts the secret as `Authorization: Bearer <secret>` or `X-Cron-Secret`.
 *
 * Two headers because the natural way to write the crontab line is
 * `curl -H "X-Cron-Secret: …"`, while a hosted scheduler usually only offers a
 * bearer token field. Never a query parameter: those end up in nginx access
 * logs, which is a poor place for a shared secret.
 */
function presentedSecretMatches(request: Request, configured: string): boolean {
  const bearer = request.headers.get("authorization") ?? "";
  const presented = bearer.toLowerCase().startsWith("bearer ")
    ? bearer.slice(7).trim()
    : (request.headers.get("x-cron-secret") ?? "").trim();

  if (presented.length === 0) return false;

  const a = Buffer.from(presented, "utf8");
  const b = Buffer.from(configured, "utf8");
  // `timingSafeEqual` throws on a length mismatch, which would itself be a
  // timing signal — compare lengths first and always run the comparison.
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
