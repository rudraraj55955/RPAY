import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { db } from "@workspace/db";
import { insertPayinOrderWithFallback } from "./payinOrderInsert";

type LogCall = { level: "info" | "error" | "warn"; payload: any; msg: string };

function makeMockLog() {
  const calls: LogCall[] = [];
  return {
    calls,
    log: {
      info: (payload: any, msg: string) => calls.push({ level: "info", payload, msg }),
      error: (payload: any, msg: string) => calls.push({ level: "error", payload, msg }),
      warn: (payload: any, msg: string) => calls.push({ level: "warn", payload, msg }),
    } as any,
  };
}

const baseInput = {
  merchantId: 42,
  publicOrderId: "RKPAYIN_42_123",
  cashfreeOrderId: "cf_order_123",
  paymentSessionId: "session_abc",
  amount: "100.00",
  customerPhone: "9876543210",
  customerEmail: "merchant@example.com" as string | null,
  rawPayload: "{}",
};

describe("insertPayinOrderWithFallback", () => {
  const originalInsert = db.insert.bind(db);

  afterEach(() => {
    (db as any).insert = originalInsert;
  });

  it("succeeds on the full insert without needing a retry", async () => {
    (db as any).insert = () => ({
      values: () => ({ onConflictDoNothing: async () => {} }),
    });
    const { log, calls } = makeMockLog();

    const result = await insertPayinOrderWithFallback(baseInput, log);

    assert.deepEqual(result, { ok: true, mode: "full" });
    assert.ok(calls.some((c) => c.payload.event === "payin_db_insert_started"));
    assert.ok(!calls.some((c) => c.payload.event === "payin_db_insert_minimal_retry_started"));
  });

  it("falls back to a minimal insert when the full insert fails, and logs sanitized db error fields", async () => {
    let callCount = 0;
    (db as any).insert = () => ({
      values: (vals: any) => ({
        onConflictDoNothing: async () => {
          callCount += 1;
          if (callCount === 1) {
            const err: any = new Error("column \"payment_method\" does not exist");
            err.code = "42703";
            err.column = "payment_method";
            err.table = "cashfree_payment_orders";
            throw err;
          }
          // Minimal retry succeeds.
          assert.equal(vals.paymentMethod, undefined, "minimal retry must not include paymentMethod");
          assert.equal(vals.rawPayload, undefined, "minimal retry must not include rawPayload");
        },
      }),
    });
    const { log, calls } = makeMockLog();

    const result = await insertPayinOrderWithFallback(baseInput, log);

    assert.deepEqual(result, { ok: true, mode: "minimal" });

    const failedLog = calls.find((c) => c.payload.event === "payin_db_insert_failed");
    assert.ok(failedLog, "expected a payin_db_insert_failed log");
    assert.equal(failedLog!.payload.safeDbCode, "42703");
    assert.equal(failedLog!.payload.safeColumn, "payment_method");
    assert.equal(failedLog!.payload.message, undefined);

    assert.ok(calls.some((c) => c.payload.event === "payin_db_insert_minimal_retry_started"));
    assert.ok(calls.some((c) => c.payload.event === "payin_db_insert_minimal_retry_success"));
  });

  it("returns ok:false and logs a sanitized failure if the minimal retry also fails", async () => {
    (db as any).insert = () => ({
      values: () => ({
        onConflictDoNothing: async () => {
          const err: any = new Error("relation \"cashfree_payment_orders\" does not exist");
          err.code = "42P01";
          err.table = "cashfree_payment_orders";
          throw err;
        },
      }),
    });
    const { log, calls } = makeMockLog();

    const result = await insertPayinOrderWithFallback(baseInput, log);

    assert.deepEqual(result, { ok: false });
    const minimalFailedLog = calls.find((c) => c.payload.event === "payin_db_insert_minimal_retry_failed");
    assert.ok(minimalFailedLog);
    assert.equal(minimalFailedLog!.payload.safeDbCode, "42P01");
    assert.equal(minimalFailedLog!.payload.message, undefined);
    assert.equal(minimalFailedLog!.payload.detail, undefined);
  });

  it("never logs the raw payload or payment session id in any log call", async () => {
    (db as any).insert = () => ({
      values: () => ({
        onConflictDoNothing: async () => {
          throw new Error("boom");
        },
      }),
    });
    const { log, calls } = makeMockLog();

    await insertPayinOrderWithFallback(baseInput, log);

    const serialized = JSON.stringify(calls);
    assert.equal(serialized.includes(baseInput.rawPayload === "{}" ? "__never__" : baseInput.rawPayload), false);
    assert.equal(serialized.includes(baseInput.paymentSessionId), false);
  });
});
