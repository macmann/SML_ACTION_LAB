import { defineConfig, globalIgnores } from "eslint/config";
import next from "@next/eslint-plugin-next";
import tseslint from "typescript-eslint";

export default defineConfig([
  ...tseslint.configs.recommended,
  next.configs["core-web-vitals"],
  globalIgnores([".next/**", "next-env.d.ts", "data/**"]),
]);
