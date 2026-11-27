import { createRequire } from "node:module";
import { dirname, join, sep } from "node:path";
import { parse } from "csv-parse/sync";
import ExcelJS from "exceljs";
import JSZip from "jszip";
import { SaxesParser } from "saxes";
import { fromBufferPromise } from "yauzl";

export class DocumentError extends Error {}
export type Section = { reference: string; text: string };
export const mediaTypes = {
  pdf: "application/pdf",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  txt: "text/plain",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  csv: "text/csv",
} as const;
export type Format = keyof typeof mediaTypes;

export function fileType(filename: string, mime: string): Format {
  const extension = filename.split(".").at(-1)?.toLowerCase() ?? "";
  if (!filename.includes(".") || !Object.hasOwn(mediaTypes, extension)) throw new DocumentError("Choose a PDF, DOCX, TXT, XLSX or CSV file.");
  const format = extension as Format;
  const type = mime.split(";")[0].trim().toLowerCase();
  if (type && type !== "application/octet-stream" && type !== mediaTypes[format] &&
      !(format === "csv" && ["text/plain", "application/vnd.ms-excel"].includes(type))) {
    throw new DocumentError("The declared file type does not match its extension.");
  }
  return format;
}

function textFile(bytes: Buffer) {
  if (bytes.length > 4 * 1024 ** 2) throw new DocumentError("Text and CSV inputs are limited to 4 MiB.");
  if (bytes.subarray(0, 5).toString("ascii") === "%PDF-") throw new DocumentError("The file signature does not match its text extension.");
  return decode(bytes);
}

function decode(bytes: Buffer) {
  const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  if (/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/u.test(text)) throw new DocumentError("The file contains unsupported control characters.");
  return text;
}

function collector() {
  const sections: Section[] = [];
  let length = 0;
  return {
    sections,
    add(reference: string, input: string) {
      const text = input.replaceAll("\u0000", "").trim();
      if (!text) return;
      if ((length += text.length) > 180_000) throw new DocumentError("This document exceeds the extractable text limit.");
      const chunks = text.match(/[\s\S]{1,2000}/gu) ?? [];
      if (sections.length + chunks.length > 300) throw new DocumentError("This document contains too many sections.");
      for (const [index, chunk] of chunks.entries()) {
        sections.push({ reference: chunks.length > 1 ? reference + " · part " + (index + 1) : reference, text: chunk });
      }
    },
  };
}

function xml(text: string, visitor: (parser: SaxesParser) => void = () => {}) {
  const parser = new SaxesParser();
  parser.on("doctype", () => { throw new DocumentError("Office XML cannot contain a document type or external entities."); });
  parser.on("error", () => { throw new DocumentError("Office XML is malformed."); });
  visitor(parser);
  parser.write(text).close();
}

function checkXml(text: string, name: string) {
  let depth = 0;
  let count = 0;
  let mergedCells = 0;
  xml(text, (parser) => {
    parser.on("opentag", (tag) => {
      if (++depth > 64 || ++count > 120_000) throw new DocumentError("Office XML exceeds the structural limits.");
      const local = tag.name.split(":").at(-1);
      if (local === "Relationship" && tag.attributes.TargetMode?.toLowerCase() === "external") {
        throw new DocumentError("Office files with external relationships are unsupported.");
      }
      if (local === "Override" || local === "Default") {
        if (/macroenabled|vbaproject/i.test(tag.attributes.ContentType ?? "")) throw new DocumentError("Macro-enabled files are unsupported.");
      }
      if (name.startsWith("xl/worksheets/")) {
        const cell = (ref: string) => {
          const match = /^([A-Z]{1,2})([1-9]\d{0,4})$/.exec(ref);
          if (!match) throw new DocumentError("Spreadsheet coordinates exceed the supported range.");
          const col = [...match[1]].reduce((n, c) => n * 26 + c.charCodeAt(0) - 64, 0);
          const row = Number(match[2]);
          if (col > 256 || row > 10_000) throw new DocumentError("Spreadsheet coordinates exceed the supported range.");
          return { col, row };
        };
        if (local === "row" && tag.attributes.r) cell("A" + tag.attributes.r);
        if (local === "col" && (!/^[1-9]\d{0,2}$/.test(tag.attributes.min ?? "") ||
            !/^[1-9]\d{0,2}$/.test(tag.attributes.max ?? "") || Number(tag.attributes.max) > 256 ||
            Number(tag.attributes.min) > Number(tag.attributes.max))) {
          throw new DocumentError("Spreadsheet columns exceed the supported range.");
        }
        if (local === "c") cell(tag.attributes.r ?? "");
        if (local === "mergeCell") {
          const [first, last] = (tag.attributes.ref ?? "").split(":").map(cell);
          if (!last || last.col < first.col || last.row < first.row ||
              (mergedCells += (last.col - first.col + 1) * (last.row - first.row + 1)) > 20_000) {
            throw new DocumentError("Spreadsheet merge ranges exceed the supported limit.");
          }
        }
      }
    });
    parser.on("closetag", () => { depth--; });
  });
}

