export function coveragePlan(sections) {
  const budget = 16_000;
  const chunks = [];
  const all = sections.map((section, index) => ({ id: "S" + (index + 1), reference: section.reference, text: section.text }));
  let covered = 0;
  let consumed = 0;
  let current = [];
  let length = 0;
  for (const part of all) {
    if (part.text.length > 4000 || consumed + part.text.length > budget) break;
    if (length + part.text.length > 4000 && current.length) {
      if (chunks.length === 3) break;
      chunks.push(current);
      current = [];
      length = 0;
    }
    current.push(part);
    length += part.text.length;
    consumed += part.text.length;
    covered++;
  }
  if (current.length) chunks.push(current);
  return { chunks, totalSections: all.length, coveredSections: covered, complete: covered === all.length };
}

export function checkedQuotes(raw, chunk) {
  try {
    const result = JSON.parse(raw);
    if (!Array.isArray(result) || result.length > 5) return null;
    const refs = new Map(chunk.map((part) => [part.id, part]));
    const verified = [];
    for (const item of result) {
      if (!item || Object.keys(item).sort().join(",") !== "quote,ref" || typeof item.quote !== "string" ||
          !item.quote.trim() || item.quote.length > 350) return null;
      const part = refs.get(item.ref);
      if (!part?.text.includes(item.quote)) return null;
      verified.push({ quote: item.quote, ref: part.id, source: part.reference });
    }
    return verified;
  } catch { return null; }
}

export function reduceQuotes(quotes) {
  return [...new Map(quotes.map((item) => [item.ref + "\n" + item.quote, item])).values()].slice(0, 16);
}

export function evidencedField(sections, key) {
  const label = key === "invoice_id" ? "invoice[ _-](?:id|number|no\\.?)" : key.replaceAll("_", "[ _-]");
  const pattern = new RegExp("^\\s*" + label + "\\s*:\\s*(.*?)\\s*$", "iu");
  const evidence = sections.flatMap(({ reference, text }, index) => text.split(/\r?\n/).flatMap((line) => {
    const match = pattern.exec(line);
    return match?.[1] && match[1].length <= 200 ? [{ value: match[1], evidence: line.trim(), ref: "S" + (index + 1), source: reference }] : [];
  }));
  const distinct = new Set(evidence.map((item) => item.value));
  return { status: distinct.size === 1 ? "found" : distinct.size ? "ambiguous" : "missing",
    value: distinct.size === 1 ? evidence[0].value : null, evidence: evidence.slice(0, 5) };
}
