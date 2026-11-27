"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { sections } from "@/lib/sections";

export function Navigation() {
  const pathname = usePathname();
  return (
    <nav aria-label="Workspace" className="flex flex-wrap gap-1 md:grid">
      {Object.entries(sections).map(([slug, { title }]) => {
        const href = "/" + slug;
        const current = pathname === href;
        return <Link key={slug} href={href} aria-current={current ? "page" : undefined}
          className="rounded-md px-3 py-2 text-sm font-medium hover:bg-[var(--page)] aria-[current=page]:bg-[var(--selected)]">{title}</Link>;
      })}
    </nav>
  );
}
