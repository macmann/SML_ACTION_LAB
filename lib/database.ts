import { createHash, randomUUID } from "node:crypto";
import pg from "pg";
import { store } from "./bootstrap.mjs";
import { settingsFrom } from "./settings";
import { databaseConnectionOptions } from "./probes";
import { hasMigrationRegistry, migrations, requiredSchemaVersion } from "./schema";
import { recordOperation } from "./operations.mjs";

export class WorkspaceError extends Error {
  constructor(message: string, public status = 400) { super(message); }
}

type Runtime = {
  tail: Promise<void>;
  waiting: number;
  active?: { generation: number; pool: pg.Pool };
};

const globalState = globalThis as typeof globalThis & { slmDatabase?: Runtime };
const state = globalState.slmDatabase ??= { tail: Promise.resolve(), waiting: 0 };
const changedError = "Configure PostgreSQL in Settings before opening the document workspace.";

export async function databaseLane<T>(run: () => Promise<T>): Promise<T> {
  if (state.waiting >= 12) throw new WorkspaceError("The workspace is busy. Retry shortly.", 429);
  state.waiting++;
  const task = state.tail.then(run);
  state.tail = task.then(() => {}, () => {});
  try { return await task; } finally { state.waiting--; }
}

// Call within databaseLane so an in-flight document write stays on its original database.
export async function closeDatabase() {
  const previous = state.active;
  state.active = undefined;
  if (previous) await previous.pool.end();
}

async function configuredPool() {
  const settings = settingsFrom(await store.load());
  if (!settings.database) throw new WorkspaceError(changedError, 503);
  const generation = settings.databaseGeneration ?? 1;
  if (state.active?.generation !== generation) {
    await closeDatabase();
    const options = await databaseConnectionOptions(await store.decrypt("database", settings.database));
    const pool = new pg.Pool({ ...options, max: 5, options: "-c search_path=pg_catalog", idleTimeoutMillis: 15_000, maxLifetimeSeconds: 120 });
    pool.on("error", () => { /* Idle connection failures never log credentials or block local administration. */ });
    state.active = { generation, pool };
  }
  return state.active;
}

export async function withDatabase<T>(run: (pool: pg.Pool, generation: number) => Promise<T>) {
  return databaseLane(async () => {
    try {
      const { pool, generation } = await configuredPool();
      return await run(pool, generation);
    } catch (error) {
      if (error instanceof WorkspaceError) throw error;
      throw new WorkspaceError(databaseIssue(error), 503);
    }
  });
}

const checksum = (sql: string) => createHash("sha256").update(sql).digest("hex");
type Applied = { version: number; checksum: string; applied_at: Date };
type Queryable = pg.Pool | pg.PoolClient;
export const expectedVersions = Array.from({ length: requiredSchemaVersion }, (_, i) => i + 1);
export const migrationRegistryAvailable = hasMigrationRegistry(migrations);
const requiredTables = ["schema_migrations", ...migrations.flatMap(({ sql }) =>
  Array.from(sql.matchAll(/CREATE TABLE slm_workspace\.([a-z_]+)/g), ([, table]) => table))];

export function databaseIssue(error: unknown) {
  if (error instanceof WorkspaceError) return error.message;
  const code = (error as { code?: string } | null)?.code;
  switch (code) {
    case "42501": return "PostgreSQL denied permission (42501). Check ownership and grants for the configured login.";
    case "28P01": case "28000": return "PostgreSQL rejected authentication. Check the configured login and password.";
    case "3D000": return "PostgreSQL could not find the configured database (3D000). Check the database name.";
    case "42P01": case "3F000": return "A required workspace relation is missing. Open Settings → Diagnostics to check schema status.";
    case "55P03": return "PostgreSQL could not acquire the migration lock (55P03). Retry after other work finishes.";
    case "57014": return "PostgreSQL canceled a statement (57014). Check database load and retry.";
    case "ENOTFOUND": case "EAI_AGAIN": return "The database hostname could not be resolved from the app container.";
    case "ETIMEDOUT": return "The PostgreSQL connection timed out.";
    default: return /^[0-9A-Z]{5}$/.test(code ?? "") ?
      `PostgreSQL rejected the operation (SQLSTATE ${code}). Check the database server logs.` :
      "The PostgreSQL connection or query failed. Check network access, TLS and the configured connection.";
  }
}

function invalidLedger(rows: Applied[]) {
  return rows.some((row, i) => migrations[i]?.version !== row.version || checksum(migrations[i].sql) !== row.checksum);
}

