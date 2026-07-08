import { Router } from "express";
import { db, walletLedgerTable, merchantsTable, merchantWalletsTable } from "@workspace/db";
import { eq, and, gte, lte, sql, asc, desc } from "drizzle-orm";
import { requireAuth, requireAdmin } from "../middlewares/auth";
import { buildAccountStatementPdf, type AccountStatementData, type StatementEntry } from "../helpers/accountStatementPdf";

const router = Router();
router.use(requireAuth);

// ── helpers ──────────────────────────────────────────────────────────────────

function txnTypeLabel(t: string): string {
  return (
    {
      pending_credit:      "Deposit",
      settlement_transfer: "Settlement Transfer",
      withdrawal_debit:    "Payout",
      reversal:            "Payout Reversal",
      hold_created:        "Hold",
      hold_released:       "Hold Released",
      charge:              "Fee / Charge",
      refund:              "Refund",
      manual_credit:       "Manual Credit",
      manual_debit:        "Manual Debit",
    } as Record<string, string>
  )[t] ?? t;
}

function parseDates(from?: string, to?: string): { fromDate: Date; toDate: Date } {
  const fromDate = from ? new Date(from) : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  fromDate.setHours(0, 0, 0, 0);
  const toDate = to ? new Date(to) : new Date();
  toDate.setHours(23, 59, 59, 999);
  return { fromDate, toDate };
}

function isCredit(txnType: string): boolean {
  return [
    "pending_credit", "settlement_transfer", "reversal",
    "hold_released", "refund", "manual_credit",
  ].includes(txnType);
}

async function buildStatement(merchantId: number, fromDate: Date, toDate: Date): Promise<AccountStatementData> {
  const [merchant] = await db
    .select({ businessName: merchantsTable.businessName, email: merchantsTable.email, phone: merchantsTable.phone })
    .from(merchantsTable)
    .where(eq(merchantsTable.id, merchantId))
    .limit(1);

  const rawEntries = await db
    .select()
    .from(walletLedgerTable)
    .where(
      and(
        eq(walletLedgerTable.merchantId, merchantId),
        gte(walletLedgerTable.createdAt, fromDate),
        lte(walletLedgerTable.createdAt, toDate),
      )
    )
    .orderBy(asc(walletLedgerTable.createdAt));

  // Opening balance = availableAfter of last entry before fromDate
  const [prevEntry] = await db
    .select({ availableAfter: walletLedgerTable.availableAfter })
    .from(walletLedgerTable)
    .where(
      and(
        eq(walletLedgerTable.merchantId, merchantId),
        sql`${walletLedgerTable.createdAt} < ${fromDate.toISOString()}`
      )
    )
    .orderBy(desc(walletLedgerTable.createdAt))
    .limit(1);

  const openingBalance = prevEntry ? Number(prevEntry.availableAfter) : 0;
  const closingBalance = rawEntries.length > 0
    ? Number(rawEntries[rawEntries.length - 1].availableAfter)
    : openingBalance;

  let totalCredits = 0, totalDebits = 0, totalDeposits = 0, totalPayouts = 0, totalCharges = 0, totalRefunds = 0;

  const entries: StatementEntry[] = rawEntries.map(e => {
    const amt = Number(e.amount);
    const credit = isCredit(e.txnType);
    if (e.txnType === "pending_credit") totalDeposits += Math.abs(amt);
    if (e.txnType === "withdrawal_debit") totalPayouts += Math.abs(amt);
    if (e.txnType === "charge") totalCharges += Math.abs(amt);
    if (e.txnType === "refund") totalRefunds += Math.abs(amt);
    if (credit) totalCredits += Math.abs(amt);
    else totalDebits += Math.abs(amt);

    return {
      id: e.id,
      createdAt: e.createdAt,
      txnType: e.txnType,
      typeLabel: txnTypeLabel(e.txnType),
      referenceType: e.referenceType ?? null,
      referenceId: e.referenceId ?? null,
      description: e.description,
      credit: credit ? Math.abs(amt) : null,
      debit: !credit ? Math.abs(amt) : null,
      availableAfter: Number(e.availableAfter),
    };
  });

  return {
    merchant: { businessName: merchant?.businessName ?? "", email: merchant?.email ?? "", phone: merchant?.phone ?? null },
    period: { from: fromDate, to: toDate },
    openingBalance,
    closingBalance,
    totalCredits,
    totalDebits,
    totalDeposits,
    totalPayouts,
    totalCharges,
    totalRefunds,
    entries,
  };
}

