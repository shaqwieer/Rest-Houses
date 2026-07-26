import { randomUUID } from "node:crypto";
import { mkdir, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { assertValidImage, type StorageAdapter, type StoredFile } from "./types";

/**
 * Local-disk adapter (the default).
 *
 * Writes into `public/uploads/`, which Next serves statically — no S3 account,
 * no API keys, works offline. Good enough for a single self-hosted VPS.
 *
 * Caveat to know before you scale: files live on the container's filesystem, so
 * on an ephemeral host (Vercel, Heroku, a fresh container per deploy) uploads
 * vanish on redeploy. Either mount `public/uploads` as a persistent volume or
 * switch STORAGE_DRIVER to "cloudinary"/"s3".
 */

const UPLOAD_ROOT = path.join(process.cwd(), "public", "uploads");

const EXT_BY_TYPE: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/avif": "avif",
};

export class LocalStorageAdapter implements StorageAdapter {
  readonly name = "local";

  async save(file: File, opts?: { folder?: string }): Promise<StoredFile> {
    assertValidImage(file);

    // Folder is caller-supplied, so hard-restrict it to a safe segment: no
    // "..", no separators, nothing that could escape public/uploads.
    const folder = (opts?.folder ?? "listings").replace(/[^a-z0-9-]/gi, "");
    const dir = path.join(UPLOAD_ROOT, folder);
    await mkdir(dir, { recursive: true });

    const ext = EXT_BY_TYPE[file.type] ?? "jpg";
    // Random name: never trust the client filename, and avoid collisions.
    const filename = `${randomUUID()}.${ext}`;
    const absolute = path.join(dir, filename);

    const bytes = Buffer.from(await file.arrayBuffer());
    await writeFile(absolute, bytes);

    const url = `/uploads/${folder}/${filename}`;
    return { url, key: url, bytes: bytes.byteLength };
  }

  async delete(keyOrUrl: string): Promise<void> {
    // Accept either the stored key or the public URL.
    const relative = keyOrUrl.replace(/^\/?uploads\//, "");
    const absolute = path.join(UPLOAD_ROOT, relative);

    // Refuse anything that resolves outside the upload root.
    if (!absolute.startsWith(UPLOAD_ROOT)) return;

    try {
      await unlink(absolute);
    } catch {
      // Already deleted, or never existed — deletion is idempotent by contract.
    }
  }
}