export async function inspectSchema(client: Queryable) {
  if (!migrationRegistryAvailable) throw new WorkspaceError("The release migration registry is incomplete. Rebuild the image before changing the database.", 503);
  const { rows } = await client.query<{ name: string; exists: boolean; read: boolean; write: boolean; audit: boolean }>(`
    SELECT name, c.oid IS NOT NULL AS exists,
      COALESCE(has_table_privilege(current_user, c.oid, 'SELECT'), false) AS read,
      COALESCE(has_table_privilege(current_user, c.oid, 'INSERT')
        AND has_table_privilege(current_user, c.oid, 'UPDATE')
        AND has_table_privilege(current_user, c.oid, 'DELETE'), false) AS write,
      COALESCE(has_table_privilege(current_user, c.oid, 'INSERT')
        AND has_table_privilege(current_user, c.oid, 'UPDATE'), false) AS audit
    FROM unnest($1::text[]) AS t(name)
    LEFT JOIN pg_namespace n ON n.nspname='slm_workspace'
    LEFT JOIN pg_class c ON c.relnamespace=n.oid AND c.relname=t.name AND c.relkind IN ('r','p')`, [requiredTables]);
  const missingTables = rows.filter((row) => !row.exists).map((row) => row.name);
  const inaccessibleTables = rows.filter((row) => row.exists && !row.read).map((row) => row.name);
  const writeRestrictedTables = rows.filter((row) => row.exists && !row.write).map((row) => row.name);
  const canRead = (name: string) => rows.some((row) => row.name === name && row.read);
  const applied = canRead("schema_migrations")
    ? (await client.query<Applied>("SELECT version, checksum, applied_at FROM slm_workspace.schema_migrations ORDER BY version")).rows : [];
  const installation = canRead("installation")
    ? (await client.query<{ id: string }>("SELECT id FROM slm_workspace.installation WHERE singleton")).rows[0]?.id : undefined;
  const auditWritable = rows.some((row) => row.name === "inference_logs" && row.audit);
  const ledgerCompatible = !invalidLedger(applied);
  const pending = ledgerCompatible ? expectedVersions.slice(applied.length) : null;
  return { installation, ledgerCompatible, applied: applied.map(({ version, applied_at }) => ({ version, appliedAt: applied_at })),
    pending, missingTables, inaccessibleTables, writeRestrictedTables, auditWritable,
    ready: ledgerCompatible && pending?.length === 0 && !missingTables.length && !inaccessibleTables.length &&
      Boolean(installation) };
}

export async function databaseIdentity(client: Queryable) {
  const { rows: [identity] } = await client.query<{
    database: string; username: string; schema: string | null; schemaExists: boolean; schemaUsage: boolean;
    schemaCreate: boolean; databaseCreate: boolean; elevated: boolean; schemaOwner: boolean;
  }>(`
    SELECT current_database() AS database, current_user AS username, current_schema() AS schema,
      has_database_privilege(current_user, current_database(), 'CREATE') AS "databaseCreate",
      n.oid IS NOT NULL AS "schemaExists",
      COALESCE(has_schema_privilege(current_user, n.oid, 'USAGE'), false) AS "schemaUsage",
      COALESCE(has_schema_privilege(current_user, n.oid, 'CREATE'), false) AS "schemaCreate",
      COALESCE(pg_has_role(current_user, n.nspowner, 'USAGE'), false) AS "schemaOwner",
      (rolsuper OR rolcreatedb OR rolcreaterole OR rolreplication OR rolbypassrls OR
        pg_has_role(current_user, 'pg_read_all_data', 'MEMBER') OR
        pg_has_role(current_user, 'pg_write_all_data', 'MEMBER')) AS elevated
    FROM pg_roles LEFT JOIN pg_namespace n ON n.nspname = 'slm_workspace' WHERE rolname = current_user
  `);
  return identity;
}

export function schemaBlockers(schema: Awaited<ReturnType<typeof inspectSchema>>) {
  if (!schema.ledgerCompatible) return ["Migration history conflicts with this release. Check the database target and ledger before changing anything."];
  const reasons = [];
  if (schema.inaccessibleTables.length) reasons.push("The database login cannot read: " + schema.inaccessibleTables.join(", ") + ".");
  if (schema.pending?.length) reasons.push("Pending workspace migrations: " + schema.pending.join(", ") + ".");
  if (schema.missingTables.length && !schema.pending?.length) reasons.push("The ledger is current but these tables are missing: " + schema.missingTables.join(", ") + ". Restore a consistent backup.");
  if (!schema.installation && !schema.pending?.length) reasons.push("The database is missing its workspace installation record.");
  return reasons;
}

