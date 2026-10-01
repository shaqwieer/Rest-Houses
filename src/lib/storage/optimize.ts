import decodeHeic from "heic-decode";
import sharp from "sharp";
import { EXT_BY_SNIFFED_TYPE, sniffImageType } from "./sniff";
import type { StorageAdapter, StoredFile } from "./types";
import { UploadError, assertUploadable, assertValidImage, looksLikeSvg } from "./types";

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
 * An HEIC photo, decoded and stored as WebP.
 *
 * HEIC is what an iPhone shoots, and only Safari can display it — Chrome,
 * Edge and Firefox on Android and Windows show an empty frame. So it is never
 * stored as it arrived, whatever its size: unlike `optimizeImage` there is no
 * skip threshold, because a small HEIC is just as invisible as a large one.
 *
 * sharp cannot do this on its own. Its prebuilt libvips carries libheif for
 * AVIF only — HEVC decoding is left out for patent reasons, and sharp reports
 * "Support for this compression format has not been built in". `heic-decode`
 * is libheif compiled to wasm, with the wasm inlined into its JS, so it needs
 * no native build and no file lookup at runtime.
 *
 * libheif applies the container's rotation and mirroring while decoding, so
 * the pixels arrive upright and there is no EXIF left to `rotate()` by. The
 * same step drops every piece of metadata, GPS included, as `optimizeImage`
 * does.
 *
 * Throws rather than falling back. Storing the original on failure is the very
 * bug this exists to close.
 */
async function heicToWebp(bytes: Uint8Array, name: string): Promise<File> {
  let output: Buffer;
  try {
    const { width, height, data } = await decodeHeic({ buffer: bytes });
    output = await sharp(Buffer.from(data.buffer, data.byteOffset, data.byteLength), {
      raw: { width, height, channels: 4 },
    })
      .resize({ width: MAX_EDGE, height: MAX_EDGE, fit: "inside", withoutEnlargement: true })
      .webp({ quality: QUALITY, effort: 5 })
      .toBuffer();
  } catch {
    throw new UploadError("The HEIC photo could not be converted", "BAD_FORMAT");
  }

  const base = name.replace(/\.[^.]+$/, "") || "photo";
  return new File([new Uint8Array(output)], `${base}.webp`, { type: "image/webp" });
}

/**
 * The upload as what its bytes are, rather than what its name says.
 *
 * Four outcomes, chosen by `sniffImageType`:
 *   * a format we store, correctly labelled — returned untouched;
 *   * a format we store under the wrong label (a JPEG named .webp) — relabelled,
 *     bytes unchanged, so it is served with a Content-Type a browser believes;
 *   * HEIC, however it was labelled — converted to WebP;
 *   * anything else — refused. It was never going to render.
 */
export async function normalizeUpload(file: File): Promise<File> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const real = sniffImageType(bytes);

  if (!real) throw new UploadError("Unsupported image format", "BAD_FORMAT");
  if (real === "image/heic") return heicToWebp(bytes, file.name);
  if (real === file.type) return file;

  const base = file.name.replace(/\.[^.]+$/, "") || "photo";
  return new File([bytes], `${base}.${EXT_BY_SNIFFED_TYPE[real]}`, { type: real });
}

/**
 * Longest edge for a stored brand mark.
 *
 * Far below MAX_EDGE, because a logo is never rendered above ~200 CSS pixels:
 * 1024 still covers that on a 3× screen with room to spare, and `next/image`
 * derives the sizes it actually serves from here.
 */
const LOGO_MAX_EDGE = 1024;

