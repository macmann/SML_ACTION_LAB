# Implementation status

## Phase 1 — standalone shell and zero-config boot

- Added the Next.js App Router workspace, seven guarded sections, first-run pairing, password-based admin sign-in, and sign-out.
- Added a production Compose service running as UID 1000, a persistent named volume, and separate liveness and readiness endpoints. Unclaimed and claimed instances can serve pages while readiness reports the database and provider as unconfigured.
- Added private data paths, an atomic claim write, a lockfile, pinned runtime and CI action versions, and GitHub Actions verification.

## Validation commands

| Command | Result |
| --- | --- |
| `npm --cache /tmp/slm-npm ci --no-fund` | Clean lockfile install on Node 24.22.3. |
| `npm run lint` | Passed. |
| `npm run typecheck` | Passed, including generation of route types. |
| `npm test` | Four passed, zero failed or skipped. |
| `NEXT_TELEMETRY_DISABLED=1 npm run build` | Passed. Next.js emitted standalone output. |
| `npm --cache /tmp/slm-npm audit` | Zero reported vulnerabilities. |
| `docker compose config --quiet` | Passed. |
| `npm run test:integration` | The plain Cloud build hit `SELF_SIGNED_CERT_IN_CHAIN` at the npm registry. CI is configured to run the plain command. |
| `COMPOSE_FILE="$PWD/compose.yaml:<temporary-override>" npm run test:integration` | Passed with the Cloud proxy CA mounted only for `npm ci`. Verified fresh-volume startup as non-root, liveness, unconfigured readiness, guarded routes, admin claim and session, restart persistence, and visible rejection of an inaccessible existing volume. |

The temporary Docker override used the same production stages and runtime. It mounted the managed Cloud CA for the dependency-install step with TLS verification active. The shipped Dockerfile and Compose file have no CA mount or build-secret requirement.

A local headless Chromium check used Playwright Core 1.65.1 against the standalone server. It exercised the first-run redirect and claim, keyboard focus, all seven sections, sign-out, and checked document width at 320 and 1280 CSS pixels with system color preferences. All checks passed.

Direct dependency licenses were checked against installed package metadata. TypeScript and class-variance-authority use Apache-2.0. The other direct npm dependencies and the adapted shadcn/ui source use MIT. Transitive package identifiers and licenses are recorded in the lockfile. A deployment image also inherits licenses from its pinned Node/Debian base.

## Limits and next phase

The workspace sections currently present capability status. Database configuration, migrations, model configuration, document workflows, speech, office conversion, and application history are future phases. Coolify ingress and deployment on the Contabo VPS have not been exercised.

Next, add administrator-managed PostgreSQL configuration with `pg`, versioned SQL migrations, and readiness checks. Add provider settings and probe the explicitly selected provider before making those workflows available. Admin password rotation and server-side session revocation are also pending.

## Phase 2 — secure bootstrap and runtime configuration

- Added a versioned JSON bootstrap store with fsync, atomic replacement, and a restart-safe kernel lock. Bootstrap needs no database. A one-time Phase 1 account import keeps the administrator password and upgrades its hash at next sign-in.
- Added operator-generated expiring pairing tokens, persisted throttling, origin validation, strong password hashing, revocable secure sessions, authenticated password rotation, and console recovery.
- Added encrypted PostgreSQL and provider settings, connection probes, confirmed database replacement, resumable setup, a provider skip option, and timezone, speech, limits and data-sharing preferences. Credentials are masked in Settings and excluded from public responses.
- Added a database generation counter. No data is moved on switch. This phase opens only short-lived probe connections and has no live indexes. Pool invalidation and index rebuilds will use the database generation when those features are introduced.

### Validation