export async function migrateWorkspace(expectedGeneration: number) {
  const started = Date.now();
  const correlationId = randomUUID();
  let stage = "Connect to the configured database";
  let targetGeneration: number | undefined;
  await recordOperation("migration", "started", { correlationId, generation: expectedGeneration });
  try {
    const result = await withDatabase(async (pool, generation) => {
      if (generation !== expectedGeneration) {
        throw new WorkspaceError("The database configuration changed before migration started. Check the target and retry.");
      }
      targetGeneration = generation;
      const client = await pool.connect();
      try {
        stage = "Acquire migration lock";
        await client.query("BEGIN");
        await client.query("SELECT pg_advisory_xact_lock(1936485681, 841302)");
        stage = "Inspect database permissions";
        const role = await databaseIdentity(client);
        if (!role || role.elevated || ["postgres", "template0", "template1"].includes(role.database)) {
          throw new WorkspaceError("Use a dedicated database and a restricted login role before running migrations.");
        }
        // Read the ledger before doing DDL so a fully migrated workspace can report a no-op.
        stage = "Read migration history";
        if (role.schemaExists && !role.schemaUsage) throw new WorkspaceError("Grant the app login USAGE on slm_workspace.");
        const before = await inspectSchema(client);
        if (!before.ledgerCompatible) throw new WorkspaceError(schemaBlockers(before)[0]);
        if (before.inaccessibleTables.includes("schema_migrations")) throw new WorkspaceError(schemaBlockers(before)[0]);
        const pending = before.pending ?? [];
        if (pending.length) {
          stage = "Prepare workspace schema";
          if (!role.schemaExists && !role.databaseCreate) throw new WorkspaceError("The app login needs CREATE on the dedicated database to initialize slm_workspace.");
          if (role.schemaExists && !role.schemaCreate) throw new WorkspaceError("The app login needs CREATE on slm_workspace for pending migrations.");
          if (!role.schemaExists) await client.query("CREATE SCHEMA slm_workspace");
          if (before.missingTables.includes("schema_migrations")) await client.query(`CREATE TABLE slm_workspace.schema_migrations (
            version integer PRIMARY KEY, checksum text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now()
          )`);
          for (const migration of migrations.slice(before.applied.length)) {
            stage = "Apply migration " + migration.version;
            await client.query(migration.sql);
            await client.query("INSERT INTO slm_workspace.installation (id) VALUES ($1) ON CONFLICT (singleton) DO NOTHING", [randomUUID()]);
            await client.query("INSERT INTO slm_workspace.schema_migrations (version, checksum) VALUES ($1, $2)", [migration.version, checksum(migration.sql)]);
          }
        }
        stage = "Verify expected schema";
        const after = await inspectSchema(client);
        if (!after.ready) throw new WorkspaceError(schemaBlockers(after).join(" "));
        stage = "Commit verified migrations";
        await client.query("COMMIT");
        return { generation, applied: pending, pending: after.pending ?? [], tablesVerified: requiredTables.length };
      } catch (error) {
        await client.query("ROLLBACK").catch(() => {});
        throw error;
      } finally {
        client.release();
      }
    });
    const durationMs = Date.now() - started;
    const status = result.applied.length ? "completed" : "no_pending";
    await recordOperation("migration", status, { ...result, durationMs, correlationId });
    return { ...result, durationMs, status };
  } catch (error) {
    const message = databaseIssue(error);
    const durationMs = Date.now() - started;
    await recordOperation("migration", "failed", { generation: targetGeneration ?? expectedGeneration, stage, error: message, durationMs, correlationId });
    throw new WorkspaceError(`${stage} failed after ${durationMs} ms. ${message}`, 503);
  }
}

export async function workspaceId(pool: pg.Pool, { requireAudit = false } = {}) {
  const schema = await inspectSchema(pool);
  if (!schema.ready || !schema.installation) throw new WorkspaceError(schemaBlockers(schema).join(" ") || "The workspace schema is unavailable.", 503);
  if (requireAudit && !schema.auditWritable) {
    throw new WorkspaceError("The database login needs INSERT and UPDATE on inference_logs to record Assistant requests.", 503);
  }
  return schema.installation;
}
