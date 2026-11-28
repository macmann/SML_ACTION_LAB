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

## Phase 6 — spreadsheets and business workspace

- Added sheet, header-row and column selection for CSV and XLSX, cached-formula warnings, decimal aggregation and currency-separated charts. The v1 tool uses the same analyzer under its existing contract.
- Added manual task and note CRUD, evidence-backed invoice imports and verification, confirmed invoice status changes, expense records and follow-up tasks.
- Added authenticated XLSX, CSV and PDF exports for tasks, outstanding invoices and expenses. CSV text is neutralized for spreadsheet formula injection.
- Added a manual invoice-copy, email-draft and follow-up workflow. Each step requires its own approval. The writer receives verified invoice details only, and the app sends no email.
- Added migration 4. Earlier migrations and the generated v1 tool registry are unchanged.

### Validation

| Command | Result |
| --- | --- |
| `npm run lint`, `npm run typecheck`, `npm run contracts:check` | Passed. |
| `npm test` | 23 passed, including malformed worksheet rejection, exact decimals and duplicate-header selection. |
| `NEXT_TELEMETRY_DISABLED=1 npm run build` | Passed. |
| `docker compose config --quiet` | Passed. |
| `COMPOSE_FILE="$PWD/compose.yaml:<temporary-override>" npm run test:integration` | Passed against disposable PostgreSQL and HTTPS fixtures. Verified all ten v1 actions, no-match search, missing and mixed currencies, formula-cache warnings, CRUD, invoice verification, download content, workflow rollback and approval replay. |
| `npm --cache /tmp/slm-npm audit` | Zero reported vulnerabilities. |

Headless Chromium verified task creation and editing, note creation, a confirmed unpaid transition and independent currency charts at 320 and 1280 CSS pixels.

### Limits and next phase

Apply migration 4 before using the business pages. Legacy invoice records need verification before they enter outstanding totals. Business lists show up to 200 recent records per type. PDFs use ASCII text and XLSX and CSV remain available for other scripts. No live model or email service was contacted. Later phases can extend pagination, record export filters and accounting integrations. [Business workflows](business-workflows.md)

## Phases 7 and 8 — offline speech and Model Arena

- Added the optional CPU speech image, checksum-verified offline model installation, authenticated recording and WAV playback, and browser transcript review. Speech and Office share one running native job and three waiting slots.
- Added Model Arena with locked routing cases, a separate generation benchmark and faithfulness review, signed identity classification, separately recorded vendor aggregates, JSON/CSV exports and a confirmed cap of eight provider requests per batch.
- Added workspace migration 5 and preserved migrations 1–4 and the v1 prompt and tool schema hash. Runtime accepts native tool arguments as a JSON string or object after normalization and validation.
- Added reproducible Distil candidate exports with 300 training rows and 60 development rows. The separate locked holdout has 100 rows. Controls account for 50, 10 and 20 rows respectively.

### Validation

| Command | Result |
| --- | --- |
| `npm run lint`, `npm run typecheck`, `npm run contracts:check`, `npm test` | Passed. 28 tests include real FFmpeg silence decoding, queue limits, cancellation, timeout and temporary-file cleanup, and Arena scoring and attribution. |
| `npm run training:audit` | Passed. Checks manifest hashes, argument schema, all 460 labels, group separation and lexical leakage. |
| `docker compose -f compose.yaml -f compose.speech.yaml config --quiet` | Passed. |
| `COMPOSE_FILE="$PWD/compose.yaml:<temporary-override>" npm run test:integration` | Production build and disposable PostgreSQL and HTTPS fixtures passed. Includes Arena attribution, explicit cap, replay, synthetic execution scoring, generation review, vendor aggregates and exports, and speech diagnostics without models. The Cloud build used an ephemeral CA for npm access. |
| `docker build --target speech-native -t slm-speech-native:phase78 .` | Passed. Both the Whisper and Piper CLI help commands exited successfully with networking disabled. |
| `docker build --target speech-runtime -t slm-speech:phase78 .` | Passed using the same temporary npm CA adaptation. |
| `docker run --rm --network none --cpus 2 --memory 1536m --entrypoint node slm-speech:phase78 scripts/speech-smoke.mjs 1610612736` | The offline FFmpeg fixture generated 94,958 bytes of speech WAV in 119 ms in the run with the updated smoke script bind-mounted. Node process peak was 56,416 KiB, excluding native subprocesses. Cloud did not expose the requested container memory limit through cgroup. The Whisper and Piper model checks skipped. |

