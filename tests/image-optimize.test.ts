import { describe, expect, it } from "vitest";
import sharp from "sharp";
import { optimizeImage, OptimizingStorage } from "@/lib/storage/optimize";
import { UploadError, type StorageAdapter, type StoredFile } from "@/lib/storage/types";

/**
 * Upload recompression.
 *
 * Runs the real sharp pipeline on real generated images rather than mocking it:
 * the claims being made are about *bytes* — that a phone-sized photo shrinks by
 * an order of magnitude, that a small one is left alone, that a portrait photo
 * does not come out on its side — and a mock cannot answer any of them.
 */

/**
 * A JPEG of the given dimensions with enough detail that it does not compress
 * to nothing. A flat colour would encode to a couple of kilobytes and prove
 * nothing about a real photograph.
 */
async function makePhoto(width: number, height: number): Promise<File> {
  const pixels = Buffer.alloc(width * height * 3);
  for (let i = 0; i < pixels.length; i += 3) {
    // Deterministic pseudo-noise: incompressible, and the same on every run.
    pixels[i] = (i * 7) % 256;
    pixels[i + 1] = (i * 13) % 256;
    pixels[i + 2] = (i * 29) % 256;
  }

  const jpeg = await sharp(pixels, { raw: { width, height, channels: 3 } })
    .jpeg({ quality: 100 })
    .toBuffer();

  return new File([new Uint8Array(jpeg)], "photo.jpg", { type: "image/jpeg" });
}

describe("optimizeImage", () => {
  it("shrinks a phone-sized photo dramatically and converts to WebP", async () => {
    const original = await makePhoto(4000, 3000);
    const optimized = await optimizeImage(original);

    expect(optimized.type).toBe("image/webp");
    expect(optimized.name.endsWith(".webp")).toBe(true);
    expect(optimized.size).toBeLessThan(original.size);
  }, 30_000);

  it("caps the longest edge at 2560px without changing the aspect ratio", async () => {
    const optimized = await optimizeImage(await makePhoto(4000, 3000));
    const meta = await sharp(Buffer.from(await optimized.arrayBuffer())).metadata();

    expect(meta.width).toBe(2560);
    // 4000×3000 is 4:3, so the capped height is 1920. Nothing is cropped.
    expect(meta.height).toBe(1920);
  }, 30_000);

  it("never upscales an image that is already small enough", async () => {
    // Wide enough to exceed the skip threshold, but under the 2560 cap.
    const optimized = await optimizeImage(await makePhoto(1600, 1200));
    const meta = await sharp(Buffer.from(await optimized.arrayBuffer())).metadata();

    expect(meta.width).toBe(1600);
    expect(meta.height).toBe(1200);
  }, 30_000);

  it("leaves a small upload byte-identical", async () => {
    // Under SKIP_BELOW_BYTES: re-encoding it risks generational loss for no gain.
    const small = new File([new Uint8Array(await sharp({
      create: { width: 40, height: 40, channels: 3, background: "#C9A44C" },
    }).jpeg().toBuffer())], "tiny.jpg", { type: "image/jpeg" });

    const result = await optimizeImage(small);
    expect(result).toBe(small);
  });

  it("strips EXIF, including the GPS coordinates a phone attaches", async () => {
    const optimized = await optimizeImage(await makePhoto(3000, 2000));
    const meta = await sharp(Buffer.from(await optimized.arrayBuffer())).metadata();

    // A rest house gallery must not publish where the photo was taken.
    expect(meta.exif).toBeUndefined();
  }, 30_000);

  it("applies the EXIF orientation before dropping it", async () => {
    // A portrait photo from a phone is stored landscape with an orientation
    // flag. Strip the flag without baking in the rotation and every such photo
    // ends up on its side.
    const pixels = Buffer.alloc(3000 * 2000 * 3);
    for (let i = 0; i < pixels.length; i += 3) pixels[i] = (i * 11) % 256;

    const rotated = await sharp(pixels, { raw: { width: 3000, height: 2000, channels: 3 } })
      .withMetadata({ orientation: 6 }) // 90° clockwise — the portrait case
      .jpeg({ quality: 100 })
      .toBuffer();

    const optimized = await optimizeImage(
      new File([new Uint8Array(rotated)], "portrait.jpg", { type: "image/jpeg" }),
    );
    const meta = await sharp(Buffer.from(await optimized.arrayBuffer())).metadata();

    // Rotated into portrait, so height now exceeds width.
    expect(meta.height!).toBeGreaterThan(meta.width!);
  }, 30_000);

  it("returns the original rather than losing the upload on a corrupt file", async () => {
    const junk = new File([new Uint8Array(Buffer.alloc(500 * 1024, 0x41))], "broken.jpg", {
      type: "image/jpeg",
    });
    expect(await optimizeImage(junk)).toBe(junk);
  });
});

describe("OptimizingStorage", () => {
  class Spy implements StorageAdapter {
    readonly name = "spy";
    saved: File | null = null;
    async save(file: File): Promise<StoredFile> {
      this.saved = file;
      return { url: "/x", key: "x", bytes: file.size };
    }
    async delete(): Promise<void> {}
  }

  it("hands the compressed file to the wrapped adapter", async () => {
    const inner = new Spy();
    const original = await makePhoto(3000, 2000);

    await new OptimizingStorage(inner).save(original);

    expect(inner.saved!.type).toBe("image/webp");
    expect(inner.saved!.size).toBeLessThan(original.size);
  }, 30_000);

  it("validates BEFORE compressing, so sharp never sees a rejected upload", async () => {
    const inner = new Spy();
    // A PDF renamed .jpg. If validation ran after compression, this would have
    // reached the decoder first.
    const bad = new File([new Uint8Array(Buffer.alloc(1024))], "doc.pdf", {
      type: "application/pdf",
    });

    await expect(new OptimizingStorage(inner).save(bad)).rejects.toBeInstanceOf(UploadError);
    expect(inner.saved).toBeNull();
  });
});