function buildCsv(data: AccountStatementData, from: string, to: string): string {
  const esc = (v: string) => `"${String(v).replace(/"/g, '""')}"`;
  const headers = ["Date/Time", "Type", "Reference Type", "Reference ID", "Description", "Credit (INR)", "Debit (INR)", "Balance After (INR)"];
  const rows = data.entries.map(e => [
    e.createdAt instanceof Date ? e.createdAt.toISOString() : String(e.createdAt),
    e.typeLabel,
    e.referenceType ?? "",
    e.referenceId ? String(e.referenceId) : "",
    e.description,
    e.credit != null ? e.credit.toFixed(2) : "",
    e.debit != null ? e.debit.toFixed(2) : "",
    e.availableAfter.toFixed(2),
  ].map(esc).join(","));

  const summary = [
    `# RasoKart Account Statement — ${data.merchant.businessName}`,
    `# Period: ${from} to ${to}`,
    `# Opening Balance: ${data.openingBalance.toFixed(2)}`,
    `# Closing Balance: ${data.closingBalance.toFixed(2)}`,
    `# Total Credits: ${data.totalCredits.toFixed(2)}`,
    `# Total Debits: ${data.totalDebits.toFixed(2)}`,
    "",
  ].join("\n");

  return summary + [headers.join(","), ...rows].join("\n");
}

// ── Merchant routes ───────────────────────────────────────────────────────────

// GET /api/account-statement — JSON or CSV
router.get("/", async (req, res, next) => {
  try {
    const user = (req as any).user;
    if (!user.merchantId) { res.status(403).json({ error: "Merchant access required" }); return; }

    const { from, to, format } = req.query as { from?: string; to?: string; format?: string };
    const { fromDate, toDate } = parseDates(from, to);
    const data = await buildStatement(user.merchantId, fromDate, toDate);

    if (format === "csv") {
      const csv = buildCsv(data, from ?? fromDate.toISOString().slice(0, 10), to ?? toDate.toISOString().slice(0, 10));
      res.setHeader("Content-Type", "text/csv");
      res.setHeader("Content-Disposition", `attachment; filename="rasokart-statement-${from ?? "all"}.csv"`);
      res.send(csv);
      return;
    }

    res.json({ ok: true, ...data });
  } catch (err) { next(err); }
});

// GET /api/account-statement/pdf — PDF download
router.get("/pdf", async (req, res, next) => {
  try {
    const user = (req as any).user;
    if (!user.merchantId) { res.status(403).json({ error: "Merchant access required" }); return; }

    const { from, to } = req.query as { from?: string; to?: string };
    const { fromDate, toDate } = parseDates(from, to);
    const data = await buildStatement(user.merchantId, fromDate, toDate);
    const buf = await buildAccountStatementPdf(data);

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `inline; filename="rasokart-statement.pdf"`);
    res.setHeader("Cache-Control", "no-store");
    res.send(buf);
  } catch (err) { next(err); }
});

// ── Admin routes ──────────────────────────────────────────────────────────────

// GET /api/admin/merchant-statements — JSON or CSV (admin picks any merchant)
router.get("/admin", requireAdmin, async (req, res, next) => {
  try {
    const { merchantId, from, to, format } = req.query as { merchantId?: string; from?: string; to?: string; format?: string };
    const mid = merchantId ? parseInt(merchantId) : null;
    if (!mid || isNaN(mid)) { res.status(400).json({ error: "merchantId required" }); return; }

    const { fromDate, toDate } = parseDates(from, to);
    const data = await buildStatement(mid, fromDate, toDate);

    if (format === "csv") {
      const csv = buildCsv(data, from ?? fromDate.toISOString().slice(0, 10), to ?? toDate.toISOString().slice(0, 10));
      res.setHeader("Content-Type", "text/csv");
      res.setHeader("Content-Disposition", `attachment; filename="rasokart-statement-${mid}.csv"`);
      res.send(csv);
      return;
    }

    res.json({ ok: true, ...data });
  } catch (err) { next(err); }
});

// GET /api/admin/merchant-statements/pdf
router.get("/admin/pdf", requireAdmin, async (req, res, next) => {
  try {
    const { merchantId, from, to } = req.query as { merchantId?: string; from?: string; to?: string };
    const mid = merchantId ? parseInt(merchantId) : null;
    if (!mid || isNaN(mid)) { res.status(400).json({ error: "merchantId required" }); return; }

    const { fromDate, toDate } = parseDates(from, to);
    const data = await buildStatement(mid, fromDate, toDate);
    const buf = await buildAccountStatementPdf(data);

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `inline; filename="rasokart-statement-${mid}.pdf"`);
    res.setHeader("Cache-Control", "no-store");
    res.send(buf);
  } catch (err) { next(err); }
});

export default router;
