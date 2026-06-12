import { Router } from "express";
import { db, ekqrWebhookLogsTable } from "@workspace/db";
import { desc, eq, and, gte, lte, count } from "drizzle-orm";
import { requireAuth, requireAdmin } from "../middlewares/auth";

const router = Router();
router.use(requireAuth, requireAdmin);

// GET /api/ekqr/webhook-stats
router.get("/webhook-stats", async (req, res, next) => {
  try {
    const windowHours = 24;
    const since = new Date(Date.now() - windowHours * 60 * 60 * 1000);

    const [receivedRow, creditedRow, errorRow] = await Promise.all([
      db.select({ total: count() }).from(ekqrWebhookLogsTable).where(gte(ekqrWebhookLogsTable.receivedAt, since)),
      db.select({ total: count() }).from(ekqrWebhookLogsTable).where(and(gte(ekqrWebhookLogsTable.receivedAt, since), eq(ekqrWebhookLogsTable.processingResult, "credited"))),
      db.select({ total: count() }).from(ekqrWebhookLogsTable).where(and(gte(ekqrWebhookLogsTable.receivedAt, since), eq(ekqrWebhookLogsTable.processingResult, "error"))),
    ]);

    res.json({
      received: receivedRow[0]?.total ?? 0,
      credited: creditedRow[0]?.total ?? 0,
      errorCount: errorRow[0]?.total ?? 0,
      windowHours,
    });
  } catch (err) {
    next(err);
  }
});

// GET /api/ekqr/webhook-logs
router.get("/webhook-logs", async (req, res, next) => {
  try {
    const page = Math.max(1, parseInt((req.query['page'] as string) || "1") || 1);
    const limit = Math.min(100, Math.max(1, parseInt((req.query['limit'] as string) || "50") || 50));
    const offset = (page - 1) * limit;

    const processingResult = req.query['processingResult'] as string | undefined;
    const merchantId = req.query['merchantId'] ? parseInt(req.query['merchantId'] as string) : undefined;
    const dateFrom = req.query['dateFrom'] as string | undefined;
    const dateTo = req.query['dateTo'] as string | undefined;

    const conditions = [];
    if (processingResult) conditions.push(eq(ekqrWebhookLogsTable.processingResult, processingResult));
    if (merchantId) conditions.push(eq(ekqrWebhookLogsTable.merchantId, merchantId));
    if (dateFrom) conditions.push(gte(ekqrWebhookLogsTable.receivedAt, new Date(dateFrom)));
    if (dateTo) {
      const d = new Date(dateTo);
      d.setDate(d.getDate() + 1);
      conditions.push(lte(ekqrWebhookLogsTable.receivedAt, d));
    }

    const where = conditions.length > 0 ? and(...conditions) : undefined;

    const [rows, [{ total }]] = await Promise.all([
      db
        .select()
        .from(ekqrWebhookLogsTable)
        .where(where)
        .orderBy(desc(ekqrWebhookLogsTable.receivedAt))
        .limit(limit)
        .offset(offset),
      db.select({ total: count() }).from(ekqrWebhookLogsTable).where(where),
    ]);

    res.json({
      data: rows.map(r => ({ ...r, receivedAt: r.receivedAt.toISOString() })),
      total,
      page,
      limit,
    });
  } catch (err) {
    next(err);
  }
});

export default router;
