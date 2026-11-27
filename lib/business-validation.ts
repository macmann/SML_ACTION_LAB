import { z } from "zod";

const safeText = (n: number) => z.string().trim().min(1).max(n).refine((value) => !value.includes("\0"));
export const title = safeText(140);
const currencies = new Set(Intl.supportedValuesOf("currency"));
export const currency = z.string().refine((code) => currencies.has(code));
export const amount = z.string().regex(/^(0|[1-9]\d{0,11})(\.\d{1,6})?$/);
export const invoiceNumber = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._/-]{0,59}$/);
export const calendar = z.iso.date().refine((value) => !value.startsWith("0000"));
export const taskInput = z.strictObject({ title, status: z.enum(["open", "done"]), due: calendar.nullable() });
export const noteInput = z.strictObject({ title, body: safeText(8000) });
export const invoiceInput = z.strictObject({
  number: invoiceNumber, currency, customer: title, amount, tax: amount.nullable(),
  issued: calendar, due: calendar, source: z.uuid().nullable(),
}).refine(({ due, issued }) => due >= issued);
export const expenseInput = z.strictObject({ description: title, incurred: calendar, amount, currency });
export type InvoiceInput = z.infer<typeof invoiceInput>;
