import MiniSearch from "minisearch";

export type Metadata = {
  id: string;
  filename: string;
  title: string;
  tags: string[];
  uploadedAt: string;
  documentDate: string | null;
  mediaType: string;
  size: number;
  extraction: "extracted" | "no_text";
  attached: boolean;
};

type Record = { id: string; documentId: string; filename: string; title: string; tags: string; text: string; reference: string };
export type SearchRow = { metadata: Metadata; ordinal: number; reference: string; text: string };
type Options = {
  query: string; tag: string; mediaType: string; dateField: "uploaded" | "document";
  from: string; to: string; sort: "relevance" | "uploaded-desc" | "uploaded-asc" | "document-desc" | "document-asc";
};

function words(text: string) {
  return text.normalize("NFC").match(/[\p{L}\p{N}]+(?:[-_.:/][\p{L}\p{N}]+)*/gu) ?? [];
}

export class DocumentIndex {
  readonly documents = new Map<string, Metadata>();
  readonly records = new Map<string, Record>();
  readonly search = new MiniSearch<Record>({
    fields: ["filename", "title", "tags", "text"],
    storeFields: ["documentId"],
    tokenize: (text, field) => words(field === "filename" ? text.replace(/\.[a-z0-9]+$/i, "") + " " + text : text).flatMap((word) =>
      field ? [...new Set([word, ...word.split(/[-_.:/]/u)])] : [word]),
    searchOptions: { combineWith: "AND", boost: { filename: 4, title: 3, tags: 2, text: 1 } },
  });
  private readonly recordIds = new Map<string, string[]>();
  characters = 0;

  add(rows: SearchRow[]) {
    for (const { metadata, ordinal, reference, text } of rows) {
      this.documents.set(metadata.id, metadata);
      const id = metadata.id + "/" + ordinal;
      const record = { id, documentId: metadata.id, filename: metadata.filename, title: metadata.title,
        tags: metadata.tags.join(" "), text, reference };
      const ids = this.recordIds.get(metadata.id) ?? [];
      ids.push(id);
      this.recordIds.set(metadata.id, ids);
      this.records.set(id, record);
      this.characters += text.length;
      this.search.add(record);
    }
  }

  delete(id: string) {
    for (const key of this.recordIds.get(id) ?? []) {
      const record = this.records.get(key);
      if (record) {
        this.characters -= record.text.length;
        this.search.remove(record);
        this.records.delete(key);
      }
    }
    this.recordIds.delete(id);
    this.documents.delete(id);
  }

  find(options: Options) {
    const grouped = new Map<string, { metadata: Metadata; reference?: string; snippet?: string; score: number }>();
    const include = (metadata: Metadata) => {
      const date = options.dateField === "document" ? metadata.documentDate : metadata.uploadedAt.slice(0, 10);
      return (!options.tag || metadata.tags.some((tag) => tag.toLowerCase() === options.tag.toLowerCase())) &&
        (!options.mediaType || metadata.mediaType === options.mediaType) &&
        (!(options.from || options.to) || Boolean(date && (!options.from || date >= options.from) && (!options.to || date <= options.to)));
    };
    if (options.query) {
      for (const result of this.search.search(options.query)) {
        const record = this.records.get(result.id);
        if (!record) continue;
        const metadata = this.documents.get(record.documentId);
        if (!metadata || !include(metadata)) continue;
        const previous = grouped.get(record.documentId);
        if (previous && previous.score >= result.score) continue;
        const haystack = record.text.toLowerCase();
        const hit = result.terms.map((term) => haystack.indexOf(term)).filter((index) => index >= 0).sort((a, b) => a - b)[0] ?? 0;
        const start = Math.max(0, hit - 48);
        const snippet = record.text.slice(start, start + 220);
        grouped.set(record.documentId, { metadata, score: result.score, reference: record.reference || undefined,
          snippet: snippet ? (start ? "…" : "") + snippet + (start + 220 < record.text.length ? "…" : "") : undefined });
      }
    } else {
      for (const metadata of this.documents.values()) {
        if (include(metadata)) grouped.set(metadata.id, { metadata, score: 0 });
      }
    }
    const ordered = [...grouped.values()].sort((a, b) => {
      const left = a.metadata;
      const right = b.metadata;
      if (options.sort.startsWith("document")) {
        if (left.documentDate && !right.documentDate) return -1;
        if (!left.documentDate && right.documentDate) return 1;
        if (left.documentDate && right.documentDate) {
          const comparison = left.documentDate.localeCompare(right.documentDate);
          if (comparison) return options.sort === "document-asc" ? comparison : -comparison;
        }
      }
      if (options.sort === "relevance" && a.score !== b.score) return b.score - a.score;
      const comparison = left.uploadedAt.localeCompare(right.uploadedAt);
      return (options.sort === "uploaded-asc" ? comparison : -comparison) || left.id.localeCompare(right.id);
    });
    return { total: ordered.length, results: ordered.slice(0, 50).map(({ metadata, reference, snippet }) => ({ ...metadata, reference, snippet })) };
  }
}
