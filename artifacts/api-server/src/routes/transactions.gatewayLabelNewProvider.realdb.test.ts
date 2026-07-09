/**
 * Integration test: gateway labels stay stable when a NEW, alphabetically-
 * earlier provider is later added for a merchant (real DB, no mocks).
 *
 * Regression target: `getStableProviderToLabel` orders providers by
 * first-use date, NOT alphabetically. If a future refactor accidentally
 * switches to alphabetical ordering, a newly-added provider whose name
 * sorts earlier (e.g. "airpay" vs "cashfree") would silently steal
 * "Payment Gateway A" from the provider that was actually used first,
 * relabeling every historical transaction for the original provider.
 *
 * Scenario:
 *  1. Merchant uses "cashfree" first (Jan 2024) -> must be "Payment Gateway A".
 *  2. Merchant later starts using "airpay" (Jun 2024), which sorts before
 *     "cashfree" alphabetically -> must be "Payment Gateway B", and
 *     "cashfree" must NOT shift to "Payment Gateway B".
 *  3. Both the list endpoint (GET /api/transactions) and the detail
 *     endpoint (GET /api/transactions/:id) must agree on these labels.
 */

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { eq } from "drizzle-orm";
import {
  db,
  usersTable,
  merchantsTable,
  merchantConnectionsTable,
  transactionsTable,
} from "@workspace/db";
import { generateToken } from "../middlewares/auth";
import app from "../app";

function get(
  server: http.Server,
  path: string,
  token: string,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const addr = server.address() as { port: number };
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        hostname: "127.0.0.1",
        port: addr.port,
        path,
        method: "GET",
        headers: { Authorization: `Bearer ${token}` },
      },
      (res) => {
        let raw = "";
        res.on("data", (chunk: Buffer) => { raw += chunk.toString(); });
        res.on("end", () => {
          try {
            resolve({ status: res.statusCode!, body: JSON.parse(raw) });
          } catch {
            resolve({ status: res.statusCode!, body: { _raw: raw } });
          }
        });
      },
    );
    req.on("error", reject);
    req.end();
  });
}

function generateUtr(prefix: string): string {
  return `TESTUTR_${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 7).toUpperCase()}`;
}

describe(
  "Gateway labels stay stable when a new, alphabetically-earlier gateway is added (real DB)",
  () => {
    let server: http.Server;
    let token: string;
    let merchantId: number;
    let userId: number;
    let cashfreeConnId: number;
    let airpayConnId: number;
    let cashfreeTxId: number;
    let airpayTxId: number;

    before(async () => {
      server = http.createServer(app);
      await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));

      const email = `gwlabel-neworder-test-${Date.now()}@example.com`;
      const [merchant] = await db.insert(merchantsTable).values({
        businessName: "Gateway Label New-Provider Test Merchant",
        contactName: "Test Contact",
        email,
        phone: "9999999998",
        status: "approved",
        verificationStatus: "approved",
      }).returning();
      merchantId = merchant!.id;

      const [user] = await db.insert(usersTable).values({
        email,
        passwordHash: "not-a-real-hash",
        name: "Gateway Label New-Provider Test Merchant",
        role: "merchant",
        merchantId,
      }).returning();
      userId = user!.id;
      token = generateToken({ userId, role: "merchant" });

      // cashfree seen first (Jan 2024)...
      const [cashfreeConn] = await db.insert(merchantConnectionsTable).values({
        merchantId,
        provider: "cashfree",
        isActive: true,
      }).returning();
      cashfreeConnId = cashfreeConn!.id;

      const cashfreeDate = new Date("2024-01-01T00:00:00Z");
      const [cashfreeTx] = await db.insert(transactionsTable).values({
        merchantId,
        connectionId: cashfreeConnId,
        type: "deposit",
        status: "success",
        amount: "100.00",
        utr: generateUtr("CF"),
        createdAt: cashfreeDate,
      }).returning();
      cashfreeTxId = cashfreeTx!.id;

      // ...then "airpay" is added/used later, even though it sorts before
      // "cashfree" alphabetically.
      const [airpayConn] = await db.insert(merchantConnectionsTable).values({
        merchantId,
        provider: "airpay",
        isActive: true,
      }).returning();
      airpayConnId = airpayConn!.id;

      const airpayDate = new Date("2024-06-01T00:00:00Z");
      const [airpayTx] = await db.insert(transactionsTable).values({
        merchantId,
        connectionId: airpayConnId,
        type: "deposit",
        status: "success",
        amount: "200.00",
        utr: generateUtr("AP"),
        createdAt: airpayDate,
      }).returning();
      airpayTxId = airpayTx!.id;
    });

    after(async () => {
      await db.delete(transactionsTable).where(eq(transactionsTable.merchantId, merchantId));
      await db.delete(merchantConnectionsTable).where(eq(merchantConnectionsTable.merchantId, merchantId));
      await db.delete(usersTable).where(eq(usersTable.id, userId));
      await db.delete(merchantsTable).where(eq(merchantsTable.id, merchantId));
      await new Promise<void>((resolve) => server.close(() => resolve()));
    });

    it("GET /api/transactions: cashfree (first-used) stays 'Payment Gateway A' and airpay (added later, sorts first) is 'Payment Gateway B'", async () => {
      const res = await get(server, "/api/transactions?limit=20", token);
      assert.equal(res.status, 200, JSON.stringify(res.body));
      const data = res.body["data"] as Array<{ utr: string; [k: string]: unknown }>;

      const cashfreeTx = data.find((tx) => tx.utr.includes("_CF_"));
      const airpayTx = data.find((tx) => tx.utr.includes("_AP_"));
      assert.ok(cashfreeTx, "expected the cashfree transaction to be present");
      assert.ok(airpayTx, "expected the airpay transaction to be present");

      assert.equal(
        (cashfreeTx as any).payinGatewayLabel,
        "Payment Gateway A",
        "cashfree was used first and must remain Payment Gateway A even though airpay sorts first alphabetically",
      );
      assert.equal(
        (airpayTx as any).payinGatewayLabel,
        "Payment Gateway B",
        "airpay was added/used after cashfree and must be Payment Gateway B despite sorting earlier alphabetically",
      );
    });

    it("GET /api/transactions/:id: agrees with the list endpoint for both providers", async () => {
      const cashfreeDetail = await get(server, `/api/transactions/${cashfreeTxId}`, token);
      const airpayDetail = await get(server, `/api/transactions/${airpayTxId}`, token);

      assert.equal(cashfreeDetail.status, 200, JSON.stringify(cashfreeDetail.body));
      assert.equal(airpayDetail.status, 200, JSON.stringify(airpayDetail.body));

      assert.equal(
        cashfreeDetail.body["payinGatewayLabel"],
        "Payment Gateway A",
        "detail endpoint must label cashfree as Payment Gateway A, matching the list endpoint",
      );
      assert.equal(
        airpayDetail.body["payinGatewayLabel"],
        "Payment Gateway B",
        "detail endpoint must label airpay as Payment Gateway B, matching the list endpoint",
      );
    });
  },
);
