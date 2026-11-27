import ExcelJS from "exceljs";
import PDFDocument from "pdfkit";
import { z } from "zod";
import { WorkspaceError } from "./database";
import { businessDb } from "./business";

export const reportId = z.enum(["outstanding_invoices", "expenses", "tasks"]);
export const exportFormat = z.enum(["xlsx", "csv", "pdf"]);
export const taskStatus = z.enum(["open", "done"]);
type Cell = string | null;

export function csvCell(value: Cell) {
  const text = value ?? "";
  const safe = /^[\s\u0000-\u001F\u007F]*[=+\-@]|^[\t\r\n]/u.test(text) ? "'" + text : text;
  return '"' + safe.replaceAll('"', '""') + '"';
}

async function reportRows(report: z.infer<typeof reportId>, status?: z.infer<typeof taskStatus>) {
  return businessDb(async (pool) => {
    if (report === "tasks") {
      const { rows } = await pool.query<{ title: string; status: string; due: string | null }>(`
        SELECT title,status,due_on::text AS due FROM slm_workspace.tasks
        WHERE ($1::text IS NULL OR status=$1) ORDER BY created_at,id LIMIT 501`, [status ?? null]);
      return { headers: ["Task", "Status", "Due date"], data: rows.map((r) => [r.title, r.status, r.due]), dates: [2], numeric: [] };
    }
    if (report === "expenses") {
      const { rows } = await pool.query<{ description: string; incurred: string; amount: string; currency: string }>(`
        SELECT description,incurred_on::text AS incurred,amount::text,currency
        FROM slm_workspace.expenses ORDER BY incurred_on,id LIMIT 501`);
      return { headers: ["Description", "Incurred date", "Amount (exact decimal)", "Currency"],
        data: rows.map((r) => [r.description, r.incurred, r.amount, r.currency]), dates: [1], numeric: [2] };
    }
    const { rows } = await pool.query<{ number: string; customer: string | null; due: string | null; total: string; currency: string }>(`
      SELECT invoice_number AS number,customer,due_on::text AS due,(amount+COALESCE(tax,0))::text AS total,currency
      FROM slm_workspace.invoices WHERE verified AND status='unpaid' AND amount IS NOT NULL ORDER BY due_on,id LIMIT 501`);
    return { headers: ["Invoice", "Customer", "Due date", "Outstanding (exact decimal)", "Currency"],
      data: rows.map((r) => [r.number, r.customer, r.due, r.total, r.currency]), dates: [2], numeric: [3] };
  });
}

function pdfReport(report: string, rows: Cell[][], truncated: boolean) {
  return new Promise<Buffer>((resolve, reject) => {
    const pdf = new PDFDocument({ margin: 40 });
    const buffers: Buffer[] = [];
    pdf.on("data", (chunk: Buffer) => buffers.push(chunk));
    pdf.once("error", reject);
    pdf.once("end", () => resolve(Buffer.concat(buffers)));
    pdf.fontSize(17).text(report.replaceAll("_", " "));
    pdf.moveDown().fontSize(9);
    for (const row of rows) pdf.text(row.map((cell) => (cell ?? "").replaceAll(/[\r\n]/g, " ")).join(" | ")).moveDown(0.2);
    if (truncated) pdf.text("Partial export. More than 500 records match.");
    pdf.end();
  });
}

export async function exportReport(report: z.infer<typeof reportId>, format: z.infer<typeof exportFormat>, status?: z.infer<typeof taskStatus>) {
  const { headers, data, dates, numeric } = await reportRows(report, status);
  const rows = data.slice(0, 500);
  const truncated = data.length > rows.length;
  const name = report + "." + format;
  if (format === "pdf") {
    if (rows.some((row) => row.some((cell) => cell && /[^\x09\x0A\x0D\x20-\x7E]/u.test(cell)))) {
      throw new WorkspaceError("PDF reports require ASCII text. Use XLSX or CSV for these records.", 422);
    }
    return { name, truncated, type: "application/pdf", bytes: await pdfReport(report, [headers, ...rows], truncated) };
  }
  if (format === "csv") return {
    name, truncated, type: "text/csv; charset=utf-8",
    bytes: Buffer.from([headers.map(csvCell).join(","), ...rows.map((row) => row.map((value, col) =>
      numeric.includes(col) && value && /^\d+(\.\d+)?$/.test(value) ? value : csvCell(value)).join(","))].join("\r\n") + "\r\n"),
  };
  const book = new ExcelJS.Workbook();
  const sheet = book.addWorksheet("Report");
  sheet.addRow(headers).font = { bold: true };
  for (const values of rows) {
    const row = sheet.addRow(values.map((value, i) => value && dates.includes(i) ? new Date(value + "T00:00:00Z") : value));
    for (const column of dates) row.getCell(column + 1).numFmt = "yyyy-mm-dd";
  }
  if (truncated) book.addWorksheet("Coverage").addRow(["Partial export. More than 500 records match."]);
  return { name, truncated, type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    bytes: Buffer.from(await book.xlsx.writeBuffer()) };
}
