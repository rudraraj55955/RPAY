import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { db } from "@workspace/db";
import { ensurePayinOrdersSchemaGuard, resetPayinSchemaGuardCacheForTests } from "./payinSchemaGuard";

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

describe("ensurePayinOrdersSchemaGuard", () => {
  const originalExecute = db.execute.bind(db);
  let calls: string[];

  beforeEach(() => {
    calls = [];
    resetPayinSchemaGuardCacheForTests();
  });

  afterEach(() => {
    (db as any).execute = originalExecute;
    resetPayinSchemaGuardCacheForTests();
  });

  function mockExecute(impl: (sqlText: string) => void | Promise<void>) {
    (db as any).execute = async (query: any) => {
      const sqlText = renderSqlLike(query);
      calls.push(sqlText);
      await impl(sqlText);
      return { rows: [] };
    };
  }

  it("runs an idempotent ADD COLUMN IF NOT EXISTS for paid_at", async () => {
    mockExecute(() => {});
    await ensurePayinOrdersSchemaGuard();
    const addColumnCall = calls.find((c) => /ADD COLUMN IF NOT EXISTS/i.test(c));
    assert.ok(addColumnCall, "expected an ADD COLUMN IF NOT EXISTS statement");
    assert.match(addColumnCall!, /paid_at/i);
    assert.match(addColumnCall!, /cashfree_payment_orders/i);
  });

  it("uppercases any non-uppercase status values", async () => {
    mockExecute(() => {});
    await ensurePayinOrdersSchemaGuard();
    const updateCall = calls.find((c) => /UPPER/i.test(c) && /UPDATE/i.test(c));
    assert.ok(updateCall, "expected an UPDATE ... SET status = UPPER(status) statement");
    assert.match(updateCall!, /cashfree_payment_orders/i);
  });

  it("only runs the guard once per process (cached)", async () => {
    mockExecute(() => {});
    await ensurePayinOrdersSchemaGuard();
    const firstRunCount = calls.length;
    await ensurePayinOrdersSchemaGuard();
    await ensurePayinOrdersSchemaGuard();
    assert.equal(calls.length, firstRunCount, "guard should not re-run once cached");
  });

  it("resets the cache on failure so a later call can retry", async () => {
    let shouldFail = true;
    mockExecute(() => {
      if (shouldFail) throw new Error("transient db error");
    });

    await assert.rejects(() => ensurePayinOrdersSchemaGuard());

    shouldFail = false;
    await assert.doesNotReject(() => ensurePayinOrdersSchemaGuard());
  });
});