| Command | Result |
| --- | --- |
| `npm run lint` and `npm run typecheck` | Passed. |
| `npm test` | 11 passed, including concurrent claims, token expiry, throttling, session revocation, envelope tampering, missing-key refusal, Phase 1 migration, and unsafe endpoint rejection. |
| `NEXT_TELEMETRY_DISABLED=1 npm run build` | Passed. Checked that a populated local bootstrap directory was excluded from standalone output. |
| `npm --cache /tmp/slm-npm audit` | Zero reported vulnerabilities. `pg`, `@types/pg` and `ipaddr.js` are pinned and use MIT. |
| `docker compose config --quiet` | Passed. |
| `COMPOSE_FILE="$PWD/compose.yaml:<temporary-override>" npm run test:integration` | Passed with the managed Cloud CA mounted only during npm install. Disposable PostgreSQL and HTTPS fixtures verified claim, origin rejection, session rotation, database switching, private provider opt-in, redirect rejection, manual mode, persistence and recovery. The integration command uses an ephemeral runtime CA to trust its synthetic HTTPS fixture. Production Compose has no CA or credentials requirement. |

Headless Chromium verified keyboard focus, pairing, masked database input, preferences, sign-out, and setup resume at mobile and desktop widths.

### Limits and next phase

Readiness reports the saved, tested setup state. It does not call remote services on health requests. Distil and custom providers use the OpenAI-compatible model metadata endpoint. Live providers, the Contabo deployment and Coolify ingress were not exercised. Document operations and PostgreSQL schema migrations remain for the next phase, alongside generation-aware pools and index rebuilds. The application has no files or logs APIs yet.

## Phase 3 — database, files and document workspace

- Added a lazy PostgreSQL pool capped at five connections, explicit transactional migrations with an advisory lock and checksum ledger, and the initial document and application schema. A confirmed database switch drains the prior pool and rebuilds the document index on the next workspace request.
- Added authenticated multi-file uploads, private immutable originals and extraction artifacts, compensating file cleanup, extracted previews, downloads, active attachments, and confirmed deletion.
- Added bounded PDF, DOCX, TXT, XLSX and CSV extraction, including page, paragraph, heading, table, sheet and cell references. Image-only PDFs report no extractable text. Office validation rejects archives with external relationships, unsafe paths, macros, encryption, XML doctypes or excessive expansion.
- Added section-level MiniSearch BM25+ with exact punctuated identifiers, document grouping, snippets, file and tag filters, date-field selection and sorting. Manual search works independently of inference.

### Validation

| Command | Result |
| --- | --- |
| `npm run lint` and `npm run typecheck` | Passed. |
| `npm test` | 14 passed. Fixtures cover all five formats, image-only PDFs, failed parsing, malicious Office archives, exact identifiers, ambiguous matches and independent date filters. |
| `NEXT_TELEMETRY_DISABLED=1 npm run build` | Passed. Docker integration exercised the standalone parser process and packaged PDF resources. |
| `docker compose config --quiet` | Passed. |
| `COMPOSE_FILE="$PWD/compose.yaml:<temporary-override>" npm run test:integration` | Passed with the managed Cloud CA mounted only for npm install. Verified repeat migrations, authorization, private downloads and artifacts, exact search, index restart and switch, stale-file cleanup, deletion, and administrator availability during an outage. |
| `npm --cache /tmp/slm-npm audit` | Zero reported vulnerabilities. The ExcelJS UUID dependency is pinned to the patched 11.1.1 release. |

Headless Chromium passed setup, migrations, upload, search, preview, attachment and confirmed deletion against PostgreSQL. The document workspace fit at 320 and 1280 CSS pixels.

The new dependencies are pinned in the lockfile. MiniSearch, ExcelJS, yauzl, csv-parse and the yauzl types use MIT. PDF.js uses Apache-2.0, JSZip offers MIT or GPL-3.0-or-later, and saxes uses ISC. Installed engine requirements are compatible with Node 24.

### Limits and next phase

No OCR, rich Office rendering or automatic document-date inference is included. DOCX extraction uses safe XML for structural references. Mammoth is planned for rich rendering. The document index assumes the single app instance and its own database writes. PostgreSQL and the persistent volume must be backed up together. Live Coolify ingress and deployment remain unverified. The next phase can connect active document selections to assistant conversations and tool execution with explicit data-sharing controls.

## Phase 4 — tool contracts, inference and approvals

