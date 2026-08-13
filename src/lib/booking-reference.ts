import { prisma } from "./prisma";

/**
 * The next human-friendly booking reference — "RQ-2419".
 *
 * ─── Why this is a module and not a private helper ───────────────────────────
 * Two paths now create bookings: the public form and the manual entry an owner
 * uses to record a stay taken elsewhere. Both hand a reference to a human — the
 * guest reads it back over WhatsApp, the owner quotes it to the operator — so
 * they must come from one sequence in one format. A second generator would
 * eventually produce a collision or a differently-shaped string, and the first
 * person to notice would be a guest whose reference does not exist.
 *
 * It lives here rather than in either action file because a `"use server"`
 * module turns every export into a callable server action: exporting this from
 * `actions/booking.ts` would publish an HTTP endpoint that hands out the next
 * reference to anyone who asks.
 *
 * ─── Not a counter, and not unique by itself ─────────────────────────────────
 * The number is derived from a row count, so two creates racing each other can
 * land on the same one. The loop below is the guard, and `reference` is
 * `@unique` in the schema as the real backstop. Under genuine contention the
 * fallback is timestamp-based: an ugly reference is better than a booking that
 * refuses to save.
 */
export async function nextReference(): Promise<string> {
  const count = await prisma.bookingRequest.count();
  // Start above the seeded sample references so demo data and real requests
  // never collide on a fresh install.
  const n = 2420 + count;

  for (let attempt = 0; attempt < 25; attempt++) {
    const reference = `RQ-${n + attempt}`;
    const exists = await prisma.bookingRequest.findUnique({
      where: { reference },
      select: { id: true },
    });
    if (!exists) return reference;
  }

  return `RQ-${Date.now().toString().slice(-8)}`;
}
