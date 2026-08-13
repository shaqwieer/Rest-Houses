import { inflateRawSync } from "node:zlib";

/**
 * Reads an .xlsx back out again, so the export tests can assert on what Excel
 * would actually see.
 *
 * Deliberately not the writer's own code running backwards: it walks the zip
 * from the end-of-central-directory record the way any reader does, and checks
 * every CRC. A workbook whose CRCs are computed over the compressed bytes
 * instead of the plain ones still inflates perfectly and still makes Excel
 * refuse the file — so the check belongs here, where it fails loudly.
 */

let table: Uint32Array | null = null;

function crc32(data: Buffer): number {
  if (!table) {
    table = new Uint32Array(256);
    for (let i = 0; i < 256; i++) {
      let c = i;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      table[i] = c >>> 0;
    }
  }
  let crc = 0xffffffff;
  for (let i = 0; i < data.length; i++) crc = table[(crc ^ data[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

/** Every part in the zip, in the order they were written. */
export function unzip(buffer: Buffer): Map<string, Buffer> {
  let eocd = -1;
  for (let i = buffer.length - 22; i >= 0; i--) {
    if (buffer.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error("not a zip: no end-of-central-directory record");

  const count = buffer.readUInt16LE(eocd + 10);
  let p = buffer.readUInt32LE(eocd + 16);
  const parts = new Map<string, Buffer>();

  for (let i = 0; i < count; i++) {
    if (buffer.readUInt32LE(p) !== 0x02014b50) throw new Error("bad central directory entry");
    const method = buffer.readUInt16LE(p + 10);
    const crc = buffer.readUInt32LE(p + 16);
    const compressedSize = buffer.readUInt32LE(p + 20);
    const nameLength = buffer.readUInt16LE(p + 28);
    const extraLength = buffer.readUInt16LE(p + 30);
    const commentLength = buffer.readUInt16LE(p + 32);
    const localOffset = buffer.readUInt32LE(p + 42);
    const name = buffer.subarray(p + 46, p + 46 + nameLength).toString("utf8");

    if (buffer.readUInt32LE(localOffset) !== 0x04034b50) {
      throw new Error(`bad local header for ${name}`);
    }
    const start =
      localOffset + 30 + buffer.readUInt16LE(localOffset + 26) + buffer.readUInt16LE(localOffset + 28);
    const raw = buffer.subarray(start, start + compressedSize);
    const data = method === 8 ? inflateRawSync(raw) : Buffer.from(raw);

    if (crc32(data) !== crc) throw new Error(`CRC mismatch for ${name}`);
    parts.set(name, data);
    p += 46 + nameLength + extraLength + commentLength;
  }

  return parts;
}

export type SheetCell = {
  ref: string;
  kind: "number" | "text";
  /** The raw cell value: the digits for a number, the string for text. */
  value: string;
  /** Index into the workbook's cell formats — 2 and 3 are the date formats. */
  style: number;
};

export type ReadSheet = {
  parts: string[];
  name: string;
  rightToLeft: boolean;
  cells: SheetCell[];
  /** The worksheet part verbatim, for assertions about encoding. */
  xml: string;
};

const CELL = /<c r="([A-Z]+\d+)"(?: s="(\d+)")?(?: t="(\w+)")?>(.*?)<\/c>/g;

export function readSheet(workbook: Buffer): ReadSheet {
  const parts = unzip(workbook);
  const sheet = parts.get("xl/worksheets/sheet1.xml");
  if (!sheet) throw new Error("no worksheet part");
  const xml = sheet.toString("utf8");

  const cells: SheetCell[] = [];
  for (const match of xml.matchAll(CELL)) {
    const [, ref, style, type, body] = match;
    if (type === "inlineStr") {
      const t = /<t[^>]*>([\s\S]*?)<\/t>/.exec(body);
      cells.push({
        ref,
        kind: "text",
        value: (t?.[1] ?? "")
          .replace(/&lt;/g, "<")
          .replace(/&gt;/g, ">")
          .replace(/&amp;/g, "&"),
        style: Number(style ?? 0),
      });
    } else {
      const v = /<v>([\s\S]*?)<\/v>/.exec(body);
      cells.push({ ref, kind: "number", value: v?.[1] ?? "", style: Number(style ?? 0) });
    }
  }

  const name = /<sheet name="([^"]*)"/.exec(parts.get("xl/workbook.xml")!.toString("utf8"));

  return {
    parts: [...parts.keys()],
    name: name?.[1] ?? "",
    rightToLeft: /rightToLeft="1"/.test(xml),
    cells,
    xml,
  };
}

/** The cell at a reference, or undefined if that cell was left empty. */
export function cellAt(sheet: ReadSheet, ref: string): SheetCell | undefined {
  return sheet.cells.find((cell) => cell.ref === ref);
}

/** Every cell whose text matches, for finding a row without hard-coding its number. */
export function rowOf(sheet: ReadSheet, label: string): SheetCell[] {
  const anchor = sheet.cells.find((cell) => cell.kind === "text" && cell.value === label);
  if (!anchor) return [];
  const row = /\d+$/.exec(anchor.ref)![0];
  return sheet.cells.filter((cell) => /\d+$/.exec(cell.ref)![0] === row);
}
