import { prisma } from "../prisma";
import { assertValidImage, type StorageAdapter, type StoredFile } from "./types";

/**
 * Database storage adapter — image bytes live in the `StoredImage` table.
 *
 * This is the default inside the Docker image, because it makes the container
 * genuinely stateless: there is no uploads volume to mount, nothing to lose on
 * redeploy, and a single `pg_dump` backs up the site together with its photos.
 *
 * Files are served back by `src/app/api/images/[id]/route.ts`. The returned URL
 * is same-origin, so `next/image` optimises it exactly like a local file — no
 * `remotePatterns` entry needed.
 *
 * See the comment on the `StoredImage` model in prisma/schema.prisma for the
 * read-cost trade-off and when to move to S3/Cloudinary instead.
 */
export class DatabaseStorageAdapter implements StorageAdapter {
  readonly name = "db";

  async save(file: File, opts?: { folder?: string }): Promise<StoredFile> {
    assertValidImage(file);

    const folder = (opts?.folder ?? "listings").replace(/[^a-z0-9-]/gi, "") || "listings";
    const bytes = Buffer.from(await file.arrayBuffer());

    const row = await prisma.storedImage.create({
      data: {
        mimeType: file.type,
        data: bytes,
        size: bytes.byteLength,
        folder,
      },
      // Don't read the blob back out just to build a URL.
      select: { id: true },
    });

    return {
      url: `/api/images/${row.id}`,
      key: row.id,
      bytes: bytes.byteLength,
    };
  }

  async delete(keyOrUrl: string): Promise<void> {
    // Accept either the bare id or the public URL it was handed out as.
    const id = keyOrUrl.startsWith("/api/images/")
      ? keyOrUrl.slice("/api/images/".length).split(/[?#]/)[0]
      : keyOrUrl;

    if (!id) return;

    // `deleteMany` rather than `delete`: deletion is idempotent by contract, and
    // `delete` throws on a missing row — which Prisma also logs as an error even
    // when the throw is caught, leaving alarming noise in the logs for what is a
    // perfectly normal no-op. `deleteMany` simply reports 0 rows affected.
    await prisma.storedImage.deleteMany({ where: { id } });
  }
}
