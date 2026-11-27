# Product specification

SLM Action Lab is a single-admin workspace for working with documents and productivity records. A fresh instance opens the first-run wizard. The operator generates a short-lived pairing token at the container console. The administrator uses it to claim the instance, tests a PostgreSQL connection, then configures Distil or explicitly continues in manual mode. Interrupted setup resumes in Settings after sign-in.

| Section | Current behavior | Planned scope |
| --- | --- | --- |
| Assistant | Native tool routing, deterministic document actions, writer drafts, and explicit approvals | Persistent multi-turn conversations and broader action catalog |
| Documents | Private multi-file uploads, extracted previews, downloads, active attachments, deletion, and local BM25+ search | Rich previews, generated exports, and additional conversion workflows |
| Tasks / Notes | Manual task and note CRUD, evidence-backed task proposals, and task report exports | Additional task workflow integrations |
| Invoices | Verified records, status transitions, expenses, reports, and individually approved copy, draft and follow-up steps | Broader accounting integrations |
| Model Arena | Opens a status page | Administrator-selected model comparisons |
| Logs | Redacted inference, validation, identity, execution and timing history | Broader application activity history |
| Settings | Tests and stores PostgreSQL and provider settings, rotates credentials, and saves processing preferences | Applies those settings to document, speech, and provider workflows |

Navigation adapts to the viewport and supports keyboard access. The workspace follows the operating system's light or dark preference. Pending and rejected authentication submissions provide visible feedback.

### Local speech and Model Arena

The optional speech build records up to 60 seconds in the browser, processes the audio locally, and requires review before text enters the assistant. Read-aloud uses the installed English voice. Typed chat remains available without native tools or model files. [Speech](speech.md)

Model Arena evaluates the versioned ten-action router and two control responses against a locked fictional holdout. A separate generation mode evaluates drafts with human review. The Arena records attribution, failures and denominators and exports results as JSON or CSV. Distil export files remain candidates pending vendor verification. [Model Arena](model-arena.md)