/**
 * The brand logo, made ready to store. Used by `uploadLogo` only.
 *
 * `optimizeImage` above is tuned for an owner's photographs, and a logo has
 * three needs it does not cover.
 *
 * ─── Vector in, raster out ──────────────────────────────────────────────────
 * A logo arrives from whoever designed it as an SVG — that is the file the
 * operator has on hand. Storing the SVG itself is not an option: `next/image`
 * refuses SVG sources unless `dangerouslyAllowSVG` is turned on, and turning it
 * on would mean serving an uploaded file that can carry script from our own
 * origin, for every image on the site rather than just this one. Rendering the
 * vector here through librsvg keeps the sharpness that made it worth having and
 * stores inert pixels. It is also rendered at 384 dpi and allowed to scale *up*
 * to the cap — a vector has no native resolution, so that is free quality.
 *
 * ─── Trim the empty margin ──────────────────────────────────────────────────
 * Export tools centre a mark on a square artboard. The wordmark this was
 * written for is a 1200×1200 canvas whose artwork occupies the middle third;
 * scaled into a 40px header slot that leaves letters about sixteen pixels tall,
 * which is the entire "the logo came out blurry" complaint — the file was fine,
 * almost none of it was the logo. `trim()` crops back to the artwork's own
 * bounding box (1200×1200 → 1024×537 for that file), so the height the design
 * allots is spent on the mark instead of on its margin.
 *
 * ─── Keep the alpha ─────────────────────────────────────────────────────────
 * The same mark sits on the sand header and on the night footer. Flattening it
 * onto white would print a white card around it in both places.
 */
export async function prepareLogo(file: File): Promise<File> {
  const input = Buffer.from(await file.arrayBuffer());

  // What the bytes *are*, not what the upload claimed — see `looksLikeSvg` for
  // why the claim cannot be trusted in either direction.
  let isVector: boolean;
  try {
    isVector = (await sharp(input, { failOn: "none" }).metadata()).format === "svg";
  } catch {
    // Nothing here can read it. An upload that claimed to be an SVG has no safe
    // fallback: storing it as it arrived is the thing this function exists to
    // prevent. Anything else can still be stored unchanged.
    if (looksLikeSvg(file)) {
      throw new UploadError("The SVG could not be rendered", "BAD_FORMAT");
    }
    return file;
  }

  const render = (trim: boolean) => {
    // `density` is read for vector input only; on a raster it is inert.
    const pipeline = sharp(input, { failOn: "none", density: isVector ? 384 : 72 }).rotate();

    return (trim ? pipeline.trim({ threshold: 12 }) : pipeline)
      .resize({
        width: LOGO_MAX_EDGE,
        height: LOGO_MAX_EDGE,
        fit: "inside",
        withoutEnlargement: !isVector,
      })
      // Lossless for vector art: flat fills and hard edges are exactly what a
      // lossy encoder rings around, and the result is still ~15 KB. A raster
      // logo may be a photograph or a gradient, where quality 92 is smaller for
      // no visible difference.
      .webp(isVector ? { lossless: true, effort: 5 } : { quality: 92, effort: 5 })
      .toBuffer();
  };

  let output: Buffer;
  try {
    output = await render(true);
  } catch {
    // `trim()` throws when it would leave nothing — a mark that already reaches
    // every edge, or one whose border is not a single flat colour. Neither is a
    // reason to refuse the upload, so fall back to the untrimmed render.
    try {
      output = await render(false);
    } catch {
      // Readable a moment ago but not encodable — truncated, or a vector whose
      // features librsvg will not draw. Same reasoning as above.
      if (isVector) throw new UploadError("The SVG could not be rendered", "BAD_FORMAT");
      return file;
    }
  }

  const name = file.name.replace(/\.[^.]+$/, "") || "logo";
  return new File([new Uint8Array(output)], `${name}.webp`, { type: "image/webp" });
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
 * So the size checks run here, before any decoder sees anything. The format
 * check waits one step: the claimed type is only the file's extension, so the
 * bytes are sniffed and normalised first (`normalizeUpload` — an HEIC named
 * .webp becomes a real WebP) and the allow-list is then applied to what the
 * file actually is. The inner adapter still repeats the assertion — it must stay
 * usable undecorated, and the check is a few comparisons.
 */
export class OptimizingStorage implements StorageAdapter {
  readonly name: string;

  constructor(private readonly inner: StorageAdapter) {
    this.name = `${inner.name}+optimize`;
  }

  async save(file: File, opts?: { folder?: string }): Promise<StoredFile> {
    assertUploadable(file);
    const real = await normalizeUpload(file);
    assertValidImage(real);
    return this.inner.save(await optimizeImage(real), opts);
  }

  delete(keyOrUrl: string): Promise<void> {
    return this.inner.delete(keyOrUrl);
  }
}
