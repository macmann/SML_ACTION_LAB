import assert from "node:assert/strict";
import { test } from "node:test";
import { hasMigrationRegistry, migrations } from "../lib/schema.ts";

test("migration readiness requires the complete bundled release registry", () => {
  assert.equal(hasMigrationRegistry(migrations), true);
  assert.equal(hasMigrationRegistry([]), false);
  assert.equal(hasMigrationRegistry(migrations.slice(0, -1)), false);
  assert.equal(hasMigrationRegistry(migrations.map((entry, i) => i === 0 ? { ...entry, sql: "" } : entry)), false);
});
