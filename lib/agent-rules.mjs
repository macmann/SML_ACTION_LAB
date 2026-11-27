const replaces = new Set(["txt", "pdf"]);

export function applyReplacements(text, replacements, output) {
  if (!replaces.has(output)) return null;
  const keys = replacements.map(({ find }) => find);
  if (new Set(keys).size !== keys.length || keys.some((key) => !text.includes(key))) return null;
  // One pass means replacement text is never reinterpreted as a fresh search pattern.
  const pattern = keys.sort((a, b) => b.length - a.length).map((key) => key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|");
  const entries = new Map(replacements.map(({ find, replace }) => [find, replace]));
  const matched = new Set();
  const result = text.replace(new RegExp(pattern, "gu"), (match) => { matched.add(match); return entries.get(match); });
  return matched.size === keys.length && result.trim() && result.length <= 24_000 ? result : null;
}

export function taskTitles(text) {
  const titles = text.split(/\r?\n/).flatMap((line) => {
    const match = /^\s*(?:[-*]\s+)?(?:TODO:\s*|ACTION(?:[ -]ITEM)?:\s*|\[ \]\s+)([^\p{Cc}]{1,140})\s*$/iu.exec(line);
    return match?.[1].trim() ? [match[1].trim()] : [];
  });
  return [...new Set(titles)].slice(0, 13);
}

export function fieldValue(sections, key) {
  const label = key.replaceAll("_", "[ _-]");
  const regex = new RegExp("^\\s*" + label + "\\s*:\\s*(.{1,200})\\s*$", "iu");
  const values = [...new Set(sections.flatMap(({ text }) => text.split(/\r?\n/).flatMap((line) => {
    const match = regex.exec(line);
    return match?.[1].trim() ? [match[1].trim()] : [];
  })))];
  if (values.length !== 1) return { status: values.length ? "ambiguous" : "missing" };
  return { status: "found", value: values[0] };
}

const fixed = (raw) => {
  const value = raw?.trim();
  if (typeof value !== "string" || !/^-?(?:0|[1-9]\d{0,11})(?:\.\d{1,6})?$/.test(value)) return null;
  const [whole, fraction = ""] = value.replace(/^-/, "").split(".");
  return (value.startsWith("-") ? -1n : 1n) * (BigInt(whole) * 1_000_000n + BigInt(fraction.padEnd(6, "0")));
};
function display(value) {
  const abs = value < 0 ? -value : value;
  const decimal = String(abs % 1_000_000n).padStart(6, "0").replace(/0+$/, "");
  return (value < 0 ? "-" : "") + String(abs / 1_000_000n) + (decimal ? "." + decimal : "");
}

export function columnIndices(headers, selector) {
  const position = /^column:([1-9][0-9]{0,2})$/i.exec(selector.trim());
  if (position) {
    const index = Number(position[1]) - 1;
    return index < headers.length ? [index] : [];
  }
  return headers.flatMap((header, index) => header.trim().toLowerCase() === selector.trim().toLowerCase() ? [index] : []);
}

export function aggregateTable(rows, metric, groupBy, operation) {
  const [headers, ...data] = rows;
  const column = (name) => {
    const matches = columnIndices(headers ?? [], name);
    return matches.length === 1 ? matches[0] : -1;
  };
  const metricIndex = column(metric);
  const groupIndex = groupBy ? column(groupBy) : -1;
  if (metricIndex < 0 || (groupBy && groupIndex < 0) || !data.length) return null;
  const groups = new Map();
  for (const row of data) {
    const label = groupBy ? row[groupIndex]?.trim() : "All rows";
    if (!label || label.length > 120) return null;
    const value = operation === "count" ? (row[metricIndex]?.trim() ? 1n : 0n) : fixed(row[metricIndex]);
    if (value === null) return null;
    const group = groups.get(label) ?? { n: 0n, sum: 0n, min: value, max: value };
    group.n++;
    group.sum += value;
    if (value < group.min) group.min = value;
    if (value > group.max) group.max = value;
    groups.set(label, group);
    if (groups.size > 30) return null;
  }
  return [...groups].map(([group, values]) => {
    const absolute = values.sum < 0n ? -values.sum : values.sum;
    const average = (values.sum < 0n ? -1n : 1n) * ((absolute + values.n / 2n) / values.n);
    const result = { average, min: values.min, max: values.max, sum: values.sum };
    return { group, value: operation === "count" ? String(values.sum) : display(result[operation]) };
  });
}
