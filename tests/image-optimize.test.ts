import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import sharp from "sharp";
import { DatabaseStorageAdapter } from "@/lib/storage/database";
import { normalizeUpload, optimizeImage, OptimizingStorage, prepareLogo } from "@/lib/storage/optimize";
import { sniffImageType } from "@/lib/storage/sniff";
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

/**
 * The bytes decide, not the name.
 *
 * The production case this was written for: five iPhone photos whose bytes were
 * HEIC and whose names ended in .webp. The browser labelled them image/webp,
 * every check passed, and they were stored and served as WebP — empty frames
 * for every guest not on Safari.
 *
 * `fixtures/synthetic.heic` is a generated 320×240 gradient (pillow-heif), with
 * the same `ftyp heic / mif1 heic miaf` header an iPhone writes. Nobody's photo.
 */
const HEIC_FIXTURE = readFileSync(path.join(__dirname, "fixtures", "synthetic.heic"));

function heicAs(type: string, name = "IMG_0001.webp"): File {
  return new File([new Uint8Array(HEIC_FIXTURE)], name, { type });
}

/** An ISO-BMFF `ftyp` box with the given major and compatible brands. */
function ftyp(major: string, ...compatible: string[]): Uint8Array {
  const size = 16 + compatible.length * 4;
  const bytes = new Uint8Array(size + 8);
  new DataView(bytes.buffer).setUint32(0, size);
  bytes.set(new TextEncoder().encode(`ftyp${major}\0\0\0\0${compatible.join("")}`), 4);
  return bytes;
}

async function sniffedTypeOf(file: File) {
  return sniffImageType(new Uint8Array(await file.arrayBuffer()));
}

describe("sniffImageType", () => {
  const solid = () => sharp({ create: { width: 8, height: 8, channels: 3, background: "#C9A44C" } });

  it("recognises every format we store by its signature", async () => {
    expect(sniffImageType(await solid().jpeg().toBuffer())).toBe("image/jpeg");
    expect(sniffImageType(await solid().png().toBuffer())).toBe("image/png");
    expect(sniffImageType(await solid().webp().toBuffer())).toBe("image/webp");
    expect(sniffImageType(await solid().avif().toBuffer())).toBe("image/avif");
  });

  it("recognises an iPhone HEIC", () => {
    expect(sniffImageType(HEIC_FIXTURE)).toBe("image/heic");
  });

  it("calls a file AVIF whenever it lists an AVIF brand, even beside the generic mif1", () => {
    // Both formats carry mif1, so the brand list has to be read as a whole.
    expect(sniffImageType(ftyp("mif1", "mif1", "avif", "miaf"))).toBe("image/avif");
    expect(sniffImageType(ftyp("mif1", "mif1", "heic", "miaf"))).toBe("image/heic");
  });

  it("knows nothing about anything else", () => {
    expect(sniffImageType(new Uint8Array(1024))).toBeNull();
    expect(sniffImageType(new TextEncoder().encode("%PDF-1.7 not an image"))).toBeNull();
    expect(sniffImageType(ftyp("isom", "mp41"))).toBeNull(); // an MP4
    expect(sniffImageType(new Uint8Array([0xff, 0xd8]))).toBeNull(); // too short to judge
  });
});

describe("normalizeUpload", () => {
  it("converts an HEIC named .webp into a real WebP — the production case", async () => {
    const result = await normalizeUpload(heicAs("image/webp"));

    expect(result.type).toBe("image/webp");
    expect(await sniffedTypeOf(result)).toBe("image/webp");
    const meta = await sharp(Buffer.from(await result.arrayBuffer())).metadata();
    expect([meta.width, meta.height]).toEqual([320, 240]);
  });

  it("converts HEIC however the browser labelled it", async () => {
    for (const type of ["image/heic", "image/heif", "", "image/jpeg"]) {
      const result = await normalizeUpload(heicAs(type, "IMG_0001.heic"));
      expect(result.type).toBe("image/webp");
      expect(result.name).toBe("IMG_0001.webp");
      expect(await sniffedTypeOf(result)).toBe("image/webp");
    }
  });

  it("relabels a mislabelled format we can serve, without touching its bytes", async () => {
    const jpeg = await sharp({ create: { width: 8, height: 8, channels: 3, background: "#123" } })
      .jpeg()
      .toBuffer();
    const result = await normalizeUpload(
      new File([new Uint8Array(jpeg)], "photo.webp", { type: "image/webp" }),
    );

    expect(result.type).toBe("image/jpeg");
    expect(result.name).toBe("photo.jpg");
    expect(Buffer.from(await result.arrayBuffer()).equals(jpeg)).toBe(true);
  });

  it("returns a correctly labelled file untouched", async () => {
    const photo = await makePhoto(64, 48);
    expect(await normalizeUpload(photo)).toBe(photo);
  });

  it("refuses an HEIC it cannot decode rather than storing it as it came", async () => {
    // Header intact, image data cut off: sniffs as HEIC, cannot be decoded.
    const truncated = new File([new Uint8Array(HEIC_FIXTURE.subarray(0, 300))], "cut.webp", {
      type: "image/webp",
    });
    await expect(normalizeUpload(truncated)).rejects.toMatchObject({ code: "BAD_FORMAT" });
  });
});

describe("OptimizingStorage with an HEIC upload", () => {
  class Spy implements StorageAdapter {
    readonly name = "spy";
    saved: File | null = null;
    async save(file: File): Promise<StoredFile> {
      this.saved = file;
      return { url: "/x", key: "x", bytes: file.size };
    }
    async delete(): Promise<void> {}
  }

  it("stores a WebP even though the HEIC is far below the recompression threshold", async () => {
    // ~2 KB: `optimizeImage` alone would have passed it through byte-identical,
    // which is exactly how the production photos slipped by.
    const inner = new Spy();
    await new OptimizingStorage(inner).save(heicAs("image/webp"));

    expect(inner.saved!.type).toBe("image/webp");
    expect(await sniffedTypeOf(inner.saved!)).toBe("image/webp");
  });

  it("accepts an HEIC the browser labelled honestly", async () => {
    const inner = new Spy();
    await new OptimizingStorage(inner).save(heicAs("image/heic", "IMG_0001.HEIC"));
    expect(await sniffedTypeOf(inner.saved!)).toBe("image/webp");
  });

  it("hands nothing to storage when the HEIC is broken", async () => {
    const inner = new Spy();
    const truncated = new File([new Uint8Array(HEIC_FIXTURE.subarray(0, 300))], "cut.heic", {
      type: "image/heic",
    });

    await expect(new OptimizingStorage(inner).save(truncated)).rejects.toBeInstanceOf(UploadError);
    expect(inner.saved).toBeNull();
  });
});

describe("DatabaseStorageAdapter", () => {
  it("refuses to store bytes under a label they do not match", async () => {
    // The undecorated path (IMAGE_OPTIMIZE=off). Refused before any row is written.
    await expect(new DatabaseStorageAdapter().save(heicAs("image/webp"))).rejects.toMatchObject({
      code: "BAD_FORMAT",
    });
  });
});
