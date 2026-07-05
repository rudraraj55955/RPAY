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
    const paidAtCall = calls.find((c) => /ADD COLUMN IF NOT EXISTS/i.test(c) && /paid_at/i.test(c));
    assert.ok(paidAtCall, "expected an ADD COLUMN IF NOT EXISTS statement for paid_at");
    assert.match(paidAtCall!, /cashfree_payment_orders/i);
  });

  it("creates the table if it does not exist, with the core NOT NULL columns", async () => {
    mockExecute(() => {});
    await ensurePayinOrdersSchemaGuard();
    const createCall = calls.find((c) => /CREATE TABLE IF NOT EXISTS/i.test(c) && /cashfree_payment_orders/i.test(c));
    assert.ok(createCall, "expected a CREATE TABLE IF NOT EXISTS statement");
    assert.match(createCall!, /merchant_id/i);
    assert.match(createCall!, /cashfree_order_id/i);
  });

  it("adds every column the deposit-order insert needs, matching payinOrderInsert.ts exactly", async () => {
    mockExecute(() => {});
    await ensurePayinOrdersSchemaGuard();
    const requiredColumns = [
      "public_order_id",
      "provider_key",
      "payment_session_id",
      "payment_method",
      "utr",
      "customer_phone",
      "customer_email",
      "raw_provider_status",
      "failure_reason",
      "paid_at",
      "raw_payload",
    ];
    for (const col of requiredColumns) {
      const call = calls.find((c) => /ADD COLUMN IF NOT EXISTS/i.test(c) && new RegExp(`\\b${col}\\b`, "i").test(c));
      assert.ok(call, `expected an ADD COLUMN IF NOT EXISTS statement for ${col}`);
    }
  });

  it("relaxes NOT NULL on optional columns so a legitimate insert can never hard-fail", async () => {
    mockExecute(() => {});
    await ensurePayinOrdersSchemaGuard();
    const dropNotNullCall = calls.find((c) => /DROP NOT NULL/i.test(c));
    assert.ok(dropNotNullCall, "expected a DROP NOT NULL statement for optional columns");
    assert.match(dropNotNullCall!, /undefined_column/i);
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
