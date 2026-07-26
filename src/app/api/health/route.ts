import { prisma } from "@/lib/prisma";

/**
 * Health check for Docker / orchestrators.
 *
 * Verifies the process is up AND that it can reach the database — a container
 * that answers HTTP but can't query Postgres is not healthy, and reporting it as
 * such would let a broken deploy replace a working one.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic"; // never cache a health probe

export async function GET() {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return Response.json(
      { status: "ok", database: "up", time: new Date().toISOString() },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return Response.json(
      {
        status: "error",
        database: "down",
        message: error instanceof Error ? error.message : "unknown",
      },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}
