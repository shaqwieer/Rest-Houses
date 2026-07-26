import { DatabaseStorageAdapter } from "./database";
import { LocalStorageAdapter } from "./local";
import type { StorageAdapter } from "./types";

export * from "./types";

/**
 * Storage driver resolution.
 *
 * Set STORAGE_DRIVER in .env. Adding a provider means writing one class that
 * implements `StorageAdapter` and registering it here — nothing that *calls*
 * `getStorage()` changes.
 *
 *   db          ✅ bytes in the database — default in Docker (stateless container)
 *   local       ✅ files in public/uploads — default outside Docker (zero setup)
 *   cloudinary  → see ./cloudinary.ts.example for a ready-to-paste adapter
 *   s3          → see ./s3.ts.example
 */

const cache = new Map<string, StorageAdapter>();

function build(driver: string): StorageAdapter {
  switch (driver) {
    case "db":
    case "database":
      return new DatabaseStorageAdapter();

    case "local":
      return new LocalStorageAdapter();

    case "cloudinary":
    case "s3":
      // Deliberately explicit rather than silently falling back to local:
      // silently writing to disk on a host with an ephemeral filesystem loses
      // the owner's photos on the next deploy.
      throw new Error(
        `STORAGE_DRIVER="${driver}" is selected but its adapter is not installed yet. ` +
          `Copy src/lib/storage/${driver}.ts.example to ${driver}.ts, install its SDK, ` +
          `register it in src/lib/storage/index.ts, then restart. ` +
          `See the README section "Switching image storage".`,
      );

    default:
      throw new Error(
        `Unknown STORAGE_DRIVER "${driver}". Expected one of: db, local, cloudinary, s3.`,
      );
  }
}

/** The adapter new uploads are written through. */
export function getStorage(): StorageAdapter {
  const driver = (process.env.STORAGE_DRIVER ?? "local").toLowerCase();
  let adapter = cache.get(driver);
  if (!adapter) {
    adapter = build(driver);
    cache.set(driver, adapter);
  }
  return adapter;
}

/**
 * Delete a stored asset, routing on the URL's *shape* rather than on whichever
 * driver happens to be configured right now.
 *
 * This matters because a site's history can span drivers: photos uploaded while
 * STORAGE_DRIVER was "local" keep their `/uploads/…` URLs after a switch to
 * "db". Dispatching on the current driver would try to delete a file path from
 * the database, silently fail, and leak the file forever. Dispatching on the URL
 * always reaches the right adapter.
 *
 * Anything unrecognised (a seed photo on Unsplash, a hand-entered CDN URL) is
 * handed to the current adapter — which is correct for Cloudinary/S3 URLs — and
 * any failure is swallowed, since we don't own assets we didn't upload.
 */
export async function deleteStoredAsset(url: string | null | undefined): Promise<void> {
  if (!url) return;

  try {
    if (url.startsWith("/api/images/")) {
      await new DatabaseStorageAdapter().delete(url);
      return;
    }
    if (url.startsWith("/uploads/")) {
      await new LocalStorageAdapter().delete(url);
      return;
    }
    // Remote URL: only ours to delete if a remote driver is configured.
    const driver = (process.env.STORAGE_DRIVER ?? "local").toLowerCase();
    if (driver === "cloudinary" || driver === "s3") {
      await getStorage().delete(url);
    }
  } catch {
    // Never let a failed cleanup abort the user-facing operation that triggered
    // it — an orphaned blob is a far smaller problem than a failed delete.
  }
}
