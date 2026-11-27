import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "SLM Action Lab", template: "%s · SLM Action Lab" },
  description: "A single-admin document and productivity workspace.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
