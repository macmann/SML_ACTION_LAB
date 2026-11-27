import assert from "node:assert/strict";
import { test } from "node:test";
import { DocumentIndex } from "../lib/document-search.ts";
import { extract, fileType } from "../lib/extraction.ts";
import { docxFixture, pdfFixture, xlsxFixture } from "./document-fixtures.mjs";

test("extracts page, heading, table, sheet, cell, CSV and plain text references", async () => {
  const pdf = await extract(pdfFixture(), "pdf");
  assert.equal(pdf[0].reference, "Page 1");
  assert.match(pdf[0].text, /QZ-381/);
  assert.deepEqual(await extract(pdfFixture(false), "pdf"), []);
  const docx = await extract(await docxFixture(), "docx");
  assert.deepEqual(docx, [{ reference: "Heading 1", text: "Fixture heading" },
    { reference: "Table 1, row 1", text: "Order QZ-381" }]);
  const xlsx = await extract(await xlsxFixture(), "xlsx");
  assert.equal(xlsx[1].reference, "Fixtures · row 2");
  assert.match(xlsx[1].text, /A2: QZ-381 \| B2: 17/);
  assert.deepEqual(await extract(Buffer.from("name,number\nfixture,17\n"), "csv"), [
    { reference: "CSV · row 1", text: "C1: name | C2: number" },
    { reference: "CSV · row 2", text: "C1: fixture | C2: 17" },
  ]);
  assert.deepEqual(await extract(Buffer.from("first\n\nsecond"), "txt"), [
    { reference: "Paragraph 1", text: "first" }, { reference: "Paragraph 2", text: "second" },
  ]);
});

test("rejects MIME mismatch, corrupt documents, dangerous XML, macro and expansion bomb", async () => {
  assert.throws(() => fileType("fixture.pdf", "text/plain"), /match/);
  assert.throws(() => fileType("fixture.docm", ""), /Choose/);
  await assert.rejects(extract(Buffer.from("not a pdf"), "pdf"), /signature/);
  await assert.rejects(extract(pdfFixture(), "txt"), /signature/);
  const encrypted = await docxFixture();
  const centralEntry = encrypted.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
  encrypted.writeUInt16LE(encrypted.readUInt16LE(centralEntry + 8) | 1, centralEntry + 8);
  await assert.rejects(extract(encrypted, "docx"), /unsafe/);
  await assert.rejects(extract(await docxFixture((zip) => zip.file("word/vbaProject.bin", "fixture")), "docx"), /unsafe/);
  await assert.rejects(extract(await docxFixture((zip) =>
    zip.file("word/document.xml", '<!DOCTYPE root [<!ENTITY x SYSTEM "file:///fixture">]><root>&x;</root>')), "docx"), /external entities/);
  await assert.rejects(extract(await docxFixture((zip) =>
    zip.file("word/large.xml", "<x>" + "a".repeat(2 * 1024 ** 2) + "</x>")), "docx"), /decompression/);
  await assert.rejects(extract(await docxFixture((zip) =>
    zip.file("word/_rels/document.xml.rels", '<Relationships><Relationship TargetMode="External"/></Relationships>')), "docx"), /external relationships/);
});

test("BM25+ groups ambiguous matches, keeps exact IDs, filters distinct dates and removes documents", () => {
  const index = new DocumentIndex();
  const metadata = (id, filename, uploadedAt, documentDate) =>
    ({ id, filename, title: filename, tags: ["fixture"], uploadedAt, documentDate });
  const first = metadata("one", "QZ-381.txt", "2025-02-05T12:00:00Z", "2024-01-15");
  const second = metadata("two", "Other.txt", "2025-01-03T12:00:00Z", "2024-01-02");
  const third = metadata("three", "QZ-3810.txt", "2025-01-01T12:00:00Z", null);
  index.add([
    { metadata: first, ordinal: 0, reference: "Page 1", text: "QZ-381 confidential fixture" },
    { metadata: first, ordinal: 1, reference: "Page 2", text: "QZ-381 repeated" },
    { metadata: second, ordinal: 0, reference: "Sheet 2", text: "QZ-381 competing fixture" },
    { metadata: third, ordinal: 0, reference: "Page 3", text: "QZ-3810 different ID" },
  ]);
  const options = { query: "QZ-381", tag: "", mediaType: "", dateField: "uploaded", from: "", to: "", sort: "relevance" };
  assert.deepEqual(index.find(options).results.map(({ id }) => id).sort(), ["one", "two"]);
  assert.equal(index.find({ ...options, dateField: "document", from: "2024-01-10", to: "2024-01-31" }).results[0].id, "one");
  assert.equal(index.find({ ...options, from: "2025-01-01", to: "2025-01-31" }).results[0].id, "two");
  assert.deepEqual(index.find({ ...options, query: "", sort: "document-asc" }).results.map(({ id }) => id), ["two", "one", "three"]);
  index.delete("one");
  assert.equal(index.find(options).results[0].id, "two");
});
