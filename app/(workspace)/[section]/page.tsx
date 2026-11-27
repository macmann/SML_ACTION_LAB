import { notFound } from "next/navigation";
import { isSection, sections } from "@/lib/sections";
import { requireAdmin } from "@/lib/access";

type Props = { params: Promise<{ section: string }> };

export async function generateMetadata({ params }: Props) {
  const { section } = await params;
  return isSection(section) ? { title: sections[section].title } : {};
}

export default async function SectionPage({ params }: Props) {
  await requireAdmin();
  const { section } = await params;
  if (!isSection(section)) notFound();
  const { title, description } = sections[section];
  return (
    <>
      <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">{title}</h1>
      <div className="max-w-2xl rounded-xl border border-[var(--line)] bg-[var(--panel)] p-5 sm:p-7">
        <p className="leading-relaxed text-[var(--muted)]">{description}</p>
      </div>
    </>
  );
}
