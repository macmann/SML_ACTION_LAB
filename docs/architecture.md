# Architecture

The Next.js App Router server uses TypeScript, Zod, and Tailwind. The UI uses a [source-owned shadcn/ui Button](https://github.com/shadcn-ui/ui/blob/0e5b2e621a9ee4cf6a604bbe6c5c0d5b70561eb4/apps/v4/registry/new-york-v4/ui/button.tsx). Node 24 runs a Next.js standalone build with server dependencies. Docker Compose supplies the application network and a named volume. Coolify supplies HTTPS and routes to port 3000.

## Bootstrap and authentication

The entrypoint validates ownership and permissions before starting Next.js. The app uses an atomic JSON snapshot in `config/bootstrap.json`. Writers hold the same nonblocking kernel lock across read, update, and atomic replacement. The kernel releases the lock after a crash. Existing Phase 1 administrator accounts keep their password and are upgraded to stronger scrypt on the next successful login. Legacy sessions and plaintext pairing files are retired during the upgrade.

An operator creates a 256-bit pairing token in a private container terminal. The snapshot records its SHA-256 hash and 15-minute expiry. Successful claim writes the administrator and removes the token in one commit. Pairing, login, and password change use persistent attempt counters with five attempts per minute per operation. Account passwords use scrypt with N=131072, r=8, p=1 and a random salt.

The HTTP-only, Secure, SameSite=Strict session cookie is signed with the persistent session secret. Login and password rotation change the epoch so earlier cookies fail. Logout revokes the current epoch. Every mutation checks its origin against the request host as seen through the trusted ingress. The app serves no functional API at this phase. Future APIs must authenticate the administrator and apply origin protection to writes.

## Credentials and settings

AES-256-GCM encrypts database URLs and provider endpoints and keys. Each envelope includes a fresh 96-bit nonce, a version, and a tag. Associated data binds the value to its intended field. The independently generated 32-byte master and session keys are stored beside the snapshot with mode 0600. Co-location protects against accidental disclosure of the JSON snapshot alone. A host or root compromise can read both the keys and the encrypted data. Back up the keys and matching snapshot together.

The setup stages are unclaimed, claimed, database configured, and ready. Readiness includes a separate provider field for configured, skipped, or unknown configuration, independent of container liveness. Administrator preferences and the provider decision can be changed after setup. Public health reads expose configuration state without contacting remote services.

Database tests use a bounded `pg` client and execute `SELECT 1` against the candidate. The client closes before any settings are committed. A database replacement requires confirmation and increments the database generation so future connection pools and indexes can invalidate the previous generation. This phase has no long-lived pools or search index to rebuild. PostgreSQL migrations and search generation handling will land with the first persisted workflow. The app does not copy or migrate data on a switch.

Provider tests use authenticated HTTPS model metadata requests with bounded duration and response size. The default destination is `https://api.openai.com/v1`. Other OpenAI-compatible HTTPS servers require custom opt-in. RFC 1918 or IPv6 ULA destinations also require private-network opt-in. PostgreSQL permits internal hosts by default for Coolify networking. Both probes resolve the host, reject any disallowed address, and pin the connection to a validated address. Provider probes refuse redirects. PostgreSQL validates TLS by default and permits explicit plaintext only on allowed private addresses. Responses and logs exclude connection details and credentials.

## Persistent paths

| Path | Purpose |
| --- | --- |
| `/app/data/config` | Account, key material and encrypted runtime settings |
| `/app/data/files` | Imported source documents in future phases |
| `/app/data/artifacts` | Generated outputs in future phases |
| `/app/data/tmp` | Temporary processing data |
| `/app/data/models` | Native model assets in future phases |

Directories use mode 0700. Bootstrap files use mode 0600. Local npm commands use the same layout under the repository's ignored `data/` directory.

## Planned processing stack

Document ingestion will use Mammoth for DOCX, JSZip with a safe XML parser for Office archives, ExcelJS for spreadsheets, and PDF.js for PDF text. LibreOffice headless will handle office conversion and PDFKit will generate PDFs. MiniSearch will provide local BM25+ text retrieval. Recharts will render comparative results. FFmpeg will preprocess audio for whisper.cpp and Piper will handle local synthesis.
