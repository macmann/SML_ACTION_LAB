import type { NextConfig } from "next";

export default {
  output: "standalone",
  outputFileTracingExcludes: { "/*": ["./data/**/*"] },
  poweredByHeader: false,
} satisfies NextConfig;
