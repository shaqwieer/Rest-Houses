import { PrismaClient } from "@prisma/client";
import { normalizeUpload } from "../src/lib/storage/optimize";
import { sniffImageType } from "../src/lib/storage/sniff";

/**
 * Re-encode the HEIC photos that were stored before uploads were sniffed.
 *
 * Until `normalizeUpload` existed, an iPhone photo named .webp was stored with
 * its HEIC bytes under an image/webp label — invisible to every browser except
 * Safari. New uploads are converted on the way in; this deals with the ones
 * already in `StoredImage`.
 *
 * ─── New rows, never rewritten bytes ────────────────────────────────────────
 * /api/images/<id> is served `immutable` for a year with an id-based ETag, on
 * the promise that a row's bytes never change. Rewriting a row in place would
 * break that promise: every browser that already fetched the HEIC would keep it
 * for a year. So each conversion writes a NEW row, moves every reference over
 * to its URL, and deletes the old row, in one transaction per image. The pages
 * that reference them are force-dynamic, so the new URLs are live at once.
 *
 * References live in `ListingImage.url` and in three `SiteSettings` columns —
 * `logoUrl`, `ogImageUrl`, `heroImageUrl`. A HEIC row nothing points at is
 * reported and left alone.
 *
 * Dry run by default — it lists what it would convert and writes nothing:
 *
 *     npx tsx scripts/convert-heic-images.ts
 *     npx tsx scripts/convert-heic-images.ts --apply
 *
 * Take a pg_dump first. On the VPS it runs in the `migrate` image, which has
 * tsx and the full dependency tree:
 *
 *     docker compose run --rm --entrypoint sh migrate -c 'npx tsx scripts/convert-heic-images.ts'
 */

const prisma = new PrismaClient();
const apply = process.argv.includes("--apply");

const SETTINGS_URL_FIELDS = ["logoUrl", "ogImageUrl", "heroImageUrl"] as const;

async function main() {
  // Only the first bytes of each row: the scan must not pull every photo on the
  // site out of Postgres to find a handful.
  const rows = await prisma.$queryRaw<
    { id: string; mimeType: string; size: number; folder: string; head: Uint8Array }[]
  >`SELECT id, "mimeType", size, folder, substring(data from 1 for 64) AS head FROM "StoredImage"`;

  const heic = [];
  const mislabelled = [];
  for (const row of rows) {
    const real = sniffImageType(new Uint8Array(row.head));
    if (real === "image/heic") heic.push(row);
    else if (real !== row.mimeType) mislabelled.push({ ...row, real });
  }

  console.log(`Scanned ${rows.length} stored images: ${heic.length} HEIC.`);
  if (mislabelled.length) {
    // Not converted: a browser decodes these whatever the label says, so they
    // already render. Listed so nobody has to rediscover them.
    console.log(`${mislabelled.length} other row(s) whose label does not match their bytes (left alone):`);
    for (const r of mislabelled) console.log(`  ${r.id}  stored as ${r.mimeType}, actually ${r.real ?? "unknown"}`);
  }

  let converted = 0;
  for (const row of heic) {
    const url = `/api/images/${row.id}`;
    const images = await prisma.listingImage.findMany({
      where: { url },
      select: { id: true, listing: { select: { slug: true, shortId: true } } },
    });
    const settings = await prisma.siteSettings.findMany({
      where: { OR: SETTINGS_URL_FIELDS.map((f) => ({ [f]: url })) },
      select: { id: true, logoUrl: true, ogImageUrl: true, heroImageUrl: true },
    });

    const where = [
      ...images.map((i) => `listing ${i.listing.shortId}`),
      ...settings.flatMap((s) => SETTINGS_URL_FIELDS.filter((f) => s[f] === url).map((f) => `settings.${f}`)),
    ];
    console.log(`\n${row.id}  ${row.size} B, labelled ${row.mimeType}, used by: ${where.join(", ") || "nothing"}`);

    if (!where.length) {
      console.log("  unreferenced, skipped");
      continue;
    }

    const full = await prisma.storedImage.findUniqueOrThrow({ where: { id: row.id }, select: { data: true } });
    const webp = await normalizeUpload(
      new File([new Uint8Array(full.data)], `${row.id}.heic`, { type: row.mimeType }),
    );
    const bytes = Buffer.from(await webp.arrayBuffer());
    if (sniffImageType(bytes) !== "image/webp") throw new Error(`${row.id}: conversion did not produce WebP`);
    console.log(`  -> WebP ${bytes.byteLength} B`);

    if (!apply) continue;

    const newUrl = await prisma.$transaction(async (tx) => {
      const created = await tx.storedImage.create({
        data: { mimeType: "image/webp", data: bytes, size: bytes.byteLength, folder: row.folder },
        select: { id: true },
      });
      const next = `/api/images/${created.id}`;

      await tx.listingImage.updateMany({ where: { url }, data: { url: next } });
      for (const s of settings) {
        const data = Object.fromEntries(SETTINGS_URL_FIELDS.filter((f) => s[f] === url).map((f) => [f, next]));
        await tx.siteSettings.update({ where: { id: s.id }, data });
      }
      await tx.storedImage.delete({ where: { id: row.id } });
      return next;
    });

    console.log(`  converted: ${url} -> ${newUrl}`);
    converted++;
  }

  console.log(
    apply
      ? `\nDone: ${converted} converted.`
      : `\nDry run, nothing written. Re-run with --apply to convert.`,
  );
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
