# SLM Action Lab

A standalone, single-admin document and productivity workspace. The workspace boots without configuration. Claim the administrator account, connect PostgreSQL, and optionally configure model providers after startup. The document workspace supports private uploads, extracted-text previews, attachments and local search.

## Run in Coolify

Use the Docker Compose build pack with [compose.yaml](compose.yaml). Attach the application domain to the `app` service on port 3000 and enable HTTPS. The project creates one app container and the `slm_data` named volume on its Compose network. Build and first boot require no project environment variables or external services.

Open the application domain. In the app container terminal, run the following command and enter the result privately in the first-run wizard along with a new admin password. Each invocation invalidates the previous token and issues a new one that expires in 15 minutes.

```sh
node scripts/operator.mjs pair
```

The volume must be writable by the app user (UID and GID 1000 in the image). Docker initializes a fresh named volume from the image. If reusing an existing volume, inspect its contents and ownership before transferring it to the application user. Startup fails with a diagnostic when a volume cannot be safely opened. Back up the volume to preserve the account, keys, encrypted settings, and future document data. Keep the backup private.

Coolify uses `GET /api/health/live` for its container health check. `GET /api/health/ready` reports the setup stage. It returns 503 until PostgreSQL has passed a probe and an administrator has configured Distil or explicitly selected manual mode. These are saved configuration states. The public endpoint does not contact providers or the database.

## Prepare the document database

Provision a dedicated PostgreSQL database and a login that owns only that database or has the equivalent schema-creation and migration privileges. Give it no cluster-level privileges such as superuser, role creation, database creation or replication. Use supported PostgreSQL releases with built-in reader and writer roles. PostgreSQL 17 was used for integration testing.

After testing and saving the connection in Settings, confirm the database is dedicated and select **Run workspace migrations**. Repeat after a database switch or a release that adds a migration. Migrations are transactional and tracked in a version ledger. The app keeps Settings and account recovery available during database outages.

Open **Documents** to upload PDF, DOCX, TXT, XLSX or CSV files. Each batch can include up to 20 files. Add optional tags and a document date at upload. Search works without a provider and can filter on either an explicitly supplied document date or the UTC upload date. Image-only PDFs are stored as originals and marked as having no extractable text.

The app defaults to 25 MiB per upload with a 64 MiB ceiling. Text and CSV inputs are limited to 4 MiB. Additional parser and workspace limits are listed in [the architecture](docs/architecture.md). Back up PostgreSQL together with the data volume to preserve originals and extracted artifacts.

## Edit document versions

Run workspace migrations after upgrading to Phase 5. Open a document preview to edit a supported DOCX template or create a PDF invoice draft. Review changes and approve the version before downloading it. Evidence summaries require explicit source selection and sharing consent. [Document automation](docs/document-automation.md)

## Work with business records

After applying migration 4, analyze uploaded tables from the document preview, manage task and note records in **Tasks / Notes**, and verify imports or approve invoice workflows in **Invoices**. The pages offer authenticated reports in XLSX, CSV and PDF. [Spreadsheet and business workflow guide](docs/business-workflows.md)

## Run the assistant

Apply workspace migrations again after upgrading to Phase 4. Configure Distil in Settings and import JSON routing metadata if available. The Assistant offers strict execution, Distil model-only, and comparison model-only modes. Use Documents to attach sources, then explicitly select them in the turn. Drafts and summaries also require a configured writer and document-sharing consent.

Strict mutations require a compatible endpoint that signs responses with an operator-pinned key and a separate approval in the Assistant. Unverified endpoints can still perform strict read-only tools. Model-only modes display validated predictions without running tools. See the exact tool definitions, setup requirements, and gateway attestation format. [Agent contract](docs/agent-contract.md)

## Use local speech and Model Arena

Build the optional speech target and install the offline model bundle to enable push-to-talk and WAV read-aloud. Typed chat works in the default image. [Local speech setup](docs/speech.md)

Apply migration 5 before opening Model Arena. Run capped routing comparisons on fictional holdout cases or review generation samples separately. [Arena and dataset guide](docs/model-arena.md)

## Develop locally

Use Node 24.22.3 and npm from that distribution.

```sh
npm ci
npm run dev
```

Open localhost on port 3000. The local server initializes the ignored `data/` directory. Generate a token in a separate terminal from the repository root with `node scripts/operator.mjs pair`. The host needs Linux `flock` from util-linux. Plain HTTP login is supported only on loopback for development.

```sh
npm run lint
npm run typecheck
npm run contracts:check
npm test
npm run build
npm run test:integration
```

The integration command requires Docker Engine and Compose v2. It uses a disposable Compose project, volume, PostgreSQL server, and HTTPS model fixture without publishing a host port. The test also requires OpenSSL. See the [architecture](docs/architecture.md), [product spec](docs/product-spec.md), and [implementation status](docs/IMPLEMENTATION_STATUS.md).

## Recovery and credential rotation

In Settings, change the admin password with its current value or test and save replacement database and provider credentials. A blank password-masked setting keeps the existing value. A provider key is never carried over to a different endpoint unless the administrator supplies a replacement explicitly.

If the administrator password is lost, use a trusted private terminal on the Docker host. In Bash, supply a new password via standard input so it stays out of command arguments and shell history.

```sh
read -rsp 'New administrator password: ' slm_recovery_password
printf '\n'
printf '%s\n' "$slm_recovery_password" | docker compose exec -T app node scripts/operator.mjs reset-password
unset slm_recovery_password
```

The console reset revokes existing sessions and clears throttling for the account. Restore `data/config/bootstrap.json`, `data/config/master.key`, and `data/config/session.key` from the same backup while the app is stopped. Preserve owner and permissions. A lost master key makes existing encrypted credentials unrecoverable. The app will fail visibly if a key file is missing. Keep an independent backup of PostgreSQL.
