import { signOut } from "@/app/actions";
import { Navigation } from "@/components/navigation";
import { Button } from "@/components/ui/button";
import { requireAdmin } from "@/lib/access";

export const dynamic = "force-dynamic";

export default async function WorkspaceLayout({ children }: { children: React.ReactNode }) {
  await requireAdmin();
  return (
    <div className="mx-auto grid min-h-dvh max-w-[92rem] md:grid-cols-[15rem_minmax(0,1fr)]">
      <a href="#content" className="sr-only focus:not-sr-only focus:absolute focus:z-10 focus:bg-[var(--panel)] focus:p-3">Skip to content</a>
      <aside className="grid content-start gap-5 border-b border-[var(--line)] bg-[var(--panel)] p-4 md:border-r md:border-b-0 md:p-6">
        <p className="text-lg font-semibold tracking-tight">SLM Action Lab</p>
        <Navigation />
        <form action={signOut}>
          <Button variant="outline">Sign out</Button>
        </form>
      </aside>
      <main id="content" tabIndex={-1} className="min-w-0 space-y-5 p-4 sm:p-8 lg:p-12">{children}</main>
    </div>
  );
}
