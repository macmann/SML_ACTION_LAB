# Product specification

SLM Action Lab is a single-admin workspace for working with documents and productivity records. A fresh instance opens the first-run wizard. The person with app container access retrieves the pairing code, claims the instance, and reaches the workspace. Subsequent visits require admin sign-in.

| Section | Phase 1 | Planned scope |
| --- | --- | --- |
| Assistant | Opens a status page | Provider-backed requests and document actions |
| Documents | Opens a status page | Import, conversion, local text search, and exports |
| Tasks / Notes | Opens a status page | Persisted notes and task tracking |
| Invoices | Opens a status page | Invoice records and generated documents |
| Model Arena | Opens a status page | Administrator-selected model comparisons |
| Logs | Opens a status page | Application activity history |
| Settings | Shows administrator and service status | Runtime PostgreSQL and model provider configuration |

Navigation adapts to the viewport and supports keyboard access. The workspace follows the operating system's light or dark preference. Pending and rejected authentication submissions provide visible feedback.
