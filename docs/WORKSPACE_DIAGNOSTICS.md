# Assistant readiness and migration investigation

## Confirmed root cause and evidence

The old Settings banner reported saved configuration. The Assistant required a successfully loaded context from `GET /api/agent`. That context checked the PostgreSQL migration ledger before returning approvals. A saved database URL and a verified Distil endpoint therefore could display “Setup complete with a configured provider” while the Assistant was blocked before it made a provider request.

The old migration warning covered several conditions. `workspaceId` emitted it for a short migration ledger, and the database wrapper converted both PostgreSQL missing-relation and invalid-schema errors into the same warning. The migration button returned a fixed success string after the operation resolved. It had no schema verification, durable attempt record, or cache invalidation in that branch. Failed database operations could show a generic error, and navigation discarded the action result. Assistant context refreshed when the component mounted or after a successful turn. There was no focus refresh or readiness retry.

The actual VPS migration failure remains undetermined. Neither an independently successful chat completion nor an encrypted saved database URL proves that the configured PostgreSQL login can migrate the selected database. The production-image integration uses disposable PostgreSQL to reproduce a connected database with no ledger, an elevated login rejected by the app, and an unprivileged login denied the CREATE prerequisite. These are separate hypotheses for the VPS until its sanitized diagnostics establish which applies. A mismatched database target, inconsistent ledger or missing relation, transient lock, and network/TLS failure are also distinguished by the new checks. A successful database connection probe alone cannot settle these questions.

## Source trace

| Surface | Execution path and readiness |
| --- | --- |
| Assistant page | `AssistantPage` reads saved provider preferences. `AssistantWorkspace.refresh` requests `GET /api/agent`. `agentContext` calls `approvalList`, which checks the workspace schema before reading approvals. The context also fetches attachments and the selected provider's local configuration eligibility. `Run turn` requires a loaded context, a configured and enabled provider for the selected mode, a nonblank request, and no in-flight turn. Model-only mode still writes an inference audit row. |
| Migration form | The Database and Diagnostics tabs submit `operation=migrate`, the current settings revision, and `dedicated=on` through `SettingsForm`. `updateSettings` checks origin, administrator session, revision, and confirmation before calling `migrateWorkspace` for that database generation. |
| Documents | `useDocuments` obtains the configured pool and calls `workspaceId` through index initialization. The document query, extraction, disk and index checks are additional prerequisites. |
| Tasks, Notes, Invoices and Model Arena | `businessDb` checks the same workspace schema. Arena then checks its case fixture and provider configuration for evaluation. |
| Settings and public health | Settings is available independently of PostgreSQL. Its banner identifies saved configuration and links to live Diagnostics. Public liveness is process health. Public readiness retains its saved setup-stage contract so a database outage does not restart the container. |
| Database configuration | `updateSettings` tests the candidate through `databaseConnectionOptions` and saves it in the encrypted bootstrap document. `configuredPool` decrypts the same saved envelope for both migrations and runtime queries. The app uses `pg` and no database URL environment variable. The connection sets `search_path=pg_catalog`; application SQL explicitly qualifies `slm_workspace`. The pool is keyed by configuration generation and closes on a database switch. |
| Image and persistence | `lib/schema.ts` contains the SQL registry used by the standalone Next.js server. There are no separately loaded SQL files or PostgreSQL CLI dependencies in the app image. The registry check enforces the sequence required by the release. The volume retains encrypted bootstrap settings and master/session keys across container replacement. PostgreSQL retains the checksum ledger and installation record. |

[Assistant component](../components/assistant-workspace.tsx) · [Server action](../app/settings-actions.ts) · [Database runtime](../lib/database.ts) · [SQL registry](../lib/schema.ts) · [Diagnostics implementation](../lib/diagnostics.ts)

## Changes

- Migration execution remains serialized and transactional, with the existing PostgreSQL advisory lock. It verifies the selected generation, restricted role, schema grants, and checksum ledger. It only issues schema creation when the schema is absent. It validates the expected table inventory and installation record before committing. An already complete schema returns **No pending migrations**. No historical SQL body, checksum format, table or data was changed.
- Migration responses name the failing stage and a safe error summary. Success includes applied count, remaining count, verified table count, and duration. Settings shows progress while the action is pending, and operations history records started, completed, no-op and failed events with a correlation ID. Revalidation and another live read refresh the workspace after migration.
- Assistant clears stale context on a failed refresh, refreshes on focus and visibility changes, and provides a direct retry and diagnostics link. It checks the provider's locally stored eligibility. A prior remote failure is shown in Diagnostics and remains retryable. It is not treated as a permanent lockout.
- Diagnostics exposes read-only database connectivity and schema checks, provider policy and observations, speech dependencies, storage permissions and capacity, and runtime metadata. It runs no inference requests by default. Provider capability is based on successful observations. A working endpoint and an attested routing identity are separate. Operations events are stored in a bounded, private rotating local journal, independent of PostgreSQL. Existing inference and tool logs remain available for detailed audit.
- Diagnostics exports include the database name and login for target verification. They omit connection URLs, keys, authorization headers, provider response bodies, and document content. Share the report only with an authorized operator.

