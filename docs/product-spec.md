# Product specification

SLM Action Lab is a single-admin workspace for working with documents and productivity records. A fresh instance opens the first-run wizard. The operator generates a short-lived pairing token at the container console. The administrator uses it to claim the instance, tests a PostgreSQL connection, then configures Distil or explicitly continues in manual mode. Interrupted setup resumes in Settings after sign-in.

| Section | Current behavior | Planned scope |
| --- | --- | --- |
| Assistant | Opens a status page | Provider-backed requests and document actions |
| Documents | Opens a status page | Import, conversion, local text search, and exports |
| Tasks / Notes | Opens a status page | Persisted notes and task tracking |
| Invoices | Opens a status page | Invoice records and generated documents |
| Model Arena | Opens a status page | Administrator-selected model comparisons |
| Logs | Opens a status page | Application activity history |
| Settings | Tests and stores PostgreSQL and provider settings, rotates credentials, and saves processing preferences | Applies those settings to document, speech, and provider workflows |

Navigation adapts to the viewport and supports keyboard access. The workspace follows the operating system's light or dark preference. Pending and rejected authentication submissions provide visible feedback.
