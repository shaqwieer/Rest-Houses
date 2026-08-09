/**
 * Image storage contract.
 *
 * Every upload in the app goes through this interface, so swapping local disk
 * for Cloudinary/S3 is a one-line change in `STORAGE_DRIVER` — no component or
 * server action needs to know where bytes live. Adapters return a URL that is
 * safe to hand to `next/image`.
 */

export type StoredFile = {
  /** Public URL of the stored object, e.g. "/uploads/ab12.webp" or a CDN URL. */
  url: string;
  /** Provider-specific handle used by `delete()` (path, public_id, key…). */
  key: string;
  width?: number;
  height?: number;
  bytes?: number;
};

export interface StorageAdapter {
  readonly name: string;
  /** Persist a file and return its public URL. */
  save(file: File, opts?: { folder?: string }): Promise<StoredFile>;
  /** Remove a previously stored object. Must not throw if already gone. */
  delete(keyOrUrl: string): Promise<void>;
}

/** Uploads we accept. Kept narrow on purpose — this is a public endpoint. */
export const ALLOWED_IMAGE_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/avif",
] as const;

export const SVG_TYPE = "image/svg+xml";

/**
 * The brand logo accepts one format the galleries do not: SVG.
 *
 * A designer hands over a logo as a vector, so refusing SVG means the operator
 * has to find someone to export a PNG before they can put their own mark on
 * their own site. Two things make it safe here where it would not be on the
 * gallery endpoint:
 *
 *   * the logo can only be replaced by an admin (`uploadLogo` calls
 *     `requireAdmin`), whereas listing photos come from every owner; and
 *   * no SVG is ever *stored*. `prepareLogo` rasterises it on the way in, so
 *     nothing that can carry script is ever served back from our origin. That
 *     also means `dangerouslyAllowSVG` stays off in next.config.ts, which is
 *     what protects every other image path.
 */
export const ALLOWED_LOGO_TYPES = [...ALLOWED_IMAGE_TYPES, SVG_TYPE] as const;

/**
 * Whether an upload is *offering* an SVG.
 *
 * `File.type` is filled in by the operating system's file-type registry, and on
 * a machine where .svg is not registered the browser sends "" or "text/xml"
 * instead. Rejecting those would mean the operator's logo is refused for a
 * reason that has nothing to do with the file, with a message telling them to
 * use a format they already are.
 *
 * This is only ever a hint about intent. What the bytes actually are is decided
 * in `prepareLogo`, by the decoder, and they are rasterised either way — so a
 * JPEG renamed `.svg` is handled as the JPEG it is rather than trusted.
 */
export function looksLikeSvg(file: File): boolean {
  return file.type === SVG_TYPE || /\.svg$/i.test(file.name ?? "");
}

export const MAX_UPLOAD_BYTES = 200 * 1024 * 1024; // 200 MB

/**
 * An upload the adapters refused.
 *
 * Carries a stable `code` alongside the message so the *caller* can translate
 * it. This module is provider-agnostic plumbing shared by the local, database,
 * S3 and Cloudinary adapters — it has no request scope and therefore no locale,
 * so translating here would mean hard-coding one language for everyone. The
 * message stays as a last-resort fallback for anything that logs it directly.
 */
export type UploadErrorCode =
  | "NO_FILE"
  | "EMPTY"
  | "TOO_LARGE"
  | "BAD_FORMAT"
  | "FAILED";

export class UploadError extends Error {
  constructor(
    message: string,
    public readonly code: UploadErrorCode = "FAILED",
  ) {
    super(message);
    this.name = "UploadError";
  }
}

/**
 * Shared validation so every adapter enforces the same limits.
 *
 * `accept` widens the format list for one caller only — the logo upload, which
 * additionally takes SVG. Everything else keeps the default, so the gallery
 * endpoint is not loosened by a change made for the brand mark.
 */
export function assertValidImage(
  file: File,
  accept: readonly string[] = ALLOWED_IMAGE_TYPES,
): void {
  if (!file || typeof file.size !== "number") {
    throw new UploadError("No valid file was sent", "NO_FILE");
  }
  if (file.size === 0) {
    throw new UploadError("The file is empty", "EMPTY");
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    throw new UploadError("The image exceeds the size limit", "TOO_LARGE");
  }
  if (!accept.includes(file.type)) {
    throw new UploadError("Unsupported image format", "BAD_FORMAT");
  }
}