async function officeArchive(bytes: Buffer) {
  if (bytes.readUInt32LE(0) !== 0x04034b50) throw new DocumentError("The Office file is not an unencrypted ZIP archive.");
  const archive = await fromBufferPromise(bytes, {
    lazyEntries: true, autoClose: false, validateEntrySizes: true, strictFileNames: true,
  });
  const entries = new Map<string, Buffer>();
  let total = 0;
  try {
    if (archive.entryCount > 256) throw new DocumentError("The Office archive has too many entries.");
    for await (const entry of archive.eachEntry()) {
      const name = entry.fileName;
      const mode = (entry.externalFileAttributes >>> 16) & 0o170000;
      if (!/^[\w.\-\[\]/ ]{1,240}$/.test(name) || name.startsWith("/") || name.includes("//") ||
          name.split("/").some((part) => part === ".." || part === ".") || entries.has(name) ||
          mode === 0o120000 || entry.isEncrypted() || /(^|\/)(vbaproject[^/]*|encryptedpackage|externallinks)(\/|$)/i.test(name)) {
        throw new DocumentError("The Office archive contains an unsupported or unsafe entry.");
      }
      if (name.endsWith("/")) continue;
      const size = entry.uncompressedSize;
      if (size > 8 * 1024 ** 2 || (total += size) > 48 * 1024 ** 2 ||
          (size > 1024 ** 2 && size > entry.compressedSize * 100)) {
        throw new DocumentError("The Office archive exceeds decompression limits.");
      }
      const parts: Buffer[] = [];
      let received = 0;
      const stream = await archive.openReadStreamPromise(entry);
      for await (const part of stream) {
        received += part.length;
        if (received > size) throw new DocumentError("Archive entry size is invalid.");
        parts.push(part);
      }
      if (received !== size) throw new DocumentError("Archive entry size is invalid.");
      const content = Buffer.concat(parts, received);
      if (/\.(xml|rels)$/i.test(name)) checkXml(decode(content), name);
      entries.set(name, content);
    }
    if (!entries.has("[Content_Types].xml")) throw new DocumentError("The Office archive is missing its content manifest.");
    return entries;
  } finally {
    archive.close();
  }
}

function wordSections(content: Buffer, add: (reference: string, text: string) => void) {
  let paragraph = 0;
  let table = 0;
  let row = 0;
  let tableDepth = 0;
  let text = "";
  let inText = false;
  let heading = false;
  xml(decode(content), (parser) => {
    parser.on("opentag", ({ name, attributes }) => {
      if (name === "w:tbl" && tableDepth++ === 0) table++;
      if (name === "w:tr") row++;
      if (name === "w:p") { text = ""; heading = false; }
      if (name === "w:pStyle" && /^(heading|title)/i.test(attributes["w:val"] ?? "")) heading = true;
      if (name === "w:t") inText = true;
      if (name === "w:tab" || name === "w:br") text += " ";
    });
    parser.on("text", (value) => { if (inText) text += value; });
    parser.on("closetag", ({ name }) => {
      if (name === "w:t") inText = false;
      if (name === "w:tbl" && --tableDepth === 0) row = 0;
      if (name === "w:p") {
        paragraph++;
        add(tableDepth ? "Table " + table + ", row " + row : (heading ? "Heading " : "Paragraph ") + paragraph, text);
      }
    });
  });
}

