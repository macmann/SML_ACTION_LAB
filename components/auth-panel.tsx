import type { ReactNode } from "react";

export function AuthPanel({ title, children }: { title: string; children: ReactNode }) {
  return (
    <main className="mx-auto grid min-h-dvh w-full max-w-xl content-center gap-5 px-4 py-12 sm:px-8">
      <p className="text-sm font-semibold tracking-wide text-[var(--accent)]">SLM Action Lab</p>
      <section className="grid gap-5 rounded-xl border border-[var(--line)] bg-[var(--panel)] p-5 sm:p-8">
        <h1 className="text-3xl font-semibold tracking-tight">{title}</h1>
        {children}
      </section>
    </main>
  );
}
