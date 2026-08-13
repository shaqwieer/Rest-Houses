import { deflateRawSync } from "node:zlib";

/**
 * A one-sheet .xlsx, written by hand.
 *
 * ─── Why not a CSV ───────────────────────────────────────────────────────────
 * A CSV is bytes with no statement of what encoding they are, so every reader
 * guesses. Excel on Windows guesses the system codepage and renders every
 * Arabic heading as "Ø§Ù„...", and the two usual fixes fight each other: a UTF-8
 * BOM says "this is Unicode", a leading `sep=,` line says "the delimiter is a
 * comma", and Excel consumes that first line — BOM and all — before it has
 * decided on an encoding. Drop the `sep=` line and a machine whose regional
 * list separator is a semicolon (which is most Arabic Windows locales) puts the
 * whole sheet in column A instead.
 *
 * An .xlsx has no such argument to lose. It is a zip of XML, the XML declares
 * `encoding="UTF-8"`, and there is no delimiter to guess at. Arabic arrives as
 * Arabic on every machine, phone included.
 *
 * ─── Why no library ──────────────────────────────────────────────────────────
 * The whole format, for a sheet of values, is five small XML parts in a zip.
 * That is this file. A spreadsheet library would bring styling, formulas, chart
 * support and a supply chain, to write cells.
 *
 * ─── Types are the point ─────────────────────────────────────────────────────
 * A number written as text cannot be summed, sorted or charted, and a date
 * written as text cannot be plotted against time — which is the entire reason
 * somebody exports a dashboard. So cells carry their type: `num` becomes a
 * numeric cell, `date` a real date with a display format, `text` a string.
 */

/* -------------------------------------------------------------------------- */
/* Cells                                                                      */
/* -------------------------------------------------------------------------- */

export type Cell =
  | { t: "text"; v: string; bold?: boolean }
  | { t: "num"; v: number }
  /** `v` is an ISO date; `month` shows it as "Aug 2026" rather than the 1st. */
  | { t: "date"; v: string; month?: boolean }
  /** An empty cell. Written as nothing at all — .xlsx rows are sparse. */
  | null;

export type Row = Cell[];

export const text = (v: string): Cell => ({ t: "text", v });
export const head = (v: string): Cell => ({ t: "text", v, bold: true });
export const num = (v: number): Cell => ({ t: "num", v });
export const date = (v: string, month = false): Cell => ({ t: "date", v, month });

/** `num`, or an empty cell — for the many measures that are null until there
 *  is data. A 0 would be a claim; a blank is the absence of one. */
export const maybeNum = (v: number | null | undefined): Cell =>
  v === null || v === undefined ? null : num(v);

export type Sheet = {
  name: string;
  rows: Row[];
  /** Column widths in characters. Short array is fine; the rest default. */
  widths?: number[];
  /** Arabic sheets read right to left, column A on the right. */
  rightToLeft?: boolean;
};

/* -------------------------------------------------------------------------- */
/* XML                                                                        */
/* -------------------------------------------------------------------------- */

const DECL = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';

/**
 * Escapes text for XML content.
 *
 * The control-character strip matters: a rest house name is user-entered, and a
 * stray 0x01 in it is not merely ugly, it makes the XML ill-formed and Excel
 * refuses to open the whole workbook with an unhelpful "unreadable content"
 * dialog. Tab, newline and carriage return are the three that are legal.
 */