## Operator procedure after deployment

1. Deploy the reviewed revision using the existing Coolify Compose settings and volume. Preserve the database and back it up before migrations.
2. In **Settings → Diagnostics**, select **Test database connection**. Check the reported database name and login against the intended dedicated PostgreSQL database. `pg_catalog` as the current schema is expected. The workspace schema is checked separately.
3. Select **Check migration status**. If permissions or the restricted-role check fails, provision an appropriately restricted login and correct the indicated grants or ownership. Keep the ledger and tables intact. If the reported target is wrong, correct the URL on the Database tab before running migrations.
4. If migrations are pending, confirm the database and select **Run pending migrations**. Review the actual result and refreshed checks. A current ledger with missing tables or an incompatible checksum history calls for backup or release reconciliation. Re-running migrations cannot repair that safely.
5. Return to the Assistant and select **Distil model only**. Enter a request. The button becomes available when the database context and selected provider prerequisites pass. Use **Check readiness again** if the page was already open in another tab.
6. If the issue persists, export the sanitized JSON and note the last migration correlation ID. **Logs → Application events** shows the recorded attempt. Use the Model providers tab for a consented provider probe when the report has no recent successful observation.

[Coolify deployment and recovery](COOLIFY.md) · [Provider modes and attestation](agent-contract.md)

## Verification and limits

Lint, type checking, contract verification, Compose validation, and all 29 unit tests passed. The production Docker image built and booted with an empty volume and no application environment settings. The complete Docker integration suite exited 0 with real disposable PostgreSQL 17 and a local HTTPS provider fixture. It verified failure reporting for elevated and insufficient-privilege database logins, database selection, missing and completed schema, all five applied versions, a no-op rerun, restart and backup persistence, provider and database outages, and refusal of an inaccessible volume. Chromium checked the blocked and enabled Assistant and the diagnostics link. A temporary fault injected into the browser context request verified focus-driven readiness recovery. The build used a temporary Cloud npm CA mount and the workspace used only fictional test data.

The image ID, exact commands and test caveats are recorded in implementation status. Live Coolify and the currently deployed PostgreSQL login were outside this test run. Git commit and build timestamp may be supplied through optional deployment metadata (`SLM_BUILD_COMMIT` and `SLM_BUILD_TIMESTAMP`). Hosted provider capability and fine-tuned identity remain unknown until observed. [Implementation status](IMPLEMENTATION_STATUS.md)

## PostgreSQL 18.7 permission inspection follow-up

The original `databaseIdentity` query collapsed seven role checks into one `elevated` result:

```sql
(rolsuper OR rolcreatedb OR rolcreaterole OR rolreplication OR rolbypassrls OR
  pg_has_role(current_user, 'pg_read_all_data', 'MEMBER') OR
  pg_has_role(current_user, 'pg_write_all_data', 'MEMBER')) AS elevated
```

`migrateWorkspace` used that result in the same rejection branch as a missing catalog row or a reserved database name (`postgres`, `template0`, `template1`). The reported text came from this application policy branch. The error handler could not identify which predicate failed. An SQL exception in the catalog query followed a different path.

I ran the original SQL on a disposable PostgreSQL 18.7 server with the dedicated database `OFFGRID` owned by restricted login `offgrid_app`. It returned `elevated = false`. The literal owner of `public` was `pg_database_owner`, while `pg_has_role(..., 'USAGE')` and effective `CREATE` on `public` both returned true. Granting either broad-data membership separately changed the original result to `elevated = true` without changing the five role attributes. The production evidence establishes connectivity and those five attributes. It does not establish either broad membership result or the app's selected target at the failed attempt. The exact predicate on the VPS therefore remains unconfirmed. PostgreSQL 18.7 syntax and special public ownership did not reproduce a rejection by themselves.

Permission inspection now lists each predicate and its expected and actual value. Special public ownership is informational. Required DDL is evaluated against the dedicated database or `slm_workspace`, depending on whether the workspace schema exists and whether migrations remain pending. Both broad memberships are still rejected. SQL execution failures and policy denials are classified separately. Query failures retain the stage, query identifier, SQLSTATE, duration, and a controlled error summary. The app omits raw driver messages because they can contain private details.

Connection testing and runtime pooling both use `databaseConnectionOptions` and the saved URL's TLS mode. A successful save increments the generation on credential or URL changes and closes the old pool. Migration, permission inspection and Diagnostics use the same configured pool and verify the generation. The runtime uses `search_path=pg_catalog`, so its `current_schema()` differs from a standalone PostgreSQL session with the normal `public` default. The workspace catalog checks use the explicit `slm_workspace` schema. [Database implementation](../lib/database.ts) · [Permission diagnostics](../lib/diagnostics.ts)

After deploying this revision, compare the target database and login and inspect the individual **Database connectivity** predicates under **Settings → Diagnostics**. If the report identifies a broad membership, use a dedicated restricted login without that membership or have the database administrator review the grant. Make any grant change through the database's normal change process. If the report shows a SQL failure, use its query identifier and SQLSTATE. Keep the existing database and volume, then run pending migrations after correcting the reported cause.
