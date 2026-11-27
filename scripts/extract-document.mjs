import { DocumentError, extract, extractTable } from "../lib/extraction.ts";

process.once("message", async ({ bytes, format, table }) => {
  try {
    process.send({ value: table ? await extractTable(bytes, format, table) : await extract(bytes, format) }, () => process.disconnect());
  } catch (error) {
    process.send({
      error: error instanceof DocumentError ? error.message : "The file could not be parsed.",
    }, () => process.disconnect());
  }
});
