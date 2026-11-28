import Link from "next/link";
import { requireAdmin } from "@/lib/access";
import { operationEvents } from "@/lib/operations.mjs";
import { agentLogs } from "@/lib/agent";

export const metadata = { title: "Logs" };
type Log = {
  id: string; provider: string; model: string; mode: string | null; identity: string | null;
  tool: string | null; validation: string | null; execution: string | null; createdAt: Date;
  routingMs: number | null; executionMs: number | null; writerMs: number | null;
  writerStatus: string | null; writerModel: string | null; writerIdentity: string | null; schemaHash: string | null;
};

export default async function LogsPage() {
  await requireAdmin();
  const events = (await operationEvents()).slice(0, 40);
  const rows: Log[] | null = await agentLogs().catch(() => null);
  return <>
    <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">Logs</h1>
    <h2 className="text-xl font-semibold">Application events</h2>
    {events.length === 0 && <p>No recent application events.</p>}
    {events.map((event, index) => <article key={event.correlationId + index} className="grid gap-1 rounded-md border border-[var(--line)] p-3 text-sm wrap-anywhere">
      <strong>{event.component} · {event.type} · {event.severity}</strong>
      <p>{event.timestamp} · {event.correlationId}{event.durationMs != null ? " · " + event.durationMs + " ms" : ""}</p>
      {event.stage && <p>{event.stage}</p>}
      {event.error && <p>{event.error}</p>}
    </article>)}
    <h2 className="text-xl font-semibold">Inference and tools</h2>
    {rows === null && <p>Inference logs are unavailable. Check PostgreSQL and workspace migrations. <Link className="underline" href="/settings?tab=diagnostics">Open diagnostics</Link></p>}
    {rows?.length === 0 && <p>No inference recorded yet.</p>}
    {rows?.map((row) => <article key={row.id} className="grid gap-2 rounded-xl border border-[var(--line)] bg-[var(--panel)] p-4 wrap-anywhere">
      <h2 className="font-semibold">{row.tool ?? "No predicted tool"}</h2>
      <p className="text-sm">{row.createdAt.toISOString()} · {row.mode ?? "Legacy"} · {row.provider} / {row.model} · {row.identity ?? "unverified"}</p>
      <dl className="grid gap-1 text-sm sm:grid-cols-2">
        <div><dt>Validation</dt><dd>{row.validation ?? "Unavailable"}</dd></div>
        <div><dt>Execution</dt><dd>{row.execution ?? "Unavailable"}</dd></div>
        <div><dt>Routing duration</dt><dd>{row.routingMs === null ? "Unavailable" : row.routingMs + " ms"}</dd></div>
        <div><dt>Execution duration</dt><dd>{row.executionMs === null ? "Unavailable" : row.executionMs + " ms"}</dd></div>
        {row.writerStatus && <div><dt>Writer</dt><dd>{row.writerModel} · {row.writerIdentity} · {row.writerStatus}{row.writerMs !== null ? " · " + row.writerMs + " ms" : ""}</dd></div>}
        {row.schemaHash && <div><dt>Tool schema hash</dt><dd>{row.schemaHash}</dd></div>}
      </dl>
    </article>)}
  </>;
}
