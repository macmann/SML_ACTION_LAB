import { z } from "zod";
import { WorkspaceError } from "./database";
import { readOriginal } from "./document-files";
import { extractTableIsolated } from "./document-worker";
import { mediaTypes } from "./extraction";
import { metadataFor, useDocuments, type Workspace } from "./documents";
import { aggregateTable, columnIndices } from "./agent-rules.mjs";
import { currency } from "./business-validation";

const header = z.string().trim().min(1).max(80);
const selectors = { sheet: header.optional(), headerRow: z.number().int().min(1).max(300).optional() };
export const sheetRequest = z.discriminatedUnion("operation", [
  z.strictObject({ operation: z.literal("inspect"), ...selectors }),
  z.strictObject({ operation: z.enum(["sum", "count", "average", "min", "max"]), ...selectors,
    metric: header, groupBy: header.optional(), currencyColumn: header.optional(),
    verifiedUnit: z.union([currency, z.literal("number")]).optional() }),
]);
type SheetRequest = z.infer<typeof sheetRequest>;
type Analyze = Exclude<SheetRequest, { operation: "inspect" }>;

export async function inspectSpreadsheet(workspace: Workspace, id: string, options: SheetRequest) {
  const document = metadataFor(workspace, id);
  const format = document.mediaType === mediaTypes.csv ? "csv" : document.mediaType === mediaTypes.xlsx ? "xlsx" : null;
  if (!format) throw new WorkspaceError("Select a CSV or XLSX document.");
  const { file, size } = await readOriginal(workspace.namespace, id);
  try {
    if (size > 64 * 1024 ** 2) throw new WorkspaceError("The spreadsheet exceeds the analysis limit.");
    return await extractTableIsolated(await file.readFile(), format, {
      sheet: options.sheet, headerRow: options.headerRow, inspect: options.operation === "inspect",
    }).catch((error) => {
      if (error instanceof Error && !error.message.startsWith("The document parser")) throw new WorkspaceError(error.message, 422);
      throw new WorkspaceError("The spreadsheet is malformed or exceeded the parser limit.", 422);
    });
  } finally { await file.close(); }
}

export async function analyzeSpreadsheet(workspace: Workspace, id: string, options: Analyze) {
  const { rows, names, missingFormulaValues, cachedFormulaValues } = await inspectSpreadsheet(workspace, id, options);
  const warnings = [
    ...(missingFormulaValues ? [missingFormulaValues + " formula cells have no cached value. Formulas were not evaluated."] : []),
    ...(cachedFormulaValues ? [cachedFormulaValues + " formula values were read from the workbook cache and may be stale."] : []),
  ];
  const [header, ...data] = rows;
  const inferred = header.flatMap((value, i) => /^(currency|ccy|currency code)$/i.test(value.trim()) ? [i] : []);
  const selected = options.currencyColumn ? columnIndices(header, options.currencyColumn) : inferred;
  const monetary = /\b(amount|price|cost|tax|currency|balance|revenue|total|expense)\b/i.test(options.metric.replaceAll("_", " "));
  if (options.operation !== "count" && (selected.length > 1 || (options.currencyColumn && !selected.length))) {
    throw new WorkspaceError("Select one unambiguous currency column.", 422);
  }
  const currencyValuesAnywhere = data.some((row) => row.some((value) => currency.safeParse(value.trim()).success));
  if (options.operation !== "count" && !selected.length && (monetary && !options.verifiedUnit || currencyValuesAnywhere)) {
    throw new WorkspaceError("Select the currency column or explicitly confirm the unit for this monetary-looking metric.", 422);
  }
  const groupsByUnit = new Map<string, string[][]>();
  for (const row of data) {
    const unit = options.operation === "count" ? "count" : selected.length ? row[selected[0]]?.trim() : options.verifiedUnit ?? "number";
    if (!unit || (unit !== "number" && unit !== "count" && !currency.safeParse(unit).success)) {
      throw new WorkspaceError("A row is missing an explicit currency. Correct the source before aggregating.", 422);
    }
    const selectedRows = groupsByUnit.get(unit) ?? [header];
    selectedRows.push(row);
    groupsByUnit.set(unit, selectedRows);
    if (groupsByUnit.size > 8) throw new WorkspaceError("The analysis exceeds the eight-unit limit.", 422);
  }
  const series = [...groupsByUnit].map(([unit, table]) => {
    const groups = aggregateTable(table, options.metric, options.groupBy ?? "", options.operation);
    if (!groups) throw new WorkspaceError("Use exact unique headers and valid numeric values. Check for missing formula caches.", 422);
    return { unit, groups };
  });
  if (!series.length) throw new WorkspaceError("The selected sheet has no data rows.", 422);
  return { sheet: options.sheet ?? names[0], operation: options.operation, metric: options.metric, warnings, series,
    ...(series.length === 1 ? { groups: series[0].groups } : {}) };
}

export function spreadsheet(id: string, request: SheetRequest) {
  return useDocuments(async (workspace) => request.operation === "inspect" ?
    inspectSpreadsheet(workspace, id, request) : analyzeSpreadsheet(workspace, id, request));
}
