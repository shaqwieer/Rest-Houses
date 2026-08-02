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

/** Shared validation so every adapter enforces the same limits. */
export function assertValidImage(file: File): void {
  if (!file || typeof file.size !== "number") {
    throw new UploadError("No valid file was sent", "NO_FILE");
  }
  if (file.size === 0) {
    throw new UploadError("The file is empty", "EMPTY");
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    throw new UploadError("The image exceeds the size limit", "TOO_LARGE");
  }
  if (!(ALLOWED_IMAGE_TYPES as readonly string[]).includes(file.type)) {
    throw new UploadError("Unsupported image format", "BAD_FORMAT");
  }
}
