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
