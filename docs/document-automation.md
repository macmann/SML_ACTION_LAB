# Document intelligence and automation

Run workspace migrations after upgrading. An authenticated administrator can search and preview stored documents from **Documents**, then open **Edit a version or draft an invoice**. Template previews are local and do not call a model. Request approval from the preview, then approve the exact proposal. New versions have private downloads and a lineage record containing the original ID, source SHA-256, and version number.

## Search, extraction and summaries

The existing BM25+ index ranks stored text and metadata. An exact source or selected active handle resolves a single-source action. Ambiguous matches require the administrator to choose a source. Field extraction uses explicit labels, returns null for missing or conflicting values, and includes quotes and section references when available. Compare returns a deterministic section diff and field differences.

Summary requests require a selected document, a specifically chosen writer, global sharing permission, and per-turn consent. The experimental SLM option explicitly selects the configured Distil model for evidence summaries. The router receives handles only. The chosen writer receives extracted text and no binary files.

The summarizer maps up to four section-aligned chunks, each capped at 4,000 characters, and reduces the responses locally into at most 16 deduplicated quotes. A quote is accepted only if it occurs verbatim in the cited section. The result includes source labels and counts for total, planned and verified sections. Partial coverage is reported when the budget is exceeded or later chunks fail. Coverage describes examined sections. The output intentionally remains extractive so every displayed citation is directly verifiable.

## Word templates and invoices

Use a predictable DOCX with plain text paragraphs, tables, headers and footers. Supply each literal and the exact expected occurrence count. The editor supports adjacent split text runs. It preserves unaffected part contents and media and rejects unsupported fields, tracked edits, embedded objects, alternate content, external relationships and paragraphs whose matching text crosses a structural break. A changed span inherits formatting from the first run in the span.

For a template invoice, include exactly one placeholder for each of the following.

- `{{invoice_number}}`
- `{{invoice_date}}`
- `{{due_date}}`
- `{{period}}`
- `{{payment_terms}}`

Enter the number, period, invoice date, due date and payment term in days explicitly. The due date must agree with the supplied term, including across calendar-year boundaries. The app checks case-insensitive number uniqueness at preview and approval. Template edits leave currency, amount and tax as supplied by the source and explicit literal edits. Creating a new PDFKit invoice draft requires an explicit customer, description, decimal amount and currency. Omitted tax stays omitted. PDFKit drafts currently require ASCII text. These documents are drafts and are never sent by the app.

The trained v1 tool schema stays unchanged. A routed DOCX duplication can save a byte-identical copy under a new draft title containing the explicit requested period. It does not alter dates in the source body. Use template mode when the document itself needs a new invoice number or dates. Routed DOCX-to-PDF edits use one expected match per replacement. The manual editor supports configurable counts and DOCX output.

## LibreOffice capability

DOCX-to-PDF uses the native `/usr/bin/libreoffice` and `/usr/bin/bwrap` executables on an installation that permits unprivileged sandbox namespaces. The converter sees a private job directory and selected read-only system directories. It uses an isolated network namespace, fresh profile, highest macro security setting, fixed command arguments, CPU, address-space and file-size bounds, and a wall-clock timeout. It never falls back to unsandboxed conversion. Document operations are serialized, limiting concurrency to one conversion per app instance.

The default image omits LibreOffice and bubblewrap. To enable conversion, package both supported distribution binaries in the app image and verify the namespace capability as the app user in that deployment. The Cloud environment rejected bubblewrap namespace initialization. Successful LibreOffice conversion therefore remains unverified. Missing binaries and failed isolation return a visible conversion failure. DOCX editing and PDFKit draft generation have no LibreOffice dependency.
