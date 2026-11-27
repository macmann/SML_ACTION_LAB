import { z } from "zod";
import { currentAdmin, requireSameOrigin } from "./auth";
import { WorkspaceError } from "./database";
import { mediaTypes } from "./extraction";

export const privateHeaders = { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" };

export async function authenticated(write = false) {
  if (!await currentAdmin()) throw new WorkspaceError("Administrator sign-in required.", 401);
  if (write && !await requireSameOrigin()) throw new WorkspaceError("The request origin was rejected.", 403);
}

export function json(value: unknown, status = 200) {
  return Response.json(value, { status, headers: privateHeaders });
}

export function failure(error: unknown) {
  return error instanceof WorkspaceError ? json({ error: error.message }, error.status) :
    json({ error: "The workspace request failed. Retry or check Settings." }, 503);
}

function validDate(date: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || date.startsWith("0000")) return false;
  const parsed = new Date(date + "T00:00:00Z");
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === date;
}

const unsafe = /[\p{Cc}\p{Cf}\p{Cs}]/u;
const label = (limit: number) => z.string().trim().max(limit).refine((value) => !unsafe.test(value));
const uploadSchema = z.object({
  filename: label(180).refine((name) => Boolean(name) && !/[\\/]/u.test(name) && !name.startsWith(".")),
  title: label(140).optional(),
  tags: z.array(label(40)).max(12).optional(),
  documentDate: z.string().refine(validDate).optional(),
});

export function uploadMetadata(header: string | null) {
  if (!header || header.length > 6000) throw new WorkspaceError("Upload metadata is invalid.");
  try {
    const parsed = uploadSchema.parse(JSON.parse(decodeURIComponent(header)));
    return {
      filename: parsed.filename.normalize("NFC"), title: (parsed.title || parsed.filename).normalize("NFC"),
      tags: [...new Set((parsed.tags ?? []).filter(Boolean).map((tag) => tag.normalize("NFC")))],
      documentDate: parsed.documentDate ?? null,
    };
  } catch {
    throw new WorkspaceError("Check the filename, title, tags and document date.");
  }
}

export function searchOptions(url: URL) {
  const params = url.searchParams;
  const parsed = z.object({
    query: label(160), tag: label(40), mediaType: z.string().refine((type) => !type || Object.values(mediaTypes).some((entry) => entry === type)),
    dateField: z.enum(["uploaded", "document"]),
    from: z.string().refine((date) => !date || validDate(date)), to: z.string().refine((date) => !date || validDate(date)),
    sort: z.enum(["relevance", "uploaded-desc", "uploaded-asc", "document-desc", "document-asc"]),
  }).safeParse({
    query: params.get("q") ?? "", tag: params.get("tag") ?? "", mediaType: params.get("type") ?? "",
    dateField: params.get("dateField") ?? "uploaded", from: params.get("from") ?? "", to: params.get("to") ?? "",
    sort: params.get("sort") ?? "relevance",
  });
  if (!parsed.success || (parsed.data.from && parsed.data.to && parsed.data.from > parsed.data.to)) {
    throw new WorkspaceError("Check the search filters and date range.");
  }
  return parsed.data;
}
