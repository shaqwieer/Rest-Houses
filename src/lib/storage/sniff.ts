/**
 * What an upload's bytes actually are, read from its first few bytes.
 *
 * ─── Why the browser's word is not enough ───────────────────────────────────
 * `File.type` is not read from the file. The browser derives it from the
 * *extension*, so a photo is whatever its name says it is. That is exactly how
 * five iPhone photos reached a live gallery as "image/webp": the bytes were
 * HEIC, the names ended in .webp, every check passed, and the database served
 * them with a WebP label. Safari decodes HEIC natively, so the owner — on an
 * iPhone — saw a full gallery; every guest on Android or Windows Chrome saw
 * empty frames. Nothing on our side ever noticed.
 *
 * So the claim is now only a hint and the signature decides. This reads magic
 * numbers, it does not decode anything, which is why it is safe to run on bytes
 * no validation has vouched for yet.
 */

/** The formats an upload can turn out to be. HEIC is accepted only to be converted. */
export type SniffedImageType =
  | "image/jpeg"
  | "image/png"
  | "image/webp"
  | "image/avif"
  | "image/heic";

/** File extension for each format we store, used when a file is relabelled. */
export const EXT_BY_SNIFFED_TYPE: Record<SniffedImageType, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/avif": "avif",
  "image/heic": "heic",
};

const AVIF_BRANDS = new Set(["avif", "avis"]);

/**
 * HEIF brands whose image payload is (almost always) HEVC.
 *
 * `mif1`/`msf1` are the generic HEIF brands and AVIF files carry them too, which
 * is why AVIF is checked first: a file listing `avif` anywhere is AVIF whatever
 * else it lists. A bare `mif1` with no AVIF brand is treated as HEIC and left to
 * the decoder to confirm — if it is something else it fails there and is
 * refused, never stored.
 */
const HEIC_BRANDS = new Set(["heic", "heix", "hevc", "hevx", "heim", "heis", "hevm", "hevs", "mif1", "msf1"]);

function ascii(bytes: Uint8Array, start: number, end: number): string {
  return String.fromCharCode(...bytes.subarray(start, end));
}

export function sniffImageType(bytes: Uint8Array): SniffedImageType | null {
  if (bytes.length < 12) return null;

  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";

  if (
    bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47 &&
    bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a
  ) {
    return "image/png";
  }

  if (ascii(bytes, 0, 4) === "RIFF" && ascii(bytes, 8, 12) === "WEBP") return "image/webp";

  // ISO-BMFF (AVIF, HEIC): a leading `ftyp` box holding a major brand at 8..12,
  // a minor version at 12..16, then compatible brands to the end of the box.
  if (ascii(bytes, 4, 8) === "ftyp") {
    const boxSize = ((bytes[0] << 24) | (bytes[1] << 16) | (bytes[2] << 8) | bytes[3]) >>> 0;
    const end = Math.min(boxSize >= 16 ? boxSize : 16, bytes.length);

    const brands = [ascii(bytes, 8, 12)];
    for (let i = 16; i + 4 <= end; i += 4) brands.push(ascii(bytes, i, i + 4));

    if (brands.some((b) => AVIF_BRANDS.has(b))) return "image/avif";
    if (brands.some((b) => HEIC_BRANDS.has(b))) return "image/heic";
  }

  return null;
}
