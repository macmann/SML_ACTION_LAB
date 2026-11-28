# SLM Action Lab

SLM Action Lab is an experimental, single-admin workspace for private documents, local search, productivity records, and supervised AI actions. It boots with an empty volume. Claim the administrator account, connect a dedicated PostgreSQL database, and choose manual mode or configure a model provider.

- [Deploy to Coolify](#deploy-to-coolify)
- [Run Docker Compose locally](#run-docker-compose-locally)
- [Claim and configure the workspace](#claim-and-configure-the-workspace)
- [Use the workspace](#use-the-workspace)
- [Operate and recover the app](#operate-and-recover-the-app)
- [Develop and test](#develop-and-test)
- [Release status and documentation](#release-status-and-documentation)

## Deploy to Coolify

### Requirements

- A Linux x86-64 Docker host with Docker Compose v2 and Coolify. Whisper uses AVX2. Allow disk space for the native image, Docker build cache, workspace volume, and backups.
- A domain pointed at the Coolify ingress and configured for HTTPS. Browser microphone access requires HTTPS outside loopback.
- A dedicated PostgreSQL database reachable from inside the app container when you configure the workspace. PostgreSQL 17.7 was used for integration testing.
- One app replica. The service uses a private Compose network and the named volume `slm_data` mounted at `/app/data`. The image runs as UID/GID 1000. Builds fetch pinned dependencies and native source or release assets. Build and first boot require no project `.env`, credentials, database URL, or API key.

### Configure the application

1. In Coolify, create a Git-backed application for this repository and choose the **Docker Compose** build strategy. Set the branch to the revision you intend to deploy, the base directory to the repository root, and the Compose location to `/compose.yaml`.
2. Under **Domains**, assign the HTTPS hostname to service `app` on **internal port 3000**. Coolify's proxy handles ingress. The checked-in Compose file publishes no host port.
3. Review the rendered Compose before starting. Preserve the named volume across deployments. Confirm that the app is non-root and that Coolify retains `mem_limit: 3g` and `cpus: 2.0`. Keep automatic deployment disabled while evaluating the release candidate.
4. Build and start the application. Open the HTTPS URL. A fresh volume should display **Claim this instance**. The Docker health check uses `/api/health/live` and succeeds before setup.
5. Open a private terminal for the running app in Coolify and follow [first-run setup](#claim-and-configure-the-workspace).

An existing volume must be writable by UID/GID 1000. Startup reports an error when storage cannot be opened safely. Use the operator runbook for a reused volume, external database networking, proxy troubleshooting, and host-side resource checks. [Coolify operator runbook](docs/COOLIFY.md) · [Production Compose](compose.yaml)

## Run Docker Compose locally

From the repository root, build and start the production service with an empty volume or the existing project volume.

```sh
docker compose config --quiet
docker compose up --build --detach --wait
docker compose ps
docker compose exec -T app node -e 'fetch("http://127.0.0.1:3000/api/health/live").then(async r => { if (!r.ok) process.exitCode = 1; console.log(await r.text()); }).catch(() => { process.exitCode = 1; })'
```

For temporary browser access on the Docker host, create a separate local override such as `compose.local.yaml` and bind only loopback.

```yaml
services:
  app:
    ports:
      - "127.0.0.1:3000:3000"
```

```sh
docker compose -f compose.yaml -f compose.local.yaml up --detach --wait
docker compose -f compose.yaml -f compose.local.yaml exec app node scripts/operator.mjs pair
```

Open `http://127.0.0.1:3000`. Keep the override out of your production configuration. The workspace still needs a PostgreSQL endpoint reachable from the app container. A PostgreSQL server listening only on the host's loopback interface does not become reachable via the app container's loopback.

## Claim and configure the workspace

1. **Claim the instance.** Run `node scripts/operator.mjs pair` in the app terminal, or run `docker compose exec app node scripts/operator.mjs pair` on the Docker host. Enter the token privately in the setup wizard and create an admin password of 12–128 characters. The token expires after 15 minutes. Issuing a new one invalidates the previous token.
2. **Connect PostgreSQL.** Provision a dedicated database and a restricted login with permission to own the database or create and migrate its workspace schema. Keep cluster-level privileges such as superuser, role creation, database creation, and replication off the app login. Enter the URL in **Settings → Test and save database**. Use an address the app container can resolve and reach. Docker service names are scoped to networks, so another Coolify project's service name alone is insufficient. Keep port 5432 private. Use `sslmode=verify-full` with a trusted certificate and matching hostname across untrusted networks. Explicit `sslmode=disable` is limited to private addresses and is suitable only on a trusted isolated network.
3. **Apply the schema.** Confirm the dedicated database in Settings and select **Run workspace migrations**. The transactional migration ledger covers versions 1–5. Run this action after switching databases or when a later release adds a migration. A failed connection test preserves the current database configuration.
4. **Choose manual mode or a provider.** Manual mode supports uploads, search, previews, downloads, and business workflows that require no inference. To enable inference, open the optional **Model providers** tab and test and save the exact endpoint and model ID. Select **Chat Completion Test** and explicitly allow one test request for deployments that provide chat completions without model metadata. **Automatic** tries discovery first and uses the consented test after HTTP 404, 405, or 501. **Model Discovery** uses metadata only. You can also configure a comparison model or a dedicated writer. Provider requests can be logged upstream. Use fictional material in provider prompts, documents, and evaluations.
5. **Verify the instance.** Open **Settings → Diagnostics** for live readiness, migration results, and sanitized JSON export. Check database connectivity, migration state, provider configuration, native and model availability, index state, and storage capacity. Upload a fictional TXT document, search for it, and download the original.

| Endpoint | Access | Meaning |
| --- | --- | --- |
| `GET /api/health/live` | Public | Process health. Use for Docker and Coolify health checks. |
| `GET /api/health/ready` | Public | Saved setup stage. Returns 503 until setup is complete. |
| `GET /api/diagnostics` | Admin | Live PostgreSQL probe, migration state, configured providers, speech capabilities, index counts, and storage. |

## Use the workspace

| Area | What you can do |
| --- | --- |
| **Documents** | Upload PDF, DOCX, TXT, XLSX, and CSV. Preview extracted text, search locally by text or metadata, manage active attachments, and download originals. Search can filter by uploaded date or document date. Scanned PDFs without a text layer are stored with a no-text status. |
| **Document automation** | Preview supported DOCX template edits and approve a new version while preserving the original. Generate draft invoice PDFs with PDFKit. Native DOCX-to-PDF conversion requires a working bubblewrap sandbox. |
| **Tasks / Notes, Invoices** | Manage business records, review invoice evidence and status, analyze spreadsheets, and export XLSX, CSV, or PDF reports. Invoice duplication and follow-up workflows use separate approvals. Email drafts stay in the workspace. |
| **Assistant** | Route a request through the fixed v1 profile of ten action tools and two controls. Select up to five active references. Strict mutations require a compatible signed response and a separate approval. Model-only modes show predictions without running tools. |
| **Model Arena and Logs** | Compare configured models on fictional holdout cases, review generation quality separately, and export scores. Review redacted routing, validation, execution, and attribution records. |

Provider configuration alone does not verify the checkpoint serving a response. Import routing metadata in Settings using the exact model ID, schema version, and schema hash. A compatible gateway can attest responses with an operator-pinned Ed25519 public key. Writer calls require explicit model selection and document-sharing consent for extracted text. The router receives your request and reference handles. [Agent contract and metadata format](docs/agent-contract.md) · [Document automation](docs/document-automation.md) · [Business workflows](docs/business-workflows.md)

### Local speech

The production image includes FFmpeg, whisper.cpp, and Piper CPU executables. Install the verified multilingual Whisper Base and English Piper voice bundle on the persistent volume using the operator installer. Enable speech in Settings after the diagnostics report model availability. Use push-to-talk, review the transcript, then copy it into the editable request. WAV read-aloud uses the installed local voice. The same typed chat remains available when models are absent. [Offline model installation, checksums, and smoke test](docs/speech.md)

### Model evaluation and training export

The Distil export contains 300 synthetic training examples and 60 development examples in `training/vendor-candidate/`. The separate, checksum-locked 100-case holdout in `training/local/` stays outside training uploads. Arena compares routing and generation separately and reports provider attribution. The export follows the official vendor reference. CLI and platform validation are pending. [Model Arena](docs/model-arena.md) · [Distil training handoff](docs/DISTIL_TRAINING.md)

## Operate and recover the app

- **Capacity.** The default upload limit is 25 MiB, with a 64 MiB ceiling and a 4 MiB cap for TXT and CSV. Upload batches accept up to 20 files. The active index supports 1,500 documents and 12,000 sections. Originals and extracted artifacts share a 3 GiB object quota with a 256 MiB filesystem free-space reserve. Speech, Office, and document parsing share one active heavy job and three waiting slots.
- **Data and upgrades.** PostgreSQL stores workspace records. The named volume stores encrypted bootstrap settings, the local keys, originals, extracted artifacts, temporary jobs, and installed models. Keep the same volume on container recreation and apply migrations in Settings when needed. Avoid volume removal during an upgrade.
- **Backup and restore.** Stop app writes and capture the PostgreSQL dump and named volume as one backup set. Store encrypted copies off-host. Keep `config/bootstrap.json`, `config/master.key`, and `config/session.key` together. Verify a restore on a fresh volume and dedicated database through sign-in, migration status, search, and a sample download. Use a matched app revision and backup set for schema-incompatible rollbacks.
- **Credentials.** Test replacements in Settings. A blank masked field keeps the existing value. The app requires an explicit replacement key when moving a provider to a different endpoint. Keep pairing tokens, keys, connection URLs, and screenshots with credentials private.
- **Outages.** The app can start before database setup. Local Settings and account recovery remain available during a database outage. Manual document operations remain available during a provider outage when PostgreSQL is reachable.

If locked out, run the following in a trusted Bash terminal on the Docker host. The password goes through standard input. The reset revokes existing sessions and clears account throttling.

```bash
read -rsp 'New administrator password: ' slm_recovery_password
printf '\n'
printf '%s\n' "$slm_recovery_password" | docker compose exec -T app node scripts/operator.mjs reset-password
unset slm_recovery_password
```

For backup commands, restore verification, rollback, PostgreSQL networking, and retention, use the operator runbook. [Coolify and recovery runbook](docs/COOLIFY.md)

## Develop and test

Use Node.js 24.22.3, its bundled npm, and Linux `flock` from util-linux. Run the dev server on a trusted machine and use its loopback URL. It initializes the ignored `data/` directory.

```sh
npm ci --no-fund
npm run dev
```

Open `http://127.0.0.1:3000` and generate a token from a second terminal at the repository root with `node scripts/operator.mjs pair`. The dev server binds to all interfaces, but plain HTTP sign-in is limited to loopback.

```sh
npm run lint
npm run typecheck
npm run contracts:check
npm run training:audit
npm test
npm run build
docker compose config --quiet
npm run test:integration
```

Integration requires Docker Engine, Compose v2, and OpenSSL. It creates disposable volumes and PostgreSQL and HTTPS model fixtures. To include Chromium E2E, install the pinned Playwright Chromium and set the browser flag. Only the browser fixture publishes a temporary loopback port.

```sh
npx playwright-core install --with-deps chromium
SLM_BROWSER_TEST=1 npm run test:integration
```

## Release status and documentation

The release candidate passed the standalone build, 28 unit tests, Docker integration, Chromium E2E, container recreation, and a fictional PostgreSQL-and-volume restore. Cloud verified the Docker resource configuration. Live Coolify routing, the intended PostgreSQL TLS connection, and actual VPS cgroup enforcement still require target-host checks. Cloud's namespace restrictions blocked isolated LibreOffice conversion. Installed-model speech inference, HTTPS microphone verification, and Distil CLI/platform validation remain open. Model accuracy has yet to be measured. [Exact results and tested versions](docs/IMPLEMENTATION_STATUS.md) · [Release checklist](docs/RELEASE.md)

- [Workspace readiness investigation and operator diagnostics](docs/WORKSPACE_DIAGNOSTICS.md)
- [Architecture and resource limits](docs/architecture.md)
- [Product scope](docs/product-spec.md)
- [Coolify deployment, backup, restore, and rollback](docs/COOLIFY.md)
- [Local speech setup](docs/speech.md)
- [Agent contract and provider attestation](docs/agent-contract.md)
- [Distil training handoff](docs/DISTIL_TRAINING.md)