async function sheetSections(entries: Map<string, Buffer>, add: (reference: string, text: string) => void) {
  if (!entries.has("xl/workbook.xml")) throw new DocumentError("The XLSX workbook is missing.");
  if ([...entries.keys()].filter((name) => /^xl\/worksheets\/[^/]+\.xml$/.test(name)).length > 24) {
    throw new DocumentError("The workbook contains too many worksheets.");
  }
  const zip = new JSZip();
  for (const [name, bytes] of entries) {
    if (/\.(xml|rels)$/i.test(name)) zip.file(name, bytes);
  }
  const book = new ExcelJS.Workbook();
  const normalized = await zip.generateAsync({ type: "uint8array" });
  await book.xlsx.load(normalized.buffer as ArrayBuffer);
  book.eachSheet((sheet) => {
    sheet.eachRow((row) => {
      const cells: string[] = [];
      row.eachCell((cell) => { if (cell.text) cells.push(cell.address + ": " + cell.text); });
      add(sheet.name + " · row " + row.number, cells.join(" | "));
    });
  });
}

export async function extract(bytes: Buffer, format: Format) {
  const { sections, add } = collector();
  try {
    if (format === "txt") {
      textFile(bytes).split(/\r?\n\s*\r?\n/).forEach((text, index) => add("Paragraph " + (index + 1), text));
    } else if (format === "csv") {
      let count = 0;
      const rows: string[][] = parse(textFile(bytes), {
        max_record_size: 64 * 1024, relax_column_count: true,
        on_record(row) {
          if (++count > 300) throw new DocumentError("CSV inputs are limited to 300 rows.");
          return row;
        },
      });
      for (const [index, row] of rows.entries()) {
        if (row.length > 256) throw new DocumentError("The CSV contains too many columns.");
        add("CSV · row " + (index + 1), row.map((value, col) => "C" + (col + 1) + ": " + value).join(" | "));
      }
    } else if (format === "pdf") {
      if (!/^%PDF-\d\.\d/.test(bytes.subarray(0, 8).toString("ascii"))) throw new DocumentError("The file does not have a PDF signature.");
      const { getDocument } = await import("pdfjs-dist/legacy/build/pdf.mjs");
      const resources = dirname(createRequire(import.meta.url).resolve("pdfjs-dist/package.json"));
      const task = getDocument({
        data: new Uint8Array(bytes), disableFontFace: true, useSystemFonts: false,
        useWasm: false, stopAtErrors: true, maxImageSize: 16_000_000,
        standardFontDataUrl: join(resources, "standard_fonts") + sep,
        cMapUrl: join(resources, "cmaps") + sep, cMapPacked: true,
      });
      try {
        const pdf = await task.promise;
        if (pdf.numPages > 250) throw new DocumentError("PDFs are limited to 250 pages.");
        for (let page = 1; page <= pdf.numPages; page++) {
          const pdfPage = await pdf.getPage(page);
          const content = await pdfPage.getTextContent();
          add("Page " + page, content.items.map((item) => "str" in item ? item.str + (item.hasEOL ? "\n" : " ") : "").join(""));
          pdfPage.cleanup();
        }
      } finally {
        await task.destroy();
      }
    } else {
      const entries = await officeArchive(bytes);
      if (format === "docx") {
        const content = entries.get("word/document.xml");
        if (!content) throw new DocumentError("The DOCX document body is missing.");
        wordSections(content, add);
      } else {
        await sheetSections(entries, add);
      }
    }
    return sections;
  } catch (error) {
    if (error instanceof DocumentError) throw error;
    throw new DocumentError("The file could not be parsed. It may be invalid, encrypted, or unsupported.");
  }
}
