# Architecture

The Next.js App Router server uses TypeScript, Zod, and Tailwind. The UI uses a [source-owned shadcn/ui Button](https://github.com/shadcn-ui/ui/blob/0e5b2e621a9ee4cf6a604bbe6c5c0d5b70561eb4/apps/v4/registry/new-york-v4/ui/button.tsx). Node 24 runs a Next.js standalone build with bundled server modules. The same pinned Node image digest is used in every Docker stage. Docker Compose supplies the application network and an app-owned named volume. Coolify supplies HTTPS and routes to port 3000.

## First boot and access

The entrypoint initializes private directories and validates configuration-file permissions before starting Next.js. Docker populates a new named volume from an image directory owned by the runtime user. Initialization rejects symlink directories and unexpected owners. Configuration writes use a temporary private file and an atomic hard link so concurrent requests cannot overwrite the account.

The administrator enters a high-entropy pairing code obtained from the container terminal and chooses a password. The persisted account stores a salted scrypt hash and a randomly generated session signing key. The pairing code becomes unusable once the account exists. A signed, expiring session is carried in an HTTP-only, SameSite=Strict cookie and marked Secure for HTTPS. Forms submit secrets in request bodies. The application uses no local or session storage for credentials. Page access and server actions enforce the account state.

## Persistent paths

| Path | Purpose |
| --- | --- |
| `/app/data/config` | Pairing and account files, future runtime service configuration |
| `/app/data/files` | Future imported source documents |
| `/app/data/artifacts` | Future generated outputs |
| `/app/data/tmp` | Temporary processing data |
| `/app/data/models` | Future native model assets |

Directories use mode 0700 and configuration files use mode 0600. Local npm commands use the same layout under the repository's ignored `data/` directory.

## Database and native tools

Phase 1 initializes no database client and has no migrations. The next phase will use `pg` with versioned SQL migrations. Explicit pool creation after loading administrator-provided configuration gives the application control over connection and migration timing while preserving zero-config boot. Ship the migration assets in the standalone runtime image when they exist. Store runtime credentials only on the server side and return only service state in readiness responses.

Speech and office binaries are deferred. Later phases will pin, verify and document each binary, model, and library before incorporating it into the image or installing it on demand.

## Planned processing stack

Document ingestion will use Mammoth for DOCX, JSZip with a safe XML parser for Office archives, ExcelJS for spreadsheets, and PDF.js for PDF text. LibreOffice headless will handle office conversion and PDFKit will generate PDFs. MiniSearch will provide local BM25+ text retrieval. Recharts will render comparative results. FFmpeg will preprocess audio for whisper.cpp and Piper will handle local synthesis. These workloads fit the single-container design and will run against configured files and models on the persistent volume.
