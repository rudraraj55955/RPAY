import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { isValidHttpsUrl, sanitizeDiagnosticMessage, sanitizeSubCode, sanitizeDbError } from "./payinDiagnosticSanitize";

describe("isValidHttpsUrl", () => {
  it("accepts a well-formed https URL", () => {
    assert.equal(isValidHttpsUrl("https://api.cashfree.com/pg"), true);
  });

  it("rejects http (non-tls)", () => {
    assert.equal(isValidHttpsUrl("http://api.cashfree.com/pg"), false);
  });

  it("rejects empty/undefined/null", () => {
    assert.equal(isValidHttpsUrl(""), false);
    assert.equal(isValidHttpsUrl(undefined), false);
    assert.equal(isValidHttpsUrl(null), false);
  });

  it("rejects malformed strings", () => {
    assert.equal(isValidHttpsUrl("not a url"), false);
  });
});

describe("sanitizeDiagnosticMessage", () => {
  it("returns null for empty/blank input", () => {
    assert.equal(sanitizeDiagnosticMessage(null), null);
    assert.equal(sanitizeDiagnosticMessage(undefined), null);
    assert.equal(sanitizeDiagnosticMessage("   "), null);
  });

  it("redacts a client id or secret appearing verbatim in the message", () => {
    const clientId = "CF_CLIENT_ID_ABC123";
    const secret = "cfsk_super_secret_xyz";
    const msg = `Authentication failed for client_id=${clientId} using secret ${secret}`;
    const safe = sanitizeDiagnosticMessage(msg, [clientId, secret]);
    assert.ok(safe);
    assert.equal(safe!.includes(clientId), false);
    assert.equal(safe!.includes(secret), false);
    assert.match(safe!, /\[REDACTED\]/);
  });

  it("truncates long messages to 300 chars", () => {
    const long = "x".repeat(1000);
    const safe = sanitizeDiagnosticMessage(long);
    assert.ok(safe);
    assert.ok(safe!.length <= 301);
  });

  it("never leaks a payment_session_id-shaped token if passed as a secret", () => {
    const sessionId = "session_abcdef123456";
    const msg = `Order created with payment_session_id=${sessionId}`;
    const safe = sanitizeDiagnosticMessage(msg, [sessionId]);
    assert.equal(safe!.includes(sessionId), false);
  });
});

describe("sanitizeSubCode", () => {
  it("passes through a short string sub-code", () => {
    assert.equal(sanitizeSubCode("authentication_failed"), "authentication_failed");
  });

  it("returns null for non-string input", () => {
    assert.equal(sanitizeSubCode(undefined), null);
    assert.equal(sanitizeSubCode(null), null);
    assert.equal(sanitizeSubCode(12345), null);
  });

  it("truncates overly long sub-codes", () => {
    const long = "a".repeat(500);
    const safe = sanitizeSubCode(long);
    assert.equal(safe!.length, 100);
  });
});

describe("sanitizeDbError", () => {
  it("extracts only code/table/column/constraint from a pg-style error", () => {
    const pgErr = {
      code: "23502",
      table: "cashfree_payment_orders",
      column: "customer_phone",
      constraint: null,
      message: "null value in column \"customer_phone\" violates not-null constraint",
      detail: "Failing row contains (1, 42, RKPAYIN_42_123, 9876543210, ...).",
    };
    const safe = sanitizeDbError(pgErr);
    assert.deepEqual(safe, {
      safeDbCode: "23502",
      safeTable: "cashfree_payment_orders",
      safeColumn: "customer_phone",
      safeConstraint: null,
    });
  });

  it("never leaks message or detail even if present on the error object", () => {
    const pgErr = {
      code: "23505",
      constraint: "cashfree_payment_orders_cashfree_order_id_unique",
      message: "duplicate key value violates unique constraint containing secret_token_ABC123",
      detail: "Key (cashfree_order_id)=(secret_token_ABC123) already exists.",
    };
    const safe = sanitizeDbError(pgErr) as any;
    assert.equal(safe.message, undefined);
    assert.equal(safe.detail, undefined);
    assert.equal(JSON.stringify(safe).includes("secret_token_ABC123"), false);
  });

  it("returns all-null fields for a non-pg error (e.g. a plain Error or thrown string)", () => {
    assert.deepEqual(sanitizeDbError(new Error("boom")), {
      safeDbCode: null,
      safeTable: null,
      safeColumn: null,
      safeConstraint: null,
    });
    assert.deepEqual(sanitizeDbError(null), {
      safeDbCode: null,
      safeTable: null,
      safeColumn: null,
      safeConstraint: null,
    });
    assert.deepEqual(sanitizeDbError(undefined), {
      safeDbCode: null,
      safeTable: null,
      safeColumn: null,
      safeConstraint: null,
    });
  });

  it("truncates overly long identifier fields", () => {
    const safe = sanitizeDbError({ code: "x".repeat(500) });
    assert.equal(safe.safeDbCode!.length, 100);
  });
});
