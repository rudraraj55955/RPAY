import { Router } from "express";
import { db, settlementsTable, merchantsTable } from "@workspace/db";
import { eq, and, count, sql, gte, lte } from "drizzle-orm";
import { requireAuth } from "../middlewares/auth";

const router = Router();
router.use(requireAuth);

// GET /api/settlements
router.get("/", async (req, res) => {
  const user = (req as any).user;
  const { merchantId, dateFrom, dateTo, page = "1", limit = "20" } = req.query as Record<string, string>;
  const pageNum = Math.max(1, parseInt(page));
  const limitNum = Math.min(100, Math.max(1, parseInt(limit)));
  const offset = (pageNum - 1) * limitNum;

  const conditions = [];
  if (user.role !== "admin") conditions.push(eq(settlementsTable.merchantId, user.merchantId!));
  if (merchantId && user.role === "admin") conditions.push(eq(settlementsTable.merchantId, parseInt(merchantId)));
  if (dateFrom) conditions.push(gte(settlementsTable.periodFrom, dateFrom));
  if (dateTo) conditions.push(lte(settlementsTable.periodTo, dateTo));

  const where = conditions.length > 0 ? and(...conditions) : undefined;
  const [{ total }] = await db.select({ total: count() }).from(settlementsTable).where(where);

  const rows = await db
    .select({
      settlement: settlementsTable,
      merchantName: merchantsTable.businessName,
    })
    .from(settlementsTable)
    .leftJoin(merchantsTable, eq(settlementsTable.merchantId, merchantsTable.id))
    .where(where)
    .limit(limitNum)
    .offset(offset)
    .orderBy(sql`${settlementsTable.createdAt} DESC`);

  res.json({
    data: rows.map(r => ({
      ...r.settlement,
      amount: Number(r.settlement.amount),
      merchantName: r.merchantName ?? null,
    })),
    total,
    page: pageNum,
    limit: limitNum,
  });
});

// GET /api/settlements/export/csv
router.get("/export/csv", async (req, res) => {
  const user = (req as any).user;
  if (user.role !== "admin") {
    res.status(403).json({ error: "Forbidden" });
    return;
  }
  const { merchantId, dateFrom, dateTo, search, status } = req.query as Record<string, string>;

  const conditions = [];
  if (merchantId) conditions.push(eq(settlementsTable.merchantId, parseInt(merchantId)));
  if (dateFrom) conditions.push(gte(settlementsTable.periodFrom, dateFrom));
  if (dateTo) conditions.push(lte(settlementsTable.periodTo, dateTo));
  if (status && status !== "all") conditions.push(eq(settlementsTable.status, status));

  const where = conditions.length > 0 ? and(...conditions) : undefined;

  const rows = await db
    .select({
      settlement: settlementsTable,
      merchantName: merchantsTable.businessName,
    })
    .from(settlementsTable)
    .leftJoin(merchantsTable, eq(settlementsTable.merchantId, merchantsTable.id))
    .where(where)
    .orderBy(sql`${settlementsTable.createdAt} DESC`);

  const filtered = search
    ? rows.filter(r => r.merchantName?.toLowerCase().includes(search.toLowerCase()))
    : rows;

  const header = ["ID", "Merchant", "Amount", "Currency", "Status", "Period From", "Period To", "Transactions", "Created"];
  const csvRows = filtered.map(r => [
    String(r.settlement.id),
    r.merchantName ?? "",
    String(Number(r.settlement.amount)),
    r.settlement.currency,
    r.settlement.status,
    r.settlement.periodFrom,
    r.settlement.periodTo,
    String(r.settlement.transactionCount),
    r.settlement.createdAt instanceof Date ? r.settlement.createdAt.toISOString() : String(r.settlement.createdAt),
  ].map(v => `"${String(v).replace(/"/g, '""')}"`).join(","));

  const csv = [header.join(","), ...csvRows].join("\n");
  res.setHeader("Content-Type", "text/csv");
  res.setHeader("Content-Disposition", "attachment; filename=\"settlements.csv\"");
  res.send(csv);
});

export default router;
