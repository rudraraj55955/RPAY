import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { db } from "@workspace/db";
import { ensureSchemaGuard, resetSchemaGuardCacheForTests } from "./schemaGuard";

/** Renders a drizzle `sql` template object to plain text for assertions. */
function renderSqlLike(node: any, seen = new Set<any>()): string {
  if (node == null) return "";
  if (typeof node === "string") return node;
  if (typeof node !== "object") return String(node);
  if (seen.has(node)) return "";
  seen.add(node);
  if (Array.isArray(node)) return node.map((n) => renderSqlLike(n, seen)).join(" ");
  if (Array.isArray(node.queryChunks)) return renderSqlLike(node.queryChunks, seen);
  if (typeof node.value === "string") return node.value;
  if (Array.isArray(node.value)) return renderSqlLike(node.value, seen);
  return "";
}

describe("ensureSchemaGuard", () => {
  const originalExecute = db.execute.bind(db);
  let calls: string[];

  beforeEach(() => {
    calls = [];
    resetSchemaGuardCacheForTests();
  });

  afterEach(() => {
    (db as any).execute = originalExecute;
    resetSchemaGuardCacheForTests();
  });

  function mockExecute(impl: (sqlText: string) => void | Promise<void>) {
    (db as any).execute = async (query: any) => {
      const sqlText = renderSqlLike(query);
      calls.push(sqlText);
      await impl(sqlText);
      return { rows: [] };
    };
  }

  it("adds users.is_super_admin idempotently", async () => {
    mockExecute(() => {});
    await ensureSchemaGuard();
    const call = calls.find((c) => /ADD COLUMN IF NOT EXISTS/i.test(c) && /is_super_admin/i.test(c) && /users/i.test(c));
    assert.ok(call, "expected an ADD COLUMN IF NOT EXISTS statement for users.is_super_admin");
  });

  it("creates company_settings and seeds the default row when empty", async () => {
    mockExecute(() => {});
    await ensureSchemaGuard();
    const createCall = calls.find((c) => /CREATE TABLE IF NOT EXISTS/i.test(c) && /company_settings/i.test(c));
    assert.ok(createCall, "expected a CREATE TABLE IF NOT EXISTS statement for company_settings");
    assert.match(createCall!, /Nickey Collection Private Limited/);

    const seedCall = calls.find((c) => /INSERT INTO company_settings/i.test(c));
    assert.ok(seedCall, "expected a default-row INSERT for company_settings");
    assert.match(seedCall!, /WHERE NOT EXISTS/i);
  });

  it("creates merchant_auth_otps with its supporting indexes", async () => {
    mockExecute(() => {});
    await ensureSchemaGuard();
    const createCall = calls.find((c) => /CREATE TABLE IF NOT EXISTS/i.test(c) && /merchant_auth_otps/i.test(c));
    assert.ok(createCall, "expected a CREATE TABLE IF NOT EXISTS statement for merchant_auth_otps");

    const indexCalls = calls.filter((c) => /CREATE INDEX IF NOT EXISTS/i.test(c) && /merchant_auth_otps/i.test(c));
    assert.ok(indexCalls.length >= 4, "expected at least 4 supporting indexes for merchant_auth_otps");
  });

  it("adds every UPI Gateways provider_integrations column", async () => {
    mockExecute(() => {});
    await ensureSchemaGuard();
    const requiredColumns = [
      "is_custom",
      "api_key_encrypted",
      "api_secret_encrypted",
      "webhook_secret_encrypted",
      "api_base_url",
      "min_amount",
      "max_amount",
      "daily_limit",
    ];
    for (const col of requiredColumns) {
      const call = calls.find((c) => /ADD COLUMN IF NOT EXISTS/i.test(c) && new RegExp(`\\b${col}\\b`, "i").test(c));
      assert.ok(call, `expected an ADD COLUMN IF NOT EXISTS statement for ${col}`);
    }
  });

  it("creates the routing safety-net tables (providers, provider_visibility, routing_configs, routing_rules)", async () => {
    mockExecute(() => {});
    await ensureSchemaGuard();
    for (const table of ["providers", "provider_visibility", "routing_configs", "routing_rules"]) {
      const call = calls.find((c) => /CREATE TABLE IF NOT EXISTS/i.test(c) && new RegExp(`\\b${table}\\b`, "i").test(c));
      assert.ok(call, `expected a CREATE TABLE IF NOT EXISTS statement for ${table}`);
    }
  });

  it("adds every quiet_hours_queue column required by helpers/quietHours.ts", async () => {
    mockExecute(() => {});
    await ensureSchemaGuard();
    const createCall = calls.find((c) => /CREATE TABLE IF NOT EXISTS/i.test(c) && /quiet_hours_queue/i.test(c));
    assert.ok(createCall, "expected a CREATE TABLE IF NOT EXISTS statement for quiet_hours_queue");

    const requiredColumns = ["to", "deliver_after", "flushed", "flushed_at", "created_at"];
    for (const col of requiredColumns) {
      const call = calls.find(
        (c) =>
          /ADD COLUMN IF NOT EXISTS/i.test(c) &&
          /quiet_hours_queue/i.test(c) &&
          new RegExp(`\\b${col}\\b`, "i").test(c)
      );
      assert.ok(call, `expected an ADD COLUMN IF NOT EXISTS statement for quiet_hours_queue.${col}`);
    }

    const indexCall = calls.find((c) => /CREATE INDEX IF NOT EXISTS/i.test(c) && /flushed/i.test(c) && /deliver_after/i.test(c));
    assert.ok(indexCall, "expected a supporting index on (flushed, deliver_after)");
  });

  it("only runs the guard once per process (cached)", async () => {
    mockExecute(() => {});
    await ensureSchemaGuard();
    const firstRunCount = calls.length;
    await ensureSchemaGuard();
    await ensureSchemaGuard();
    assert.equal(calls.length, firstRunCount, "guard should not re-run once cached");
  });

  it("resets the cache on failure so a later call can retry", async () => {
    let shouldFail = true;
    mockExecute(() => {
      if (shouldFail) throw new Error("transient db error");
    });

    await assert.rejects(() => ensureSchemaGuard());

    shouldFail = false;
    await assert.doesNotReject(() => ensureSchemaGuard());
  });
});
