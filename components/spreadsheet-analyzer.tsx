"use client";

import { useState } from "react";
import { Button } from "./ui/button";

type Inspection = { names: string[]; rowsAvailable: number; sample: string[][]; missingFormulaValues: number; cachedFormulaValues: number };
type Analysis = { sheet: string; operation: string; metric: string; warnings: string[]; series: { unit: string; groups: { group: string; value: string }[] }[] };
const field = "w-full min-w-0 rounded border border-[var(--line)] bg-[var(--page)] p-2";

export function SpreadsheetAnalyzer({ id }: { id: string }) {
  const [info, setInfo] = useState<Inspection>();
  const [result, setResult] = useState<Analysis>();
  const [sheet, setSheet] = useState("");
  const [headerRow, setHeaderRow] = useState(1);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function execute(body: object, analyze: boolean) {
    setBusy(true); setError(""); setResult(undefined);
    try {
      const response = await fetch("/api/documents/" + id + "/spreadsheet", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Analysis failed.");
      if (analyze) setResult(data);
      else setInfo(data);
    } catch (error) { setError((error as Error).message); }
    finally { setBusy(false); }
  }

  return <details className="rounded border border-[var(--line)] p-3">
    <summary className="cursor-pointer font-semibold">Analyze spreadsheet</summary>
    <div className="mt-3 grid gap-3">
      <Button variant="outline" className="justify-self-start" disabled={busy}
        onClick={() => void execute({ operation: "inspect", sheet: sheet || undefined }, false)}>Inspect sheets and rows</Button>
      {info && <><p>{info.rowsAvailable ? info.rowsAvailable + " rows in the selected sheet." : "Select a sheet and inspect it."}</p>
        {!!info.missingFormulaValues && <p role="status">{info.missingFormulaValues} formula cells lack cached values.</p>}
        {info.sample.map((row, index) => <p key={index} className="text-sm wrap-anywhere">Row {index + 1} · {row.join(" | ") || "Blank"}</p>)}</>}
      <form className="grid gap-3" onSubmit={(event) => {
        event.preventDefault();
        const data = new FormData(event.currentTarget);
        const value = (name: string) => String(data.get(name) ?? "").trim();
        void execute({ operation: value("operation"), metric: value("metric"), groupBy: value("group") || undefined,
          currencyColumn: value("currency") || undefined, verifiedUnit: value("unit") || undefined,
          sheet: sheet || undefined, headerRow }, true);
      }}>
        {info && <label className="grid gap-1">Sheet<select className={field} value={sheet} onChange={(event) => setSheet(event.target.value)}>
          <option value="">Automatic for a single sheet</option>{info.names.map((name) => <option key={name}>{name}</option>)}
        </select></label>}
        <label className="grid gap-1">Header row<input className={field} type="number" min={1} max={300} required value={headerRow} onChange={(event) => setHeaderRow(Number(event.target.value))} /></label>
        <p className="text-sm">Use an exact header or a position such as column:2 when headings repeat.</p>
        <div className="grid gap-2 sm:grid-cols-2">
          {[["metric", "Metric column"], ["group", "Group column (optional)"], ["currency", "Currency column (optional)"],
            ["unit", "Confirmed unit if no currency column (number or currency code)"]].map(([name, label]) =>
            <label key={name} className="grid gap-1">{label}<input className={field} name={name} required={name === "metric"} maxLength={80} /></label>)}
        </div>
        <label className="grid gap-1">Operation<select className={field} name="operation">
          {["sum", "count", "average", "min", "max"].map((operation) => <option key={operation}>{operation}</option>)}
        </select></label>
        <Button disabled={busy} className="justify-self-start">{busy ? "Analyzing…" : "Run analysis"}</Button>
      </form>
      {error && <p role="alert">{error}</p>}
      {result && <section className="grid gap-3" aria-label="Spreadsheet chart">
        <h3 className="font-semibold">{result.sheet} · {result.operation} of {result.metric}</h3>
        {result.warnings.map((warning) => <p key={warning}>{warning}</p>)}
        {result.series.map(({ unit, groups }) => {
          const max = Math.max(1, ...groups.map(({ value }) => Math.abs(Number(value))));
          return <figure key={unit} className="grid gap-1">
            <figcaption className="font-medium">Unit · {unit}</figcaption>
            {groups.map(({ group, value }) => <div key={group} className="grid gap-1">
              <p className="wrap-anywhere">{group} · {value} {unit}</p>
              <div className="h-2 overflow-hidden rounded bg-[var(--page)]" aria-hidden="true">
                <div className={Number(value) < 0 ? "h-full bg-[var(--error)]" : "h-full bg-[var(--accent)]"} style={{ width: (Math.abs(Number(value)) / max * 100) + "%" }} />
              </div>
            </div>)}
          </figure>;
        })}
      </section>}
    </div>
  </details>;
}
