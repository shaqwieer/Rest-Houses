/**
 * End-to-end sanity check — `npx tsx scripts/verify.ts`
 *
 * Exercises the parts of the booking domain that are easy to get subtly wrong
 * and hard to eyeball in the UI: date arithmetic across month boundaries,
 * weekend pricing, availability clash detection, the WhatsApp message, and an
 * actual write-then-read of a booking request through Prisma.
 *
 * Not a replacement for a test suite — a smoke test you can run after changing
 * anything in src/lib to confirm the maths and the database still agree.
 */

import { PrismaClient } from "@prisma/client";
import {
  addDays,
  arDayMonth,
  buildMonthGrid,
  isISODate,
  isWeekend,
  nightsBetween,
  nightsInRange,
  todayISO,
  toWeekendMode,
} from "../src/lib/dates";
import { quote } from "../src/lib/pricing";
import { bookingRequestMessage, whatsappLink } from "../src/lib/whatsapp";
import { arNum, arRating } from "../src/lib/format";
import { slugify, uniqueSlug } from "../src/lib/slug";
import { parseIdList, stringifyIdList } from "../src/lib/json-list";

const prisma = new PrismaClient();

let passed = 0;
let failed = 0;

function check(label: string, actual: unknown, expected: unknown) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) {
    passed++;
    console.log(`  ✓ ${label}`);
  } else {
    failed++;
    console.log(`  ✗ ${label}\n      expected: ${e}\n      actual:   ${a}`);
  }
}

function ok(label: string, condition: boolean, detail = "") {
  if (condition) {
    passed++;
    console.log(`  ✓ ${label}`);
  } else {
    failed++;
    console.log(`  ✗ ${label} ${detail}`);
  }
}