### Limits and next phase

Cloud blocked model downloads and access to the Distil documentation endpoints tested. Successful Whisper transcription, Piper voice synthesis, native model latency and memory, and browser microphone permission with installed models remain unverified. Install the verified bundles and run the offline fixture to measure inference on the intended CPU. The overlap audit measures lexical leakage and group separation. It cannot guarantee semantic independence. Routing execution scoring currently covers qualifying synthetic document searches. No training jobs, paid calls or live deployment ran. [Speech setup](speech.md) · [Model Arena and exports](model-arena.md)

### Distil export follow-up

Updated the export against Distil Labs' official public CLI configuration, task, model and dataset reference at revision `c012f4daec48e528818adcaa964dfadffa7bc998`. The vendor job now carries the exact fixed prompt and native registry. The 360 vendor rows contain two messages per row with object arguments. The 100 local holdout rows and their independent checksum are byte-for-byte unchanged. `npm run training:export`, `npm run training:audit`, and `npm run contracts:check` passed. The official CLI installer returned HTTP 403. CLI and platform validation remain pending. Model downloads remain blocked, so full offline voice and transcript checks are still pending. No dataset or job was submitted. [Distil Labs reference](https://github.com/distil-labs/distil-cli-skill/tree/c012f4daec48e528818adcaa964dfadffa7bc998/skills/distil-cli/references)

## Phases 9 and 10 — release candidate and operator checks

- The default Compose image bundles FFmpeg, whisper.cpp, Piper, LibreOffice Writer and bubblewrap. It starts as UID 1000 with two CPUs, 3 GiB memory and rotated container logs. Speech weights use the admin-controlled checksum installer. No database or provider is initialized during the build or first boot.
- Added authenticated diagnostics for a live database probe, migration ledger, model configuration and presence, index counts and storage capacity. Added a 3 GiB document-object quota and 256 MiB free-space reserve. Document extraction now shares the existing capped native worker lane.
- Added Chromium CI coverage and Docker checks for a clean first boot, recreated containers, backup restoration, provider outages, quota rejection and native launch. Migrations 1–5, the v1 tool profile and the frozen training splits are unchanged.
- Added deployment, security boundaries, recovery and retention guidance, and the training handoff. Use fictional data for provider requests. The operator controls what gets sent, and upstream endpoints may log prompts and responses. [Coolify runbook](COOLIFY.md) · [Release checklist](RELEASE.md) · [Distil handoff](DISTIL_TRAINING.md)

### Verified commands

The application image revision is `466491e8827f2384bc8a9fdac22b17a8532ed42a`, built locally as `sha256:913f6c5ec8b5b768038a5ed57e4a0eca37ac6a09ef35e4eb47dd5fc7223892d7`. Clean-clone checks used the identical application code at `156d6ee28f85afd2178c2722acc26f9994881c69`. The later commits through the image revision change the test harness only.

| Check | Observed result |
| --- | --- |
| `npm ci --cache /tmp/slm-npm --no-fund`, `npm run lint`, `npm run typecheck`, `npm run contracts:check`, `npm run training:audit`, `npm test` | Passed in a clean clone. All 28 tests passed. The final harness revision also passed lint, type checks, audits and all 28 tests. |
| `NEXT_TELEMETRY_DISABLED=1 npm run build` | Passed in the clean clone. Verified the standalone server, PDF worker, ExcelJS, PDFKit, locked holdout and checksum were present. |
| `docker compose config --quiet` | Passed. Rendered service exposes 3000 internally, declares 3 GiB and two CPUs, and has no host port or required user environment. |
| `npm --cache /tmp/slm-npm audit --audit-level=high` | Reported zero vulnerabilities. |
| `docker build --secret id=proxy_ca,src=<Cloud CA> -f <temporary Dockerfile> -t slm-release-test:phase910 .` | Passed from the clean clone. The direct dependency build timed out at 75 seconds. The successful build used an ephemeral Cloud npm trust mount with TLS verification enabled. Production does not require a build secret. |
| Offline native smoke (`docker run --rm --network none --cpus 2 --memory 3g`) | Whisper, Piper and LibreOffice launched. FFmpeg flite produced a 94,958-byte WAV in 126 ms. Node process peak was 55,984 KiB, excluding native subprocesses. Actual Whisper and Piper inference skipped because the verified model files were absent. |
| `docker inspect` and cgroup checks | HostConfig recorded `3221225472 2000000000 node`. The container and environment both reported `cpu.max=400000 100000` and `memory.max=34359738368`. The observed stats belonged to the shared Cloud cgroup, so the app-specific limits and peak RAM could not be confirmed there. |
| `COMPOSE_FILE="$PWD/compose.yaml:/tmp/slm-rc-prebuilt-compose.yaml" SLM_BROWSER_TEST=1 SLM_CHROMIUM=/usr/bin/chromium SLM_SCREENSHOT_DIR=/tmp/slm-rc-screenshots npm run test:integration` | Verified configuration-free startup, wrong-token and origin rejection, database migration and switching, TLS provider probes, quota rejection, authenticated downloads, model identity and replay, all ten agent actions with fictional fixtures, persistent data and session recovery after container recreation, and a database-and-volume restore into fresh storage. PostgreSQL and provider outages left local administration or manual document operations available, respectively. The temporary Compose overlay selected the verified image and cleared its build stanza. |
| Chromium E2E, run by the same command | Passed unclaimed setup routing, admin sign-in, upload, search, preview, actual download, missing speech model UI, and layout at 320 and 1,280 CSS pixels. Saved setup and document screenshots from Chromium. |

