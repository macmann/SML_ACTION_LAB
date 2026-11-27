import assert from "node:assert/strict";
import { test } from "node:test";
import JSZip from "jszip";
import { extractTable } from "../lib/extraction.ts";
import { xlsxFixture } from "./document-fixtures.mjs";

test("rejects an uploaded worksheet with malformed XML or out-of-range cell addresses", async () => {
  for (const patch of [
    (sheet) => sheet.replace(/<\/worksheet>/, ""),
    (sheet) => sheet.replace('r="A1"', 'r="XFD99999"'),
  ]) {
    const book = await JSZip.loadAsync(await xlsxFixture());
    const part = "xl/worksheets/sheet1.xml";
    const original = await book.file(part).async("string");
    const invalid = patch(original);
    assert.notEqual(invalid, original);
    book.file(part, invalid);
    await assert.rejects(extractTable(await book.generateAsync({ type: "nodebuffer" }), "xlsx"), /malformed|coordinates/);
  }
});
