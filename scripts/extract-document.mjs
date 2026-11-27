import { DocumentError, extract } from "../lib/extraction.ts";

process.once("message", async ({ bytes, format }) => {
  try {
    process.send({ sections: await extract(bytes, format) }, () => process.disconnect());
  } catch (error) {
    process.send({
      error: error instanceof DocumentError ? error.message : "The file could not be parsed.",
    }, () => process.disconnect());
  }
});
