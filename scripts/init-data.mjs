import { recordOperation } from "../lib/operations.mjs";
import { initializeData } from "./data-layout.mjs";

try {
  await initializeData();
  await recordOperation("application", "startup");
} catch (error) {
  console.error(
    "Cannot initialize app data. Check that the mounted volume is writable by the application user and contains private directories.",
    error.code ?? error.message,
  );
  process.exitCode = 1;
}
