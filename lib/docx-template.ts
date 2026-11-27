import JSZip from "jszip";
import { SaxesParser } from "saxes";
import { officeArchive, DocumentError } from "./extraction.ts";

export type Replacement = { find: string; replace: string; count: number };
const wordNamespace = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
const unsupported = /<w:(?:instrText|fld\w*|sdt|ins|del|move\w*|altChunk|object|txbxContent|subDoc|sym)\b|<mc:AlternateContent\b/i;
const escape = (value: string) => value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");

function decoded(value: string) {
  let content = "";
  const parser = new SaxesParser();
  parser.on("text", (text) => { content += text; });
  parser.write("<text>" + value + "</text>").close();
  return content;
}

export async function editDocx(original: Buffer, replacements: Replacement[], invoice = false) {
  if (!replacements.length || replacements.length > 12 ||
      new Set(replacements.map(({ find }) => find)).size !== replacements.length ||
      replacements.some(({ find, replace, count }) => !find.trim() || /[\p{Cc}]/u.test(find + replace) || !Number.isInteger(count) || count < 1 || count > 30)) {
    throw new DocumentError("Provide distinct literal replacements with expected counts.");
  }
  const entries = await officeArchive(original);
  if (!entries.has("word/document.xml") || [...entries.keys()].some((path) => /word\/(?:embeddings|activeX|customXml)\//i.test(path))) {
    throw new DocumentError("This template contains unsupported embedded material.");
  }
  const matches = new Array<number>(replacements.length).fill(0);
  const changes: { part: string; paragraph: number; before: string; after: string }[] = [];
  const pattern = new RegExp(replacements.map(({ find }) => find).sort((a, b) => b.length - a.length)
    .map((value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|"), "gu");
  const literals = new Map(replacements.map((item, index) => [item.find, { ...item, index }]));

  for (const [part, content] of entries) {
    if (!/^word\/(?:document|header\d+|footer\d+)\.xml$/.test(part)) continue;
    const xml = new TextDecoder("utf-8", { fatal: true }).decode(content);
    const namespaces = [...xml.matchAll(/xmlns:w\s*=\s*["']([^"']+)["']/g)];
    if (!namespaces.length || namespaces.some((match) => match[1] !== wordNamespace) ||
        /<!--|<!\[CDATA\[/.test(xml) || unsupported.test(xml) ||
        /<\/?(?:[a-z][\w.-]*:)?(?:p|r|t)(?=[\s>\/])/giu.test(xml.replace(/<\/?w:(?:p|r|t)(?=[\s>\/])/gu, ""))) {
      throw new DocumentError("Only predictable Word paragraphs, tables, headers and footers are supported.");
    }
    let paragraph = 0;
    const patched = xml.replace(/<w:p(?:\s[^>]*)?>[\s\S]*?<\/w:p>/g, (markup) => {
      paragraph++;
      let position = 0;
      const runs = [...markup.matchAll(/(<w:t(?:\s[^>]*)?>)([^<]*)(<\/w:t>)/g)].map((match) => {
        const text = decoded(match[2]);
        const start = position;
        position += text.length;
        return { match, text, start, end: position, edits: [] as { start: number; end: number; value: string }[] };
      });
      const before = runs.map((run) => run.text).join("");
      if (!invoice && /\{\{(?:invoice_number|invoice_date|due_date|period|payment_terms)\}\}|^\s*invoice[ _-]+(?:number|date|id)\s*:/iu.test(before)) {
        throw new DocumentError("Use invoice template mode with an explicit number, dates and payment terms.");
      }
      const hits = [...before.matchAll(pattern)];
      if (!hits.length) return markup;
      if (/<w:(?:br|tab|cr|drawing|pict)\b/.test(markup)) {
        throw new DocumentError("A matching paragraph contains a break, tab or object. Simplify the template first.");
      }
      for (const hit of hits) {
        const replacement = literals.get(hit[0])!;
        if (++matches[replacement.index] > replacement.count) throw new DocumentError("A replacement occurs more often than expected.");
        const end = hit.index + hit[0].length;
        for (const run of runs) {
          if (run.end <= hit.index || run.start >= end) continue;
          run.edits.push({ start: Math.max(0, hit.index - run.start), end: Math.min(run.text.length, end - run.start),
            value: run.start <= hit.index && hit.index < run.end ? replacement.replace : "" });
        }
      }
      const after = before.replace(pattern, (value) => literals.get(value)!.replace);
      changes.push({ part, paragraph, before, after });
      if (changes.length > 60 || changes.reduce((size, item) => size + item.before.length + item.after.length, 0) > 20_000) {
        throw new DocumentError("The changed paragraphs exceed the preview limit.");
      }
      let output = markup;
      for (const run of runs.reverse()) {
        if (!run.edits.length) continue;
        let value = run.text;
        for (const edit of run.edits.reverse()) value = value.slice(0, edit.start) + edit.value + value.slice(edit.end);
        const opening = /^\s|\s$/.test(value) && !run.match[1].includes("xml:space=") ?
          run.match[1].slice(0, -1) + ' xml:space="preserve">' : run.match[1];
        output = output.slice(0, run.match.index) + opening + escape(value) + run.match[3] + output.slice(run.match.index + run.match[0].length);
      }
      return output;
    });
    if (patched !== xml) entries.set(part, Buffer.from(patched));
  }
  if (matches.some((count, index) => count !== replacements[index].count)) {
    throw new DocumentError("At least one literal or placeholder is missing or its count did not match.");
  }
  const output = new JSZip();
  for (const [name, content] of entries) output.file(name, content);
  const bytes = await output.generateAsync({ type: "nodebuffer", compression: "STORE" });
  await officeArchive(bytes);
  return { bytes, changes, matches };
}
