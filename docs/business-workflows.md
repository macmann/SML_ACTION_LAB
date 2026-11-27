# Spreadsheets and business workflows

Apply workspace migration 4 through Settings. Existing migration checksums and the trained v1 registry are unchanged. Earlier invoice rows lacked verified amounts and are shown as unverified imports until reviewed. The existing task and note tables retain their records.

## Spreadsheet analysis

Open a CSV or XLSX in **Documents**, preview it, and expand **Analyze spreadsheet**. Inspect the available sheets and sample rows. Select a sheet for a multi-sheet workbook, then specify the header row, metric and optional grouping column. Use an exact header or a position such as `column:2` for duplicate names. The parser caps input at 300 rows, validates archived XML and normalizes workbook date cells to ISO dates. ExcelJS reads cached formula results and reports missing or stale caches. No formula evaluation runs.

Sum, count, average, minimum and maximum operate on the selected column. Count uses nonempty cells. Arithmetic uses fixed six-place decimal values. Groups retain exact decimal strings, and chart series declare their units. An explicit currency column, or a recognized `Currency`, `Currency code` or `CCY` heading, partitions monetary results by currency. Missing or invalid currencies stop aggregation. For a monetary column with no currency column or observed currency codes, confirm a single ISO currency or an ordinary numeric unit. Currency totals are never combined.

The v1 tool uses the same engine. Supply a single CSV or one-sheet workbook with a usable first header row. The manual analyzer can select alternatives without adding fields to the trained tool contract.

## Tasks, notes and invoices

Use **Tasks / Notes** to create, edit or delete records. The assistant proposes tasks from explicit TODO, action-item or unchecked checklist lines and retains the supporting reference and quote. Task inserts run after approval with a unique approval and title key. Replayed approvals return the existing outcome.

Use **Invoices** to record a draft, or open an uploaded document preview and **Review invoice evidence and import**. Extraction displays the evidence and pre-fills only unambiguous fields. Review and confirm the exact values before recording an unverified import. A subsequent verification moves it to draft. Confirm each transition from draft to unpaid and from unpaid to paid. Outstanding totals use verified unpaid amounts and recorded tax, grouped by currency. Revision checks reject stale status changes. To create and track expenses, use the Expenses section.

Invoice email drafts require one verified invoice linked to the selected source. The chosen writer receives structured verified details after per-turn consent. It returns draft text and performs no send. Generic non-invoice drafts retain the document-sharing controls.

## Individually approved invoice workflow

On a verified invoice, propose a copy with a new number and explicit issue and due dates. Approve the copy before proposing an email, then opt in to sending verified details to the configured writer. The separate email approval produces an unsent draft. Only after the draft step succeeds can you propose and approve a follow-up with an explicit title and optional due date. Each step uses the existing immutable approval mechanism and commits its effects together with the workflow advance. A duplicate number fails without creating another draft. This workflow is available manually and is outside the trained v1 registry.

## Exports

The Tasks and Invoices pages offer authenticated XLSX, CSV and PDF downloads for tasks, outstanding invoices and expenses. The v1 task-status tool also returns download URLs for its selected status. XLSX writes ISO dates as typed date cells and retains exact monetary decimals as text. CSV neutralizes spreadsheet formula injection in text fields. PDF uses the bundled ASCII font repertoire. Non-ASCII records remain exportable as XLSX and CSV. Exports cap at 500 rows and identify truncated results through a response header, as well as an in-file notice for PDF and XLSX.