function xml(value: string): string {
  return value
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    // Escaped for element text it does not need to be, but this same function
    // writes the sheet name into an attribute, where a bare quote ends it early.
    .replace(/"/g, "&quot;");
}

/** 0 → "A", 25 → "Z", 26 → "AA". */
function columnName(index: number): string {
  let name = "";
  for (let n = index; n >= 0; n = Math.floor(n / 26) - 1) {
    name = String.fromCharCode(65 + (n % 26)) + name;
  }
  return name;
}

/**
 * Excel counts days from 1899-12-30 — one before its own stated epoch, because
 * it also believes 1900 was a leap year and the offset absorbs the phantom day.
 */
const SERIAL_EPOCH = Date.UTC(1899, 11, 30);

function dateSerial(iso: string): number {
  return Math.round((Date.parse(`${iso}T00:00:00Z`) - SERIAL_EPOCH) / 86_400_000);
}

/* Style indices, matching the `cellXfs` order in `STYLES` below. */
const STYLE_DEFAULT = 0;
const STYLE_BOLD = 1;
const STYLE_DAY = 2;
const STYLE_MONTH = 3;

const STYLES = `${DECL}
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<numFmts count="2"><numFmt numFmtId="164" formatCode="yyyy\\-mm\\-dd"/><numFmt numFmtId="165" formatCode="mmm\\ yyyy"/></numFmts>
<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts>
<fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>
<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="4"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/><xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/><xf numFmtId="165" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/></cellXfs>
<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`;

function cellXml(cell: Cell, ref: string): string {
  if (cell === null) return "";
  if (cell.t === "num") {
    // Guard the non-finite cases: Infinity or NaN in a <v> is not a number as
    // far as Excel is concerned and corrupts the part.
    if (!Number.isFinite(cell.v)) return "";
    return `<c r="${ref}"><v>${cell.v}</v></c>`;
  }
  if (cell.t === "date") {
    const serial = dateSerial(cell.v);
    if (!Number.isFinite(serial)) return "";
    const style = cell.month ? STYLE_MONTH : STYLE_DAY;
    return `<c r="${ref}" s="${style}"><v>${serial}</v></c>`;
  }
  const style = cell.bold ? STYLE_BOLD : STYLE_DEFAULT;
  // `xml:space="preserve"` or Excel trims leading and trailing spaces.
  // `inlineStr` rather than a shared string table: one fewer part, one fewer
  // index to keep in step, and no measurable size difference at this scale.
  return `<c r="${ref}" s="${style}" t="inlineStr"><is><t xml:space="preserve">${xml(cell.v)}</t></is></c>`;
}

function sheetXml(sheet: Sheet): string {
  const cols = (sheet.widths ?? [])
    .map((width, i) => `<col min="${i + 1}" max="${i + 1}" width="${width}" customWidth="1"/>`)
    .join("");

  const rows = sheet.rows
    .map((cells, r) => {
      const body = cells.map((cell, c) => cellXml(cell, `${columnName(c)}${r + 1}`)).join("");
      return body ? `<row r="${r + 1}">${body}</row>` : `<row r="${r + 1}"/>`;
    })
    .join("");

  return `${DECL}
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<sheetViews><sheetView${sheet.rightToLeft ? ' rightToLeft="1"' : ""} tabSelected="1" workbookViewId="0"/></sheetViews>
${cols ? `<cols>${cols}</cols>` : ""}
<sheetData>${rows}</sheetData>
</worksheet>`;
}

/** Excel rejects these outright in a tab name, and caps it at 31 characters. */
function sheetName(name: string): string {
  const cleaned = name.replace(/[[\]:*?/\\]/g, " ").trim();
  return (cleaned || "Sheet1").slice(0, 31);
}

/* -------------------------------------------------------------------------- */
/* Zip                                                                        */
/* -------------------------------------------------------------------------- */

let crcTable: Uint32Array | null = null;

function crc32(data: Buffer): number {
  if (!crcTable) {
    crcTable = new Uint32Array(256);
    for (let i = 0; i < 256; i++) {
      let c = i;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crcTable[i] = c >>> 0;
    }
  }
  let crc = 0xffffffff;
  for (let i = 0; i < data.length; i++) {
    crc = crcTable[(crc ^ data[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

const u16 = (n: number) => {
  const b = Buffer.alloc(2);
  b.writeUInt16LE(n & 0xffff);
  return b;
};

const u32 = (n: number) => {
  const b = Buffer.alloc(4);
  b.writeUInt32LE(n >>> 0);
  return b;
};

/**
 * A fixed timestamp rather than the clock.
 *
 * Nothing reads the mtime of a zip entry here, and a constant makes the same
 * figures produce the same bytes — which is what lets a test assert on output
 * and what stops two downloads of an unchanged report differing.
 *
 * DOS date packing: ((year - 1980) << 9) | (month << 5) | day, for 2026-01-01.
 */
const DOS_DATE = ((2026 - 1980) << 9) | (1 << 5) | 1;
const DOS_TIME = 0;

type Entry = { name: string; data: Buffer };

function zip(entries: Entry[]): Buffer {
  const local: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;

  for (const entry of entries) {
    const name = Buffer.from(entry.name, "utf8");
    const compressed = deflateRawSync(entry.data);
    const crc = crc32(entry.data);

    const header = Buffer.concat([
      u32(0x04034b50),
      u16(20), // version needed
      u16(0), // flags
      u16(8), // deflate
      u16(DOS_TIME),
      u16(DOS_DATE),
      u32(crc),
      u32(compressed.length),
      u32(entry.data.length),
      u16(name.length),
      u16(0), // extra field length
      name,
    ]);

    central.push(
      Buffer.concat([
        u32(0x02014b50),
        u16(20), // version made by
        u16(20), // version needed
        u16(0),
        u16(8),
        u16(DOS_TIME),
        u16(DOS_DATE),
        u32(crc),
        u32(compressed.length),
        u32(entry.data.length),
        u16(name.length),
        u16(0), // extra
        u16(0), // comment
        u16(0), // disk number
        u16(0), // internal attrs
        u32(0), // external attrs
        u32(offset),
        name,
      ]),
    );

    local.push(header, compressed);
    offset += header.length + compressed.length;
  }

  const directory = Buffer.concat(central);
  const end = Buffer.concat([
    u32(0x06054b50),
    u16(0), // this disk
    u16(0), // disk with the directory
    u16(entries.length),
    u16(entries.length),
    u32(directory.length),
    u32(offset),
    u16(0), // comment length
  ]);

  return Buffer.concat([...local, directory, end]);
}

/* -------------------------------------------------------------------------- */

const CONTENT_TYPES = `${DECL}
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
</Types>`;

const ROOT_RELS = `${DECL}
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`;

const WORKBOOK_RELS = `${DECL}
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`;

/** The workbook, as the bytes of an .xlsx file. */
export function buildXlsx(sheet: Sheet): Buffer {
  const workbook = `${DECL}
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<sheets><sheet name="${xml(sheetName(sheet.name))}" sheetId="1" r:id="rId1"/></sheets>
</workbook>`;

  // `[Content_Types].xml` first: it is the part that tells a reader what every
  // other part is, and readers expect to meet it before them.
  return zip([
    { name: "[Content_Types].xml", data: Buffer.from(CONTENT_TYPES, "utf8") },
    { name: "_rels/.rels", data: Buffer.from(ROOT_RELS, "utf8") },
    { name: "xl/workbook.xml", data: Buffer.from(workbook, "utf8") },
    { name: "xl/_rels/workbook.xml.rels", data: Buffer.from(WORKBOOK_RELS, "utf8") },
    { name: "xl/styles.xml", data: Buffer.from(STYLES, "utf8") },
    { name: "xl/worksheets/sheet1.xml", data: Buffer.from(sheetXml(sheet), "utf8") },
  ]);
}