Versions used include Node 24.22.3, npm 11.19.1, Next.js 16.4.6, Docker 29.9.2, Compose 2.40.3, PostgreSQL fixture 17.7, Playwright Core 1.65.1 and Chromium 156.0.8078.79. The native image pins Debian FFmpeg 5.1.9, LibreOffice Writer 7.4.7, bubblewrap 0.8.0, whisper.cpp 1.8.3 and Piper 2023.11.14-2.

### Release limits

Cloud's kernel denied an unprivileged namespace for bubblewrap. Installed LibreOffice launched and conversion failed closed. Successful isolated DOCX-to-PDF conversion remains a target-host check. The speech weight downloads and Distil CLI installer were inaccessible, so actual speech inference, HTTPS microphone permission with installed models, CLI/platform validation and model accuracy remain unverified. Live Coolify routing, the intended external PostgreSQL connection and target-host cgroup enforcement require VPS verification. The backup drill restored generated fixture data, and the off-host encryption and backup transport remain operator responsibilities. No VPS deployment, dataset submission, paid inference, training, or release tag was performed.

## Custom provider validation and Settings navigation

The previous save path required a successful `GET /models/{id}` with an exact ID before encrypting and persisting a provider. Distil Labs returned HTTP 404 on that route while the operator independently confirmed chat completions succeeded. The upstream status was discarded and the UI showed a generic Settings failure.

Automatic mode now tries discovery and permits a single consented chat completion after HTTP 404, 405, or 501. Model Discovery uses the lookup alone. Chat Completion Test uses the entered model or deployment name directly and sends a fixed synthetic prompt. HTTP 401 and 403 stop validation. Errors identify the failing stage and available HTTP status and omit credentials and upstream response bodies. Connection tests preserve HTTPS certificate validation, DNS address checks, redirect rejection, and Bearer authentication. Validation mode is saved alongside the encrypted provider settings. Existing configurations default to Automatic, and consent applies to each submission. Provider settings use the local encrypted bootstrap store, and workspace data remains in PostgreSQL.

Settings uses separate Database, Model providers, Local speech, Preferences, and Account views. The Database tab identifies the required workspace setup. Providers, speech, and preferences are optional. Provider cards can be collapsed independently. [Distil configuration guide](DISTIL_TRAINING.md)

- `npm run lint`, `npm run typecheck`, `npm run contracts:check`, `npm test` and `docker compose config --quiet` passed. Unit suite result was 28 passed.
- `COMPOSE_FILE="$PWD/compose.yaml:<temporary Cloud CA build override>" SLM_BROWSER_TEST=1 SLM_CHROMIUM=/usr/bin/chromium npm run test:integration` built the production image and verified zero-config startup and health. Disposable HTTPS and PostgreSQL fixtures verified discovery success, fallbacks after 404/405/501, explicit chat mode, consent, 401 rejection, invalid model IDs, malformed HTTP 200 responses, timeout reporting, encrypted persistence, and tool execution. Chromium verified navigation between required and optional Settings sections and the consent checkbox default. The temporary build override supplied Cloud npm trust only.
- Hosted Distil inference was verified separately by the operator. This change used fixture credentials and no live inference or deployment. The earlier model-weight and Office sandbox limitations remain applicable.
- The first end-to-end Docker run exited successfully. The final image passed provider, Chromium, restore, and outage checks. Its last negative-volume check timed out while Cloud's Docker driver was creating the container. Starting that same container separately confirmed startup refused the inaccessible volume. The regression harness now creates the container before timing the startup check.