async function main() {
  /* ---------------------------------------------------------------- dates */
  console.log("\n📅 dates");

  check("nights across a month boundary", nightsBetween("2026-07-30", "2026-08-02"), 3);
  check("nights across a leap day", nightsBetween("2028-02-27", "2028-03-01"), 3);
  check("nights across a year boundary", nightsBetween("2026-12-30", "2027-01-02"), 3);
  check("check-out is exclusive", nightsInRange("2026-07-28", "2026-07-30"), [
    "2026-07-28",
    "2026-07-29",
  ]);
  check("same-day range is zero nights", nightsBetween("2026-07-28", "2026-07-28"), 0);
  check("addDays over month end", addDays("2026-07-31", 1), "2026-08-01");

  // The weekend is per listing. 2026-07-31 is a Friday, 08-01 a Saturday and
  // 08-02 a Sunday.
  //
  //   short — Sat + Sun. The UAE weekend, and what every listing gets by default.
  //   long  — Fri + Sat + Sun. Sharjah's four-day working week.
  check("short weekend: Friday is a weekday", isWeekend("2026-07-31", "short"), false);
  check("short weekend: Saturday counts", isWeekend("2026-08-01", "short"), true);
  check("short weekend: Sunday counts", isWeekend("2026-08-02", "short"), true);
  check("long weekend: Friday counts", isWeekend("2026-07-31", "long"), true);
  check("long weekend: Saturday counts", isWeekend("2026-08-01", "long"), true);
  check("long weekend: Sunday counts", isWeekend("2026-08-02", "long"), true);
  check("neither mode counts a Monday", isWeekend("2026-08-03", "long"), false);

  // A stored value that is neither must resolve to a weekend, not to none — a
  // mode of `undefined` would silently price every night at the weekday rate.
  check("an unknown stored mode falls back to short", toWeekendMode("saturday"), "short");
  check("null falls back to short", toWeekendMode(null), "short");
  check("a known mode is kept", toWeekendMode("long"), "long");

  check("rejects an impossible date", isISODate("2026-02-31"), false);
  check("rejects a non-date string", isISODate("28-07-2026"), false);
  check("accepts a real date", isISODate("2026-02-28"), true);

  // The bug the ISODate design exists to prevent: a day must not shift by
  // timezone. Build the grid and confirm the cell keyed to a date IS that date.
  const grid = buildMonthGrid(2026, 6, new Set(["2026-07-15"]), "2026-07-01");
  const july15 = grid.find((c) => c.kind === "day" && c.iso === "2026-07-15");
  ok("grid cell for the 15th exists", Boolean(july15));
  ok(
    "the blocked date is the blocked cell (no off-by-one)",
    july15?.kind === "day" && july15.isUnavailable && july15.dayNumber === 15,
  );
  const july1 = grid.find((c) => c.kind === "day" && c.iso === "2026-07-01");
  ok("1 July 2026 is a Wednesday → 3 leading blanks", grid.filter((c) => c.kind === "blank").length === 3);
  ok("first day is not marked past when today is the 1st", july1?.kind === "day" && !july1.isPast);

  /* -------------------------------------------------------------- pricing */
  console.log("\n💰 pricing");

  // Mon–Wed: 2 weekday nights, no weekend uplift.
  const weekdayQuote = quote({
    checkIn: "2026-07-27",
    checkOut: "2026-07-29",
    pricePerNight: 1800,
    weekendPrice: 2300,
    weekendMode: "short",
    serviceFeePercent: 5,
    depositPercent: 30,
  });
  check("weekday nights count", weekdayQuote.nights, 2);
  check("weekday subtotal = 2 × 1800", weekdayQuote.subtotal, 3600);
  check("service fee 5%", weekdayQuote.serviceFee, 180);
  check("total", weekdayQuote.total, 3780);
  check("deposit 30% of total", weekdayQuote.depositDue, 1134);

  // Thu→Sun on the UAE weekend: Thu(30) and Fri(31) are weekdays, Sat(01) is
  // not = 1800 + 1800 + 2300.
  const weekendQuote = quote({
    checkIn: "2026-07-30",
    checkOut: "2026-08-02",
    pricePerNight: 1800,
    weekendPrice: 2300,
    weekendMode: "short",
    serviceFeePercent: 5,
    depositPercent: 30,
  });
  check("weekend-spanning nights", weekendQuote.nights, 3);
  check("weekend rate applied per-night", weekendQuote.subtotal, 1800 + 1800 + 2300);
  ok(
    "weekend nights flagged correctly",
    weekendQuote.breakdown.filter((n) => n.weekend).length === 1,
  );

  // The same three nights on a Sharjah listing: Friday is a weekend night there,
  // so the identical stay costs one uplift more. This is the whole feature.
  const longWeekendQuote = quote({
    checkIn: "2026-07-30",
    checkOut: "2026-08-02",
    pricePerNight: 1800,
    weekendPrice: 2300,
    weekendMode: "long",
    serviceFeePercent: 5,
    depositPercent: 30,
  });
  check("long weekend prices Friday at the weekend rate", longWeekendQuote.subtotal, 1800 + 2300 + 2300);
  ok(
    "long weekend flags two of the three nights",
    longWeekendQuote.breakdown.filter((n) => n.weekend).length === 2,
  );

  // weekendPrice 0 must fall back to the weekday rate, not price at zero.
  const noWeekendRate = quote({
    checkIn: "2026-08-01",
    checkOut: "2026-08-02",
    pricePerNight: 1000,
    weekendPrice: 0,
    weekendMode: "short",
    serviceFeePercent: 5,
    depositPercent: 30,
  });
  check("weekendPrice=0 falls back to weekday rate", noWeekendRate.subtotal, 1000);

  /* --------------------------------------------------------------- format */
  console.log("\n🔢 formatting");

  check("Arabic-Indic thousands", arNum(1800), "١٬٨٠٠");
  check("Arabic-Indic small number", arNum(60), "٦٠");
  check("zero", arNum(0), "٠");
  check("null is safe", arNum(null), "٠");
  check("rating one decimal", arRating(4.9), "٤٫٩");
  check("integer rating still shows a decimal", arRating(5), "٥٫٠");

  /* ----------------------------------------------------------------- slug */
  console.log("\n🔗 slugs");

  check("Arabic slug", slugify("استراحة الرمال الذهبية"), "استراحه-الرمال-الذهبيه");
  check("strips punctuation", slugify("استراحة «الرمال»!"), "استراحه-الرمال");
  check("normalises alef variants", slugify("إستراحة") === slugify("استراحة"), true);
  check("empty falls back", slugify("!!!"), "listing");
  check(
    "uniqueSlug appends a counter",
    uniqueSlug("استراحة الرمال الذهبية", ["استراحه-الرمال-الذهبيه"]),
    "استراحه-الرمال-الذهبيه-2",
  );

  /* ------------------------------------------------------------ json list */
  console.log("\n📦 json lists");

  check("round-trips", parseIdList(stringifyIdList(["pool", "wifi"])), ["pool", "wifi"]);
  check("de-duplicates on write", stringifyIdList(["pool", "pool"]), '["pool"]');
  check("corrupt value degrades to empty", parseIdList("not json"), []);
  check("null degrades to empty", parseIdList(null), []);
  check("non-array json degrades to empty", parseIdList('{"a":1}'), []);

  /* --------------------------------------------------------------- whatsapp */
  console.log("\n💬 whatsapp");

  const message = bookingRequestMessage({
    siteName: "استراحات الرمال",
    reference: "RQ-2420",
    listingName: "استراحة الرمال الذهبية",
    listingArea: "لهباب – دبي",
    listingUrl: "https://example.ae/listings/x",
    checkIn: "2026-07-28",
    checkOut: "2026-07-30",
    nights: 2,
    guests: 45,
    customerName: "خالد المنصوري",
    customerPhone: "+971 50 214 8890",
    total: 3780,
    notes: "نرغب بتجهيز المجلس قبل المغرب.",
  });

  ok("message carries the reference", message.includes("RQ-2420"));
  ok("message carries the listing name", message.includes("استراحة الرمال الذهبية"));
  ok("message carries the check-in date", message.includes(arDayMonth("2026-07-28")));
  ok("message carries the guest count", message.includes("٤٥"));
  ok("message carries the total", message.includes("٣٬٧٨٠"));
  ok("message carries the customer name", message.includes("خالد المنصوري"));
  ok("message carries the phone", message.includes("+971 50 214 8890"));
  ok("message carries the notes", message.includes("نرغب بتجهيز المجلس"));

  const href = whatsappLink("+971 50 000 0000", message);
  ok("link uses wa.me", href.startsWith("https://wa.me/"));
  ok("number stripped to digits only", href.includes("/971500000000?"));
  ok("no raw plus in the number", !href.split("?")[0].includes("+"));
  ok("message is url-encoded", href.includes("?text=") && !href.includes(" "));
  // A round-trip decode proves nothing was mangled by the encoding.
  const decoded = decodeURIComponent(href.split("?text=")[1]);
  ok("message survives encode → decode", decoded === message);

  /* ------------------------------------------------------------- database */
  console.log("\n🗄️  database");

  const listing = await prisma.listing.findFirst({
    where: { published: true },
    include: { images: true },
  });
  ok("a seeded listing exists", Boolean(listing));
  if (!listing) throw new Error("run `npm run db:seed` first");

  ok("listing has a gallery", listing.images.length > 0);
  ok("amenities parse from JSON", parseIdList(listing.amenities).length > 0);

  const blocked = await prisma.availability.findMany({
    where: { listingId: listing.id },
    select: { date: true, status: true },
  });
  ok("listing has blocked dates", blocked.length > 0);
  ok(
    "every stored date is a valid YYYY-MM-DD",
    blocked.every((b) => isISODate(b.date)),
    `bad: ${blocked.filter((b) => !isISODate(b.date)).map((b) => b.date).join(",")}`,
  );
  ok(
    "seeded blocked dates are in the future",
    blocked.every((b) => b.date >= todayISO()),
  );

  // Availability clash detection: a range containing a blocked night must fail.
  const blockedDate = blocked[0].date;
  const clashRange = nightsInRange(blockedDate, addDays(blockedDate, 2));
  const clash = await prisma.availability.findFirst({
    where: { listingId: listing.id, date: { in: clashRange } },
  });
  ok("a range over a blocked night is detected as unavailable", Boolean(clash));

  // And a range that avoids every blocked night must pass.
  const busy = new Set(blocked.map((b) => b.date));
  let freeStart = todayISO();
  for (let i = 0; i < 400; i++) {
    const candidate = addDays(todayISO(), i);
    if (!busy.has(candidate) && !busy.has(addDays(candidate, 1))) {
      freeStart = candidate;
      break;
    }
  }
  const freeClash = await prisma.availability.findFirst({
    where: {
      listingId: listing.id,
      date: { in: nightsInRange(freeStart, addDays(freeStart, 2)) },
    },
  });
  ok("a clear range is detected as available", freeClash === null);

  // Write → read a booking request, then clean up.
  const reference = `VERIFY-${Date.now().toString().slice(-8)}`;
  const q = quote({
    checkIn: freeStart,
    checkOut: addDays(freeStart, 2),
    pricePerNight: listing.pricePerNight,
    weekendPrice: listing.weekendPrice,
    weekendMode: toWeekendMode(listing.weekendMode),
    serviceFeePercent: 5,
    depositPercent: 30,
  });

  const created = await prisma.bookingRequest.create({
    data: {
      reference,
      listingId: listing.id,
      customerName: "فحص تلقائي",
      customerPhone: "+971500000001",
      checkIn: freeStart,
      checkOut: addDays(freeStart, 2),
      nights: q.nights,
      guests: 10,
      subtotal: q.subtotal,
      serviceFee: q.serviceFee,
      total: q.total,
      depositDue: q.depositDue,
      status: "NEW",
    },
  });

  const readBack = await prisma.bookingRequest.findUnique({
    where: { reference },
    include: { listing: { select: { name: true } } },
  });
  ok("booking request writes and reads back", readBack?.id === created.id);
  ok("stored dates are unchanged by the round-trip", readBack?.checkIn === freeStart);
  ok("stored total matches the quote", readBack?.total === q.total);
  ok("relation resolves to the listing", readBack?.listing.name === listing.name);
  ok("paymentStatus defaults to NONE (no gateway)", readBack?.paymentStatus === "NONE");

  await prisma.bookingRequest.delete({ where: { reference } });
  const gone = await prisma.bookingRequest.findUnique({ where: { reference } });
  ok("cleanup removed the test row", gone === null);

  const settings = await prisma.siteSettings.findUnique({ where: { id: 1 } });
  ok("settings row exists", Boolean(settings));
  ok(
    "no unsubstituted template placeholders in settings",
    !JSON.stringify(settings ?? {}).includes("{{"),
    `found: ${JSON.stringify(settings ?? {}).match(/\{\{[^}]+\}\}/g)?.join(", ")}`,
  );

  /* ---------------------------------------------------------------- done */
  console.log(`\n${failed === 0 ? "✅" : "❌"} ${passed} passed, ${failed} failed\n`);
  if (failed > 0) process.exitCode = 1;
}

main()
  .catch((e) => {
    console.error("\n💥 verify crashed:", e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
