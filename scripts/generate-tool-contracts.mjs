import { readFile, writeFile } from "node:fs/promises";
import { generatedContracts } from "../lib/tool-registry.mjs";
const output = new URL("../contracts/agent-v1.json", import.meta.url);
const expected = JSON.stringify(generatedContracts(), null, 2) + "\n";
if (process.argv.includes("--check")) {
  if (await readFile(output, "utf8") !== expected) {
    console.error("Regenerate contracts with npm run contracts:generate.");
    process.exitCode = 1;
  }
} else {
  await writeFile(output, expected);
}
