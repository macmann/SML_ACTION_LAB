# Architecture

The Next.js App Router server uses TypeScript, Zod, and Tailwind. The UI uses a [source-owned shadcn/ui Button](https://github.com/shadcn-ui/ui/blob/0e5b2e621a9ee4cf6a604bbe6c5c0d5b70561eb4/apps/v4/registry/new-york-v4/ui/button.tsx). Node 24 runs a Next.js standalone build with server dependencies. Docker Compose supplies the application network and a named volume. Coolify supplies HTTPS and routes to port 3000.

## Bootstrap and authentication

The entrypoint validates ownership and permissions before starting Next.js. The app uses an atomic JSON snapshot in `config/bootstrap.json`. Writers hold the same nonblocking kernel lock across read, update, and atomic replacement. The kernel releases the lock after a crash. Existing Phase 1 administrator accounts keep their password and are upgraded to stronger scrypt on the next successful login. Legacy sessions and plaintext pairing files are retired during the upgrade.

An operator creates a 256-bit pairing token in a private container terminal. The snapshot records its SHA-256 hash and 15-minute expiry. Successful claim writes the administrator and removes the token in one commit. Pairing, login, and password change use persistent attempt counters with five attempts per minute per operation. Account passwords use scrypt with N=131072, r=8, p=1 and a random salt.

The HTTP-only, Secure, SameSite=Strict session cookie is signed with the persistent session secret. Login and password rotation change the epoch so earlier cookies fail. Logout revokes the current epoch. Every mutation checks its origin against the request host as seen through the trusted ingress. Document and assistant APIs authenticate the administrator and apply origin protection to writes.

## Credentials and settings

AES-256-GCM encrypts database URLs and provider endpoints and keys. Each envelope includes a fresh 96-bit nonce, a version, and a tag. Associated data binds the value to its intended field. The independently generated 32-byte master and session keys are stored beside the snapshot with mode 0600. Co-location protects against accidental disclosure of the JSON snapshot alone. A host or root compromise can read both the keys and the encrypted data. Back up the keys and matching snapshot together.

The setup stages are unclaimed, claimed, database configured, and ready. Readiness includes a separate provider field for configured, skipped, or unknown configuration, independent of container liveness. Administrator preferences and the provider decision can be changed after setup. Public health reads expose configuration state without contacting remote services.

Database tests use a bounded `pg` client and execute `SELECT 1` against the candidate. The client closes before any settings are committed. A database replacement requires confirmation, drains the active pool, and increments the database generation. The next document request opens a new pool and rebuilds its index from the active database. Switching databases leaves the previous database and its files in place.

Provider tests use authenticated HTTPS requests with bounded duration and response size. Automatic validation tries model discovery first and can use a fixed chat prompt after HTTP 404, 405, or 501 with explicit consent. Model Discovery forces metadata verification. Chat Completion Test sends one fixed prompt directly and requires consent. Validation accepts an entered deployment name and reports the failed stage and upstream status without echoing upstream content. The default destination is `https://api.openai.com/v1`. Other OpenAI-compatible HTTPS servers require custom opt-in. RFC 1918 or IPv6 ULA destinations also require private-network opt-in. PostgreSQL permits internal hosts by default for Coolify networking. Both probes resolve the host, reject any disallowed address, and pin the connection to a validated address. Provider probes refuse redirects. PostgreSQL validates TLS by default and permits explicit plaintext only on allowed private addresses. Responses and logs exclude connection details and credentials.

## Document database and storage

PostgreSQL is accessed with a generation-scoped `pg` pool capped at five connections. Connections, statements and locks have timeouts. The administrator runs migrations explicitly in Settings. The migration service rejects elevated roles and system databases. It acquires a transaction-scoped advisory lock, checks the migration ledger and commits each run as a transaction. The app ships schema definitions with the server bundle. Application preferences remain authoritative in the local bootstrap store. A PostgreSQL table is available for future workspace-scoped preferences.

The migration creates an installation ID used to namespace originals and extracted-text artifacts on the volume. Uploads and other document operations are serialized. The app validates file metadata, media type and content before inserting rows. Each original and extracted JSON artifact is written through an exclusive temporary file, synced, and linked into place before the database commit. It removes files on a known rollback. If commit status is uncertain, the next index rebuild or periodic reconciliation uses the database to identify stale files and pending uploads older than one hour. Deletion commits database removal before unlinking the files. Only authenticated routes resolve immutable originals for download.

A separate Node process extracts text with a 25-second deadline and a bounded JavaScript heap. PDF.js extracts page text and distinguishes image-only PDFs. SAX parsing preserves DOCX headings, paragraphs and table-row references. XLSX preflight validates and repacks ZIP entries before passing them to ExcelJS. It reads cell values without evaluating formulas. TXT uses strict UTF-8 and CSV uses a bounded parser. Office extraction rejects encrypted entries, macros, external relationships, XML doctypes, unsafe paths and oversized or suspicious compressed entries. Mammoth is deferred until rich DOCX rendering is needed.

MiniSearch indexes filename, title, tags and section text with BM25+. It keeps whole punctuated identifiers and groups section matches by document. Date filtering explicitly selects uploaded UTC day or the supplied document date. Results include one bounded snippet and reference per document. The in-memory index is rebuilt from PostgreSQL on restart or switch and updated after committed uploads and deletions. Active attachments are database-backed and scoped to the current workspace. There are no vectors or provider dependencies in search.

Uploads default to 25 MiB each and cannot exceed 64 MiB. TXT and CSV inputs are capped at 4 MiB. CSV permits up to 300 rows. PDFs permit up to 250 pages. Office ZIP limits are 256 entries, 8 MiB per entry and 48 MiB expanded overall, with decompression-ratio and XML-structure checks. Extracted output is capped at 300 sections and 180,000 characters per document. The workspace permits 1,500 documents, 12,000 searchable sections, four million text characters and 2 GiB of originals. Searches return at most 50 results. The volume guard limits combined originals and extracted artifacts across namespaces to 3 GiB and reserves 256 MiB of filesystem space before object writes. The app, speech, Office and parsers share a two-CPU, 3 GiB Docker budget with one queued worker lane for native jobs.

## Assistant execution

The inference gateway sends the fixed v1 routing prompt, one user message and the generated ten-tool action profile plus two control functions. It validates a single native function response with validators compiled from the registry. Routing and writing use independent profile snapshots. Only an explicitly selected writer can receive bounded excerpts from a source selected for that turn. Model-only and comparison requests write inference evaluation records without executing tools.

Strict mutation planning requires an attested response and produces a pending approval. The claim transaction uses a unique idempotency key and records the executing state before any effect. Document drafts reuse the document staging and reconciliation pipeline. Task inserts or draft inserts commit in the same transaction as the final execution status. The execution path checks the current profile, schema and database generation before claiming the proposal. See the precise wire protocol and approval behavior. [Agent contract](agent-contract.md)

## Persistent paths

| Path | Purpose |
| --- | --- |
| `/app/data/config` | Account, key material and encrypted runtime settings |
| `/app/data/files` | Immutable uploaded originals by database installation |
| `/app/data/artifacts` | Generated extraction artifacts by database installation |
| `/app/data/tmp` | Temporary processing data |
| `/app/data/models` | Native model assets in future phases |

Directories use mode 0700. Bootstrap files use mode 0600. Local npm commands use the same layout under the repository's ignored `data/` directory.

## Planned processing stack

Future document rendering can use Mammoth for richer DOCX output. LibreOffice headless will handle office conversion and PDFKit will generate PDFs. Recharts will render comparative results. FFmpeg will preprocess audio for whisper.cpp and Piper will handle local synthesis.
