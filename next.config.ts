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
  async headers() {
    return [{ source: "/:path*", headers: [
      { key: "Content-Security-Policy", value: "frame-ancestors 'none'; base-uri 'self'; object-src 'none'" },
      { key: "Referrer-Policy", value: "no-referrer" },
      { key: "X-Content-Type-Options", value: "nosniff" },
    ] }];
  },
} satisfies NextConfig;
