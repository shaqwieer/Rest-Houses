import { prisma } from "@/lib/prisma";

/**
 * Serve an image stored in the database (STORAGE_DRIVER="db").
 *
 * Caching is what makes this competitive with a static file. A row's bytes never
 * change — replacing a photo creates a new row with a new id — so the URL is
 * effectively content-addressed and can be marked `immutable`. Together with the
 * ETag, a returning visitor gets a 304 (or no request at all), and Next's image
 * optimiser caches the resized variants it derives, so the database is read once
 * per size rather than once per page view.
 */

// Node runtime: Prisma cannot run on the edge without Accelerate.
export const runtime = "nodejs";

/** Rows are immutable, so the route's own output can be cached indefinitely. */
export const revalidate = false;

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  // Tolerate a decorative extension in the URL (/api/images/abc123.webp).
  const cleanId = id.replace(/\.(jpe?g|png|webp|avif)$/i, "");

  // Answer conditional requests before touching the blob: if the browser already
  // has this id cached there is no reason to read megabytes out of Postgres.
  const etag = `"${cleanId}"`;
  if (request.headers.get("if-none-match") === etag) {
    return new Response(null, { status: 304, headers: { ETag: etag } });
  }

  const image = await prisma.storedImage.findUnique({
    where: { id: cleanId },
    select: { data: true, mimeType: true, size: true },
  });

  if (!image) {
    return new Response("Not found", { status: 404 });
  }

  // Prisma returns Bytes as a Uint8Array/Buffer depending on version; Buffer.from
  // normalises both into something Response accepts.
  const body = Buffer.from(image.data);

  return new Response(body, {
    status: 200,
    headers: {
      "Content-Type": image.mimeType || "application/octet-stream",
      "Content-Length": String(image.size || body.byteLength),
      "Cache-Control": "public, max-age=31536000, immutable",
      ETag: etag,
      // These are user-uploaded files served from our own origin: make certain a
      // browser renders them as images and never as an HTML/script document.
      "X-Content-Type-Options": "nosniff",
      "Content-Disposition": "inline",
    },
  });
}
