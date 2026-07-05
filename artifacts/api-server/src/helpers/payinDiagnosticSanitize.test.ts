import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { isValidHttpsUrl, sanitizeDiagnosticMessage, sanitizeSubCode } from "./payinDiagnosticSanitize";

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
