import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import { tmpdir } from "node:os";
import JSZip from "jszip";
import { editDocx } from "../lib/docx-template.ts";
import { convertOffice } from "../lib/office-conversion.mjs";
import { checkedQuotes, coveragePlan, evidencedField, reduceQuotes } from "../lib/evidence.mjs";

const ns = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';
const paragraph = (...runs) => "<w:p>" + runs.map((run) => "<w:r><w:t>" + run + "</w:t></w:r>").join("") + "</w:p>";
async function fixture(body, header = paragraph("November"), footer = paragraph("2025")) {
  const zip = new JSZip();
  zip.file("[Content_Types].xml", "<Types/>");
  zip.file("word/document.xml", "<w:document " + ns + "><w:body>" + body + "</w:body></w:document>");
  zip.file("word/header1.xml", "<w:hdr " + ns + ">" + header + "</w:hdr>");
  zip.file("word/footer1.xml", "<w:ftr " + ns + ">" + footer + "</w:ftr>");
  zip.file("word/media/fixture.bin", Buffer.from([1, 2, 3]));
  return zip.generateAsync({ type: "nodebuffer" });
}

test("split-run editing changes November and December across year boundaries and preserves unaffected XML and media", async () => {
  const untouched = paragraph("Unchanged &amp; literal");
  const original = await fixture("<w:tbl><w:tr><w:tc>" + paragraph("Nov", "ember 2025") + "</w:tc></w:tr></w:tbl>" + untouched);
  const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
  const expected = hash(original);
  const { bytes, changes } = await editDocx(original, [
    { find: "November 2025", replace: "December 2025", count: 1 },
    { find: "November", replace: "December", count: 1 },
    { find: "2025", replace: "2026", count: 1 },
  ]);
  assert.equal(hash(original), expected);
  assert.equal(changes.length, 3);
  assert.ok(changes.some(({ before, after }) => before === "November 2025" && after === "December 2025"));
  const zip = await JSZip.loadAsync(bytes);
  assert.ok((await zip.file("word/document.xml").async("string")).includes(untouched));
  assert.match(await zip.file("word/header1.xml").async("string"), /December/);
  assert.match(await zip.file("word/footer1.xml").async("string"), /2026/);
  assert.deepEqual(await zip.file("word/media/fixture.bin").async("nodebuffer"), Buffer.from([1, 2, 3]));
});

test("missing and duplicate placeholders and unsupported elements fail closed", async () => {
  await assert.rejects(editDocx(await fixture(paragraph("fixture")), [{ find: "{{missing}}", replace: "value", count: 1 }]), /missing|count/);
  await assert.rejects(editDocx(await fixture(paragraph("fixture fixture")), [{ find: "fixture", replace: "value", count: 1 }]), /more often/);
  await assert.rejects(editDocx(await fixture('<w:p><w:r><w:instrText>fixture</w:instrText></w:r></w:p>'), [{ find: "fixture", replace: "value", count: 1 }]), /predictable/);
  await assert.rejects(editDocx(await fixture(paragraph("{{invoice_number}}")), [{ find: "{{invoice_number}}", replace: "F-001", count: 1 }]), /invoice template mode/);
});

test("converter explicitly fails when binaries are unavailable", async () => {
  await assert.rejects(convertOffice(Buffer.from("test"), tmpdir(), "/nonexistent/office", "/nonexistent/sandbox"), /requires LibreOffice and bubblewrap/);
});

test("summary planning bounds chunks and rejects nonliteral or nonexistent citations", () => {
  const parts = Array.from({ length: 20 }, (_, i) => ({ reference: "Page " + (i + 1), text: "Verbatim. ".repeat(200) }));
  const plan = coveragePlan(parts);
  assert.equal(plan.complete, false);
  assert.ok(plan.chunks.length <= 4);
  assert.ok(plan.chunks.every((chunk) => chunk.reduce((sum, section) => sum + section.text.length, 0) <= 4000));
  assert.equal(checkedQuotes('[{"ref":"S22","quote":"Verbatim."}]', plan.chunks[0]), null);
  assert.equal(checkedQuotes('[{"ref":"S1","quote":"Made up."}]', plan.chunks[0]), null);
  const quotes = checkedQuotes('[{"ref":"S1","quote":"Verbatim."}]', plan.chunks[0]);
  assert.deepEqual(reduceQuotes([...quotes, ...quotes]), [{ ref: "S1", quote: "Verbatim.", source: "Page 1" }]);
  assert.deepEqual(evidencedField(parts, "amount"), { status: "missing", value: null, evidence: [] });
});
