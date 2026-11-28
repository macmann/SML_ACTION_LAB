# Agent contract 1.0.0

The trained routing profile declares exactly ten action functions and two non-executing control functions. The source registry generates the committed OpenAI function list and JSON Schema for training examples. Generate with `npm run contracts:generate` and verify with `npm run contracts:check`. The SHA-256 digest covers the version and canonical tool definitions. The profile digest separately binds the exact system prompt, model, role, metadata, sampling and thinking setting. [Generated registry and training schema](../contracts/agent-v1.json)

## Tool inputs and behavior

Arguments are closed objects. Omit unknown optional values. Top-level names and enum values are case-sensitive. Unless bounded separately below, text inputs contain at least one non-whitespace character and are at most 160 characters. A reference is a document ID, exact filename or title, search text, or a selected handle `@active:1` through `@active:5`. Use `@active` only when exactly one document is selected. Multi-document matches require clarification for single-source tools. Identifiers containing digits and dates must be grounded in the request or resolved through an active handle.

| Action | Arguments | Behavior |
| --- | --- | --- |
| `search_documents` | `query` text, optional `file_type`, optional `date_filter` | Returns up to 12 local matches with snippets and a total. |
| `search_and_summarize` | `query` reference, optional `focus` text, optional `summary_style` of `brief`, `bullets`, `detailed` | Resolves one selected source and uses the explicitly chosen writer to select verified section evidence. |
| `duplicate_document` | `source_query` reference, `target_period` as `YYYY-MM`, Boolean `preserve_amount` and `preserve_customer` | When both flags are true, proposes an extracted-text copy labeled with the requested period. Original values remain intact. For changed values use explicit replacements. |
| `extract_document_fields` | `source_query` reference, `fields` of 1–8 distinct names | Reads explicit labels and reports missing or ambiguous values. Allowed fields are `invoice_id`, `invoice_date`, `due_date`, `amount`, `currency`, `customer`, `supplier`, `reference`. |
| `compare_documents` | `left_query`, `right_query` references | Compares distinct sets of extracted sections and returns bounded differences. |
| `analyze_spreadsheet` | `source_query` reference, optional `group_by`, `metric`, `operation` | Column names are at most 80 characters. Operations are `count`, `sum`, `average`, `min`, `max`. Analysis uses exact column names from CSV or a single nonempty XLSX sheet. Count uses nonempty metric cells. Arithmetic uses fixed decimal values and rounds averages to six places. Formula values are excluded. |
| `generate_report` | `report_type`, optional `filters` | `document_inventory` accepts `file_type`, `date_filter`, and `tag` up to 40 characters. `task_status` accepts only `task_status` of `open` or `done`. Results are read-only. |
| `create_tasks_from_document` | `source_query` reference | Proposes up to 12 distinct tasks from explicit TODO or unchecked checklist lines. It does not infer due dates. |
| `draft_email` | `source_query` reference, `purpose` up to 400 characters, optional `tone` of `neutral`, `formal`, `friendly` | Uses the selected writer and source. Returns draft text. |
| `modify_and_convert` | `source_query` reference, `replacements` of 1–12 closed `{find, replace}` objects, `output_format` of `txt` or `pdf` | Proposes a new document. `find` is nonblank up to 120 characters. `replace` may be empty and is at most 200. Quote both literal values in the request. Originals remain intact. PDF generation supports ASCII text. |

`file_type` is one of `pdf`, `docx`, `txt`, `xlsx`, `csv`. A date filter has `field` of `document` or `uploaded` and at least one of `from` or `to` as real calendar dates in `YYYY-MM-DD`. Inclusive bounds must be ordered and appear explicitly in the request. The generated training and runtime validators share structural schemas. Calendar validity, ordering, grounding and document resolution are additional runtime checks.

`clarification_required(question)` and `unsupported_intent(reason)` accept one nonblank string up to 400 characters. They return text to the administrator without invoking a tool.

## OpenAI-compatible wire format

