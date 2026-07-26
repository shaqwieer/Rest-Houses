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

export const MAX_UPLOAD_BYTES = 8 * 1024 * 1024; // 8 MB

export class UploadError extends Error {}

/** Shared validation so every adapter enforces the same limits. */
export function assertValidImage(file: File): void {
  if (!file || typeof file.size !== "number") {
    throw new UploadError("لم يتم إرسال ملف صالح");
  }
  if (file.size === 0) {
    throw new UploadError("الملف فارغ");
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    throw new UploadError("حجم الصورة أكبر من ٨ ميغابايت");
  }
  if (!(ALLOWED_IMAGE_TYPES as readonly string[]).includes(file.type)) {
    throw new UploadError("صيغة غير مدعومة — استخدم JPG أو PNG أو WebP");
  }
}
