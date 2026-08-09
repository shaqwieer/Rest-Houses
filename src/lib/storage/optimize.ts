import sharp from "sharp";
import type { StorageAdapter, StoredFile } from "./types";
import { assertValidImage } from "./types";

/**
 * Recompressing an upload before it is stored.
 *
 * ─── The problem this solves ────────────────────────────────────────────────
 * Owners photograph their rest house on a phone. A modern handset produces a
 * 12-megapixel JPEG of 5–8 MB, and a gallery is up to 30 of them. Straight to
 * storage that is ~200 MB per listing, on a VPS whose photos live inside
 * PostgreSQL (STORAGE_DRIVER=db) and therefore inside every `pg_dump`. It is
 * also 8 MB uploaded over a phone connection per photo, which is where the
 * "waiting forever" complaint comes from.
 *
 * None of that resolution is used. The largest a listing photo is ever rendered
 * is the detail-page hero and the lightbox, and `next/image` derives every size
 * it serves from the original — so anything beyond a generous 2× retina width
 * is decoded, downscaled and thrown away on the first request, then never read
 * again.
 *
 * ─── "Compress without reducing quality" ────────────────────────────────────
 * Taken literally that is impossible — every lossy step reduces quality by
 * definition. Taken as meant — no *visible* loss at the sizes these images are
 * actually displayed — it is very achievable, and the settings below are chosen
 * for it:
 *
 *   * WebP at quality 82. Around the point where WebP is indistinguishable from
 *     the source at normal viewing distance, while typically 25–35% smaller than
 *     a JPEG of matching appearance.
 *   * `effort: 5` — more CPU at encode time for a smaller file. Paid once, on
 *     upload; the file is then served thousands of times.
 *   * Longest edge capped at 2560px, and `withoutEnlargement` so a small image
 *     is never upscaled into a bigger file than it arrived as.
 *   * `fit: "inside"` preserves the aspect ratio; nothing is cropped. Deciding
 *     what to cut out of an owner's photograph is not this layer's business.
 *
 * Typical result: 6 MB → 250–450 KB, with no difference a guest could see.
 *
 * ─── EXIF ──────────────────────────────────────────────────────────────────
 * All metadata is dropped, which is a privacy fix as much as a size one: phone
 * photos carry GPS coordinates, and a rest house's gallery would otherwise
 * publish the owner's exact location — including, for a photo taken elsewhere,
 * somewhere they did not intend to share.
 *
 * `rotate()` with no argument is called first and is NOT optional. It bakes in
 * the EXIF orientation flag before that flag is stripped; without it, every
 * photo taken in portrait on an iPhone is stored on its side.
 */

/** Longest edge, in pixels. 2× the widest slot the design renders. */
const MAX_EDGE = 2560;

/** WebP quality. Visually lossless at these dimensions; see above. */
const QUALITY = 82;

/**
 * Below this, recompression is not worth its own risk.
 *
 * A 300 KB image is already reasonable, and running it through the encoder can
 * genuinely make it *larger* — re-encoding an already-optimised WebP adds
 * generational loss for nothing. The threshold keeps small uploads byte-identical.
 */
const SKIP_BELOW_BYTES = 400 * 1024;

/**
 * One image, recompressed. Returns the original `File` untouched if there is
 * nothing to gain or if sharp fails.
 */
export async function optimizeImage(file: File): Promise<File> {
  // An animated GIF or an SVG would be destroyed by a still-image encoder.
  // `assertValidImage` already restricts the type to the four raster formats
  // below, so this is belt and braces against that list growing later.
  if (!/^image\/(jpeg|png|webp|avif)$/.test(file.type)) return file;
  if (file.size < SKIP_BELOW_BYTES) return file;

  try {
    const input = Buffer.from(await file.arrayBuffer());

    const output = await sharp(input, { failOn: "none" })
      // Before metadata is dropped — see the note above.
      .rotate()
      .resize({ width: MAX_EDGE, height: MAX_EDGE, fit: "inside", withoutEnlargement: true })
      .webp({ quality: QUALITY, effort: 5 })
      .toBuffer();

    // Re-encoding does not always win — an already-small, already-optimised
    // image can come out bigger. Keep whichever is actually smaller rather than
    // assuming the pipeline improved things.
    if (output.byteLength >= input.byteLength) return file;

    const name = file.name.replace(/\.[^.]+$/, "") || "photo";
    // `new Uint8Array(output)` rather than the Buffer itself: a Node Buffer is
    // typed over `ArrayBufferLike`, which may be a SharedArrayBuffer, and the
    // DOM `BlobPart` union accepts only a plain ArrayBuffer view. Copying into a
    // Uint8Array is the narrowing the File constructor wants.
    return new File([new Uint8Array(output)], `${name}.webp`, { type: "image/webp" });
  } catch {
    // A corrupt or exotic file must not cost the owner their upload. Storing
    // the original is the honest fallback: the gallery still works, it is
    // merely larger than it could have been.
    return file;
  }
}

/**
 * Wraps any adapter so every upload is optimised on its way through.
 *
 * A decorator rather than a call inside `addImagesScoped`, so a future call
 * site — a bulk importer, an avatar upload — cannot forget it, and so all four
 * drivers (db, local, s3, cloudinary) get it without each implementing it.
 *
 * ─── Validation runs first, deliberately ────────────────────────────────────
 * `assertValidImage` normally runs inside the wrapped adapter's own `save()`.
 * That is too late here: this decorator would already have handed up to
 * MAX_UPLOAD_BYTES of unvalidated, possibly-hostile bytes to an image decoder.
 * So the same assertion runs here, before sharp sees anything. The inner
 * adapter still repeats it — it must stay usable undecorated, and the check is
 * a few comparisons.
 */
export class OptimizingStorage implements StorageAdapter {
  readonly name: string;

  constructor(private readonly inner: StorageAdapter) {
    this.name = `${inner.name}+optimize`;
  }

  async save(file: File, opts?: { folder?: string }): Promise<StoredFile> {
    assertValidImage(file);
    return this.inner.save(await optimizeImage(file), opts);
  }

  delete(keyOrUrl: string): Promise<void> {
    return this.inner.delete(keyOrUrl);
  }
}
