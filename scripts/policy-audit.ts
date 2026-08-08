import { PrismaClient } from "@prisma/client";
import { formatHour } from "../src/lib/clock";
import { cancelPolicyForHours, toCancelPolicy } from "../src/lib/policies";

/**
 * Which rest houses still state their policy in the old representation.
 *
 * The stay times moved from six free-text columns to three numbers (see
 * src/lib/clock.ts). The migration converted only the four strings this
 * codebase itself wrote — "٤ عصرًا", "١٢ ظهرًا", "4 PM", "12 noon" — and left
 * everything an owner typed alone, on purpose: "بعد العصر" is somebody's own
 * words and guessing an hour from it would publish an arrival time nobody
 * chose. A guest turning up to a locked gate is a worse outcome than a row that
 * has not been converted yet.
 *
 * So those rows keep rendering exactly what they render today, through the
 * middle tier of the fallback in `resolveStayTimes`, and this script is the
 * to-do list: it says who is left, what they currently show, and where to fix
 * it. Each one is one dropdown away from being converted, by the owner in their
 * own editor or by an operator in /admin/listings.
 *
 *     npm run policy-audit
 *
 * It covers the cancellation window too, which moved from "any integer 0…720"
 * to a list of six named answers on the same terms: the migration converted
 * nothing, tier 2 keeps reading the old number, and the rows listed here are
 * the ones whose owner has not picked from the list yet. The awkward values are
 * the point — a listing storing 37 hours has no mode to map to and must not be
 * rounded into one, because that would change a promise a guest may have read.
 *
 * Read-only. It changes nothing.
 */

const prisma = new PrismaClient();

/** A row still on text is one with no hour but a non-blank string. */
function pending(hour: number | null, text: string, textEn: string | null): string | null {
  if (hour !== null) return null;
  const ar = text.trim();
  const en = (textEn ?? "").trim();
  if (!ar && !en) return null;
  return en && en !== ar ? `${ar || "—"}  /  ${en}` : ar || en;
}

async function main() {
  const settings = await prisma.siteSettings.findUnique({ where: { id: 1 } });

  const platformRows: string[] = [];
  if (settings) {
    const checkIn = pending(settings.checkInHour, settings.checkInTime, settings.checkInTimeEn);
    const checkOut = pending(
      settings.checkOutHour,
      settings.checkOutTime,
      settings.checkOutTimeEn,
    );
    if (checkIn) platformRows.push(`  check-in   ${checkIn}`);
    if (checkOut) platformRows.push(`  check-out  ${checkOut}`);
  }

  const listings = await prisma.listing.findMany({
    orderBy: { name: "asc" },
    select: {
      slug: true,
      name: true,
      checkInHour: true,
      checkInTime: true,
      checkInTimeEn: true,
      checkOutHour: true,
      checkOutTime: true,
      checkOutTimeEn: true,
      dayUseCheckOutHour: true,
      dayUseCheckOutTime: true,
      dayUseCheckOutTimeEn: true,
      cancelPolicy: true,
      freeCancelHours: true,
    },
  });

  const stragglers = listings
    .map((l) => ({
      name: l.name,
      slug: l.slug,
      fields: (
        [
          ["check-in ", pending(l.checkInHour, l.checkInTime, l.checkInTimeEn)],
          ["check-out", pending(l.checkOutHour, l.checkOutTime, l.checkOutTimeEn)],
          [
            "day-use  ",
            pending(l.dayUseCheckOutHour, l.dayUseCheckOutTime, l.dayUseCheckOutTimeEn),
          ],
        ] as [string, string | null][]
      ).filter((f): f is [string, string] => f[1] !== null),
    }))
    .filter((l) => l.fields.length > 0);

  console.log("\n── أوقات ما زالت نصًا حرًا / stay times still on free text ──\n");

  if (platformRows.length) {
    console.log("SiteSettings (the platform fallback) — /admin/settings");
    for (const row of platformRows) console.log(row);
    console.log("");
  }

  if (stragglers.length === 0) {
    console.log(`Listings: none — all ${listings.length} are on stored hours. ✅`);
  } else {
    console.log(`Listings: ${stragglers.length} of ${listings.length}\n`);
    for (const l of stragglers) {
      console.log(`  ${l.name}   /admin/listings — ${l.slug}`);
      for (const [field, value] of l.fields) console.log(`      ${field}  ${value}`);
    }
  }

  /* ─── the cancellation window ──────────────────────────────────────────── */

  const onOldCancel = listings
    .filter((l) => toCancelPolicy(l.cancelPolicy) === null && l.freeCancelHours !== null)
    .map((l) => ({
      name: l.name,
      slug: l.slug,
      hours: l.freeCancelHours as number,
      // null when the stored number matches none of the six — the rows that
      // need a decision rather than a mechanical conversion.
      suggestion: cancelPolicyForHours(l.freeCancelHours),
    }));

  console.log(
    "\n── نوافذ إلغاء ما زالت رقمًا / cancellation windows still stored as a number ──\n",
  );

  if (onOldCancel.length === 0) {
    console.log("Listings: none. ✅");
  } else {
    console.log(`Listings: ${onOldCancel.length} of ${listings.length}\n`);
    for (const l of onOldCancel) {
      const note = l.suggestion
        ? `matches ${l.suggestion}`
        : "matches NO option — needs a decision, do not round";
      console.log(`  ${l.name}   ${l.hours}h  (${note})`);
      console.log(`      /admin/listings — ${l.slug}`);
    }
  }

  console.log(
    `\nUnconverted rows are NOT broken — they render their own value, unchanged.` +
      `\nPicking an hour retires the text: e.g. 16 becomes "${formatHour(16, "ar")}" / "${formatHour(16, "en")}".\n`,
  );

  await prisma.$disconnect();
}

main().catch(async (error) => {
  console.error(error);
  await prisma.$disconnect();
  process.exit(1);
});