- Added the v1.0.0 registry with ten action tools and two controls, generated runtime validators and OpenAI and training schemas. CI checks the generated artifact.
- Added an OpenAI-compatible routing gateway with fixed prompts, independent writer settings, optional signed model identity, bounded requests and redacted audit records. Only an explicitly selected source can be shown to a writer with per-turn consent.
- Added deterministic local tools, writer drafts, immutable approvals and atomic idempotent execution for task creation, draft duplication and literal conversion. Strict mode blocks unverified mutations. Comparison and model-only modes have no tool side effects.
- Added the Assistant, approvals and Logs views. Run workspace migrations after upgrading. Migration 1 is unchanged and migration 2 adds approval invariants and inference audit fields.

### Validation

| Command | Result |
| --- | --- |
| `npm run lint`, `npm run typecheck` and `npm run contracts:check` | Passed. |
| `npm test` | 18 passed. Covers schema parity, malformed native calls, exact decimals, ambiguous fields, and signed-response tampering and replay. |
| `NEXT_TELEMETRY_DISABLED=1 npm run build` | Passed. |
| `docker compose config --quiet` | Passed. |
| `COMPOSE_FILE="$PWD/compose.yaml:<temporary-override>" npm run test:integration` | Passed all ten tools with PostgreSQL and a disposable signed HTTPS fixture. Covers unverified and fallback refusal, unsafe responses, prompt isolation, source consent, timeouts, expiry, duplicate approvals, generated artifacts and audit redaction. |
| `npm --cache /tmp/slm-npm audit` | Zero reported vulnerabilities. AJV, PDFKit and the PDFKit types are pinned and use MIT. |

Headless Chromium verified setup, assistant mode selection, outage messaging and layout at 320 and 1280 CSS pixels. The Docker dependency installation used a temporary Cloud CA. Production Compose has no change to its credential requirements.

### Limits and next phase

Provider attestation requires a compatible gateway and an operator-pinned public key. The fixture verifies the protocol, and no live provider or paid request was used. Drafts return text and send no email. Persistent multi-turn conversations and broader business workflows remain for later phases. [Agent contract](agent-contract.md)

## Phase 5 — document intelligence and automation

- Added evidence summaries with section-aligned chunks, verifiable quotes, deterministic reduction and explicit coverage. Configured writers or the deliberately selected experimental SLM receive extracted text only after consent.
- Added evidence-backed field extraction and a deterministic document and field diff.
- Added a provider-independent DOCX editor with split-run replacement, exact match counts, before-and-after previews, and immutable approved versions. Added explicit invoice fields, case-insensitive number registration, due-date validation and PDFKit invoice drafts.
- Added a sandboxed native Office converter path that refuses to run without its required binaries or isolation. The default image does not package native Office tools.
- Added workspace migration 3 for document-lineage and invoice-number records. The trained v1 registry is unchanged.

### Validation

| Command | Result |
| --- | --- |
| `npm run lint`, `npm run typecheck`, `npm run contracts:check` | Passed. |
| `npm test` | 22 passed. Includes split-run and table/header/footer edits, untouched media, missing and duplicate matches, unsupported markup, missing converter and fabricated citation rejection. |
| `NEXT_TELEMETRY_DISABLED=1 npm run build` | Passed. |
| `docker compose config --quiet` | Passed. |
| `COMPOSE_FILE="$PWD/compose.yaml:<temporary-override>" npm run test:integration` | Passed against disposable PostgreSQL and HTTPS fixtures. Verified short and partial-coverage summaries, authenticated preview and approval, November-to-December edits with a January due date, original SHA-256 preservation, number uniqueness, PDFKit draft downloads and visible failure without LibreOffice. |

### Limits and next phase

The Cloud machine lacked LibreOffice and rejected bubblewrap namespace initialization. Successful native DOCX-to-PDF conversion has not been verified. The default image supports DOCX edits and PDFKit drafts without that capability. DOCX editing remains limited to predictable templates and PDFKit drafts use ASCII text. The next phase can expand invoice workflows and verify native conversion on a deployment that supports the isolated runtime. [Document automation](document-automation.md)