Routing sends one `POST /chat/completions` with the fixed system prompt, a user JSON message containing the request and selected handles, the native function registry, `tool_choice: "required"`, `parallel_tool_calls: false`, and `n: 1`. The assistant must return one native `tool_calls` entry with function arguments encoded as a JSON string and finish with `tool_calls`. The generated training schema uses argument objects for validation before serialization to that wire format. Unknown tools, multiple calls, invalid arguments and incomplete responses are rejected. Free text never invokes an action.

The router receives at most 2,000 request characters and five reference handles. It receives no extracted document text. A separate writer request may receive at most 8,000 characters from one explicitly selected source. Writing requires choosing the configured writer, enabling document sharing in Preferences, and consenting for the individual turn. Writer calls advertise no tools. The endpoint response must contain finished draft text. The response is rendered as text. There is no fallback model or retry.

Endpoint checks use HTTPS model discovery or one explicitly consented synthetic chat completion. Automatic mode tries discovery and can fall back to chat after HTTP 404, 405, or 501. HTTP 401 and 403 stop validation. Inference uses the same destination policy, pinned resolved address, certificate verification and redirect rejection. DNS resolution is bounded to four seconds and the completion request to nine seconds with a 96 KiB response limit. The application enforces a rolling per-minute inference limit and at most two concurrent provider requests.

## Distil metadata and identity

In Settings, paste plain JSON metadata for the exact configured model. Required keys are `modelId`, `schemaVersion`, and `schemaHash`. Optional keys are `systemPrompt` if identical to the v1 prompt, `origin`, `revision`, `checkpointSha256`, `attestationPublicKey`, `sampling`, and `thinking`. The checkpoint digest is 64 lowercase hexadecimal characters. Sampling fields are `temperature` in 0–1, `topP` in (0,1], and `maxCompletionTokens` in 64–768. Thinking is `off` by default or `on` for a compatible custom endpoint using `chat_template_kwargs.enable_thinking`. Metadata import does not run Python or load model code. The active provider endpoint and API key remain in the encrypted settings.

A compatible Distil gateway can attest native responses using a pinned Ed25519 public key. Metadata with a key requires a checkpoint digest and origin. The app sends `Slm-Challenge` with a fresh nonce and `Slm-Profile` with the profile hash. The gateway signs the UTF-8 canonical JSON object with fields `version: 1`, `challenge`, `profileId`, `model`, and `choice`. The choice is the exact sole response choice. Canonical JSON sorts object keys recursively, retains array order, and omits spaces. Return the unpadded base64url signature as top-level `slm_attestation.signature`. The effective model must match the configured ID and fallback indicators must be absent or false.

An attestation verifies an assertion from the operator-pinned signer for that response. It cannot independently inspect deployed weights. An unidentified endpoint, unsigned response, invalid signature, model mismatch, or declared fallback is labeled **unverified**. Settings probes establish connectivity and response compatibility. Model identity requires a per-response attestation. Strict mode blocks unverified mutations. Comparison and model-only modes validate predictions and record evaluation logs without executing tools or creating approvals.

## Approvals and audit

A verified mutation resolves its source and produces an immutable pending plan. The proposal binds the tool version and hash, routing profile, database generation, source ID and resolved parameters. It expires after 15 minutes and carries the original turn UUID as its idempotency key. The administrator reviews the exact parameters and explicitly approves the hash. A transaction advances pending to approved to executing and creates a unique execution record. The tool effect and final status commit together. Terminal replay reads the outcome. Interrupted executions can be marked failed after two minutes and are never retried. The v2 migration enforces proposal immutability and allowed status transitions.

Inference records contain exact system prompt and profile settings, action name, validation status, execution status, verified or unverified identity, and separate routing, writing and execution times. They exclude request text, document text, tool arguments, raw provider responses and credentials. Approval records separately retain the bounded parameters needed for review. No email is sent and assistant-generated files remain separate from their source.

Phase 5 adds chunked evidence summaries and manual version editing without changing the trained tool schema. [Document automation](document-automation.md)

Phase 6 preserves the trained v1 schema and adds manual spreadsheet controls and an individually approved invoice workflow. The latter is outside the trained registry. [Business workflows](business-workflows.md)