## Workspace diagnostics and migration readiness

Confirmed that saved setup status and live Assistant readiness previously used different conditions. The Assistant context required a compatible migration ledger and therefore failed before inference when the schema was missing. The exact VPS migration failure remains unknown until the authenticated diagnostic report is collected.

- Added a read-only, authenticated diagnostics report and Settings tab. It shows the live PostgreSQL target, connection and permissions, bundled migration versions, pending or missing schema, observed provider capabilities and identity, speech and storage checks. It offers sanitized JSON export and an explicitly confirmed migration action.
- Made the migration action verify the configured generation and database schema, report stage and duration, retain a durable recent event, and distinguish applied migrations from an idempotent no-op. The existing SQL payloads and checksums for versions 1–5 are unchanged.
- Added a private bounded operations journal and displayed it in Logs. The Assistant refreshes readiness after navigation, focus, visibility changes or an explicit retry. A context error disables the button and links to diagnostics.
- `npm run lint`, `npm run typecheck`, `npm run contracts:check`, `npm test`, and `docker compose config --quiet` passed. The unit suite passed 29 tests, including missing and incomplete migration registry cases.
- `COMPOSE_FILE="$PWD/compose.yaml:<temporary Cloud CA build override>" SLM_BROWSER_TEST=1 SLM_CHROMIUM=/usr/bin/chromium npm run test:integration` built the production image `sha256:1025af32d8cf7a98b5aa2e2bf12526bd6fccba502737654c66cd82c7bfc542cd`. Zero-config startup, disposable PostgreSQL login and permission failures, verified migrations and no-op, database switching and persistence, credential redaction, restored database and volume, and Chromium checks for the disabled and enabled Assistant passed. Chromium also injected a temporary readiness failure to verify that focus refresh clears and subsequently reloads context without a manual page reload.
- The Cloud build used an ephemeral npm CA adaptation. No production database, VPS, or paid provider was contacted. Hosted capabilities are not inferred from the local fixture. The bounded journal retains recent observations, so older activity may display as untested after rotation. [Investigation and operator steps](WORKSPACE_DIAGNOSTICS.md)

## PostgreSQL 18.7 permission inspection

- Located the reported rejection in `lib/database.ts`, where the original permission query combined five role attributes with `pg_read_all_data` and `pg_write_all_data` membership. Running the original query against PostgreSQL 18.7 confirmed a restricted `offgrid_app` owning `OFFGRID` passes with `public` owned by `pg_database_owner`. Each broad membership changed only the aggregate policy result and reproduced the rejection. The production membership and runtime target still need confirmation. [Original predicate and operator steps](WORKSPACE_DIAGNOSTICS.md#postgresql-187-permission-inspection-follow-up)
- Preserved the role policy and existing migration SQL. Diagnostics show every applied predicate, expected and actual values, and effective `public` ownership information. The migration gate uses the same predicate list. Failed database checks distinguish connection, policy, SQL, migration execution and workspace verification, with sanitized details, duration and SQLSTATE/query ID when available.
- `npm run lint`, `npm run typecheck`, `npm run contracts:check`, `npm test`, and `docker compose config --quiet` passed. All 29 unit tests passed.
- `COMPOSE_FILE="$PWD/compose.yaml:<temporary Cloud CA build override>" SLM_TEST_POSTGRES_IMAGE=postgres:18.7-bookworm@sha256:e742a2668255221388004f3a42b6150a2103f5054ab3a4a93ae9e4f01e551c35 SLM_BROWSER_TEST=1 SLM_CHROMIUM=/usr/bin/chromium npm run test:integration` built the production image `sha256:365aa1e47b4de26e16b0493ad53d14a4d860ba2182d2036fe5c6d6c58e730e7c` and verified zero-config boot. The real temporary PostgreSQL fixture exercised `OFFGRID` ownership, credential and target switches, both broad memberships, superuser rejection, database and schema CREATE denials, a malformed ledger with SQLSTATE `42703`, successful verified migrations and readiness. Fixture-specific changes affected no live infrastructure. The Cloud CA override only supplied npm trust for the build.
- The full PostgreSQL 18.7 Docker regression and Chromium E2E run exited 0, including the verified ledger and required tables after container recreation, Assistant button eligibility, backup restore, dependency outages, and inaccessible-volume rejection. Native speech model checks and isolated Office conversion retained their previously documented Cloud limitations. No live migration or database grants were changed.
