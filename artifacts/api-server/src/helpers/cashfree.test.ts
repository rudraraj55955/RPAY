import { describe, it, afterEach } from "node:test";
import assert from "node:assert/strict";
import { cashfreeCreateOrder, resolveCashfreeBaseUrl } from "./cashfree";

describe("resolveCashfreeBaseUrl", () => {
  it("returns the sandbox base URL for test env", () => {
    assert.equal(resolveCashfreeBaseUrl("test"), "https://sandbox.cashfree.com/pg");
  });

  it("returns the prod base URL for live env", () => {
    assert.equal(resolveCashfreeBaseUrl("live"), "https://api.cashfree.com/pg");
  });

  it("prefers an admin-configured override when present", () => {
    assert.equal(
      resolveCashfreeBaseUrl("live", "https://custom.example.com/pg/"),
      "https://custom.example.com/pg",
    );
  });
});

describe("cashfreeCreateOrder", () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("surfaces the raw HTTP status alongside the parsed body", async () => {
    global.fetch = (async () =>
      new Response(JSON.stringify({ payment_session_id: "abc" }), { status: 200 })) as any;

    const result = await cashfreeCreateOrder("client_id", "client_secret", "test", {
      order_id: "order_1",
      order_amount: 10,
      order_currency: "INR",
      customer_details: { customer_id: "c1", customer_phone: "9999999999" },
    });

    assert.equal(result.status, 200);
    assert.equal(result.parsed.payment_session_id, "abc");
  });

  it("surfaces a non-200 status without throwing, for diagnostic use", async () => {
    global.fetch = (async () =>
      new Response(JSON.stringify({ message: "Authentication failed" }), { status: 401 })) as any;

    const result = await cashfreeCreateOrder("bad_id", "bad_secret", "live", {
      order_id: "order_2",
      order_amount: 5,
      order_currency: "INR",
      customer_details: { customer_id: "c2", customer_phone: "9999999999" },
    });

    assert.equal(result.status, 401);
    assert.equal(result.parsed.message, "Authentication failed");
  });
});
