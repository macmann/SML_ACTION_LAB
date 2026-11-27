import type { NextConfig } from "next";

export default {
  output: "standalone",
  serverExternalPackages: ["pdfjs-dist", "exceljs", "jszip", "saxes", "yauzl", "csv-parse", "pdfkit"],
  outputFileTracingIncludes: {
    "/api/arena": ["./training/local/holdout.jsonl", "./training/local/holdout.sha256", "./training/manifest.json"],
    "/api/documents": [
      "./scripts/extract-document.mjs", "./lib/extraction.ts",
      "./node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs",
      "./node_modules/pdfjs-dist/standard_fonts/**/*",
      "./node_modules/pdfjs-dist/cmaps/**/*",
      "./node_modules/@napi-rs/canvas*/**/*",
    ],
  },
  outputFileTracingExcludes: { "/*": ["./data/**/*"] },
  poweredByHeader: false,
} satisfies NextConfig;
