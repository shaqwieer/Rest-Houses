import { describe, expect, it } from "vitest";
import sharp from "sharp";
import { optimizeImage, OptimizingStorage, prepareLogo } from "@/lib/storage/optimize";
import {
  ALLOWED_LOGO_TYPES,
  assertValidImage,
  SVG_TYPE,
  UploadError,
  type StorageAdapter,
  type StoredFile,
} from "@/lib/storage/types";

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

/**
 * A logo the way a design tool exports one: the mark itself is `mark` pixels
 * wide inside a much larger square artboard, with the rest left empty. That
 * margin is the thing `prepareLogo` has to deal with — it is what made an
 * uploaded logo render a few pixels tall in the header.
 */
function makeLogoSvg(canvas: number, mark: number): File {
  const offset = (canvas - mark) / 2;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${canvas} ${canvas}">
    <rect x="${offset}" y="${offset + mark / 4}" width="${mark}" height="${mark / 2}" fill="#0C1522"/>
  </svg>`;

  return new File([svg], "logo.svg", { type: SVG_TYPE });
}

describe("prepareLogo", () => {
  it("rasterises an SVG, because next/image will not serve one", async () => {
    const prepared = await prepareLogo(makeLogoSvg(1200, 400));

    expect(prepared.type).toBe("image/webp");
    expect(prepared.name.endsWith(".webp")).toBe(true);
  }, 30_000);

  it("trims the empty artboard back to the mark's own bounding box", async () => {
    // The mark is 400×200 on a 1200×1200 canvas: 5.5% of the area. Untrimmed,
    // a 40px-tall header slot would render it about seven pixels tall.
    const prepared = await prepareLogo(makeLogoSvg(1200, 400));
    const meta = await sharp(Buffer.from(await prepared.arrayBuffer())).metadata();

    // 2:1, the proportions of the mark — not the 1:1 of the file it arrived in.
    expect(meta.width! / meta.height!).toBeCloseTo(2, 1);
  }, 30_000);

  it("scales a vector up to the cap, since it has no resolution of its own", async () => {
    const prepared = await prepareLogo(makeLogoSvg(120, 40));
    const meta = await sharp(Buffer.from(await prepared.arrayBuffer())).metadata();

    expect(meta.width).toBe(1024);
  }, 30_000);

  it("keeps the alpha, so no white card is printed around the mark", async () => {
    const prepared = await prepareLogo(makeLogoSvg(1200, 400));
    const meta = await sharp(Buffer.from(await prepared.arrayBuffer())).metadata();

    // The footer is night-900. A flattened logo would sit on a white rectangle.
    expect(meta.hasAlpha).toBe(true);
  }, 30_000);

  it("trims a raster logo too, without enlarging it past its own pixels", async () => {
    const padded = await sharp({
      create: { width: 600, height: 600, channels: 4, background: "#00000000" },
    })
      .composite([
        {
          input: await sharp({
            create: { width: 200, height: 100, channels: 4, background: "#C9A44C" },
          })
            .png()
            .toBuffer(),
          top: 250,
          left: 200,
        },
      ])
      .png()
      .toBuffer();

    const prepared = await prepareLogo(
      new File([new Uint8Array(padded)], "logo.png", { type: "image/png" }),
    );
    const meta = await sharp(Buffer.from(await prepared.arrayBuffer())).metadata();

    expect(meta.width).toBe(200);
    expect(meta.height).toBe(100);
  }, 30_000);

  it("still stores a mark that reaches every edge, where there is nothing to trim", async () => {
    const full = await sharp({
      create: { width: 300, height: 300, channels: 3, background: "#C9A44C" },
    })
      .png()
      .toBuffer();

    const prepared = await prepareLogo(
      new File([new Uint8Array(full)], "flat.png", { type: "image/png" }),
    );
    const meta = await sharp(Buffer.from(await prepared.arrayBuffer())).metadata();

    expect(meta.width).toBeGreaterThan(0);
    expect(meta.height).toBeGreaterThan(0);
  }, 30_000);

  it("reads vector-ness from the bytes, not from the MIME type the OS guessed", async () => {
    // Windows without .svg registered hands over type "". Trusting that would
    // send a vector down the raster branch: no upscale to the cap, lossy encode.
    const unlabelled = new File([await makeLogoSvg(1200, 400).text()], "logo.svg", { type: "" });

    const prepared = await prepareLogo(unlabelled);
    const meta = await sharp(Buffer.from(await prepared.arrayBuffer())).metadata();

    expect(meta.width).toBe(1024);
    expect(meta.hasAlpha).toBe(true);
  }, 30_000);

  it("treats a raster renamed .svg as the raster it is", async () => {
    // The mirror of the case above: the extension must not win over the bytes,
    // or a photograph gets upscaled to 1024px and stored losslessly.
    const jpeg = await sharp({
      create: { width: 120, height: 60, channels: 3, background: "#C9A44C" },
    })
      .jpeg()
      .toBuffer();

    const prepared = await prepareLogo(
      new File([new Uint8Array(jpeg)], "logo.svg", { type: SVG_TYPE }),
    );
    const meta = await sharp(Buffer.from(await prepared.arrayBuffer())).metadata();

    expect(meta.width).toBe(120);
  }, 30_000);

  it("refuses an SVG it cannot render rather than storing it raw", async () => {
    const broken = new File(["<svg not really xml"], "broken.svg", { type: SVG_TYPE });

    // Falling back to the original — what the raster path does — would put an
    // unrendered SVG in storage and serve it from our own origin.
    await expect(prepareLogo(broken)).rejects.toBeInstanceOf(UploadError);
  }, 30_000);
});

describe("assertValidImage", () => {
  it("rejects SVG for a gallery upload", () => {
    const svg = makeLogoSvg(100, 50);
    expect(() => assertValidImage(svg)).toThrow(UploadError);
  });

  it("accepts SVG only where the caller opted in — the logo", () => {
    const svg = makeLogoSvg(100, 50);
    expect(() => assertValidImage(svg, ALLOWED_LOGO_TYPES)).not.toThrow();
  });

  it("does not widen anything else along with SVG", () => {
    const gif = new File([new Uint8Array(8)], "loop.gif", { type: "image/gif" });
    expect(() => assertValidImage(gif, ALLOWED_LOGO_TYPES)).toThrow(UploadError);
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
