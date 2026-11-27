import { createHash, randomUUID } from "node:crypto";
import pg from "pg";
import { store } from "./bootstrap.mjs";
import { settingsFrom } from "./settings";
import { databaseConnectionOptions } from "./probes";
import { migrations } from "./schema";

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
      if ((error as { code?: string }).code === "42P01" || (error as { code?: string }).code === "3F000") {
        throw new WorkspaceError("Run the workspace migrations in Settings first.", 503);
      }
      throw new WorkspaceError("PostgreSQL is unavailable or the operation failed. Check Settings and retry.", 503);
    }
  });
}

const checksum = (sql: string) => createHash("sha256").update(sql).digest("hex");
type Applied = { version: number; checksum: string };
function verifyLedger(rows: Applied[]) {
  if (rows.some((row, i) => migrations[i]?.version !== row.version ||
      checksum(migrations[i].sql) !== row.checksum)) {
    throw new WorkspaceError("The workspace migration ledger is incompatible. Restore a matching database backup.", 503);
  }
}

async function ledger(client: pg.Pool | pg.PoolClient) {
  const { rows } = await client.query<Applied>("SELECT version, checksum FROM slm_workspace.schema_migrations ORDER BY version");
  verifyLedger(rows);
  return rows.length;
}

export async function migrateWorkspace() {
  return withDatabase(async (pool) => {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT pg_advisory_xact_lock(1936485681, 841302)");
      const { rows: [role] } = await client.query<{ elevated: boolean; database: string }>(`
        SELECT current_database() AS database,
          (rolsuper OR rolcreatedb OR rolcreaterole OR rolreplication OR rolbypassrls OR
           pg_has_role(current_user, 'pg_read_all_data', 'MEMBER') OR
           pg_has_role(current_user, 'pg_write_all_data', 'MEMBER'))
          AS elevated FROM pg_roles WHERE rolname = current_user
      `);
      if (!role || role.elevated || ["postgres", "template0", "template1"].includes(role.database)) {
        throw new WorkspaceError("Use a dedicated database and a restricted login role before running migrations.");
      }
      await client.query("CREATE SCHEMA IF NOT EXISTS slm_workspace");
      await client.query(`CREATE TABLE IF NOT EXISTS slm_workspace.schema_migrations (
        version integer PRIMARY KEY, checksum text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now()
      )`);
      const applied = await ledger(client);
      for (const migration of migrations.slice(applied)) {
        await client.query(migration.sql);
        await client.query("INSERT INTO slm_workspace.installation (id) VALUES ($1) ON CONFLICT (singleton) DO NOTHING", [randomUUID()]);
        await client.query("INSERT INTO slm_workspace.schema_migrations (version, checksum) VALUES ($1, $2)", [migration.version, checksum(migration.sql)]);
      }
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK").catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  });
}

export async function workspaceId(pool: pg.Pool) {
  if (await ledger(pool) !== migrations.length) throw new WorkspaceError("Run the workspace migrations in Settings first.", 503);
  const { rows: [row] } = await pool.query<{ id: string }>("SELECT id FROM slm_workspace.installation WHERE singleton");
  if (!row) throw new WorkspaceError("The workspace has no installation record.", 503);
  return row.id;
}
