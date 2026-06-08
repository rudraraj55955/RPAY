import { Router } from "express";
import { db, ledgerEntriesTable, merchantsTable } from "@workspace/db";
import { eq, and, count, gte, lte, sql, desc } from "drizzle-orm";
import { requireAuth, requireAdmin } from "../middlewares/auth";

const router = Router();
router.use(requireAuth);

function parseId(param: string | string[]): number {
  return parseInt(Array.isArray(param) ? param[0] : param);
}

function mapEntry(e: typeof ledgerEntriesTable.$inferSelect, merchantName?: string | null) {
  return {
    ...e,
    amount: Number(e.amount),
    balanceBefore: Number(e.balanceBefore),
    balanceAfter: Number(e.balanceAfter),
    merchantName: merchantName ?? null,
  };
}

// GET /api/ledger — merchant sees own, admin sees all (with optional merchantId filter)
router.get("/", async (req, res, next) => {
  try {
    const user = (req as any).user;
    const { merchantId, type, dateFrom, dateTo, page = "1", limit = "50" } = req.query as Record<string, string>;
    const pageNum = Math.max(1, parseInt(page));
    const limitNum = Math.min(200, Math.max(1, parseInt(limit)));
    const offset = (pageNum - 1) * limitNum;

    const conditions: ReturnType<typeof eq>[] = [];
    if (user.role !== "admin") {
      conditions.push(eq(ledgerEntriesTable.merchantId, user.merchantId!));
    } else if (merchantId) {
      conditions.push(eq(ledgerEntriesTable.merchantId, parseInt(merchantId)));
    }
    if (type && type !== "all") conditions.push(eq(ledgerEntriesTable.type, type));
    if (dateFrom) conditions.push(gte(ledgerEntriesTable.createdAt, new Date(dateFrom)));
    if (dateTo) {
      const end = new Date(dateTo);
      end.setHours(23, 59, 59, 999);
      conditions.push(lte(ledgerEntriesTable.createdAt, end));
    }

    const where = conditions.length > 0 ? and(...conditions) : undefined;
    const [{ total }] = await db.select({ total: count() }).from(ledgerEntriesTable).where(where);

    const rows = await db
      .select({ entry: ledgerEntriesTable, merchantName: merchantsTable.businessName })
      .from(ledgerEntriesTable)
      .leftJoin(merchantsTable, eq(ledgerEntriesTable.merchantId, merchantsTable.id))
      .where(where)
      .orderBy(desc(ledgerEntriesTable.createdAt))
      .limit(limitNum)
      .offset(offset);

    // current balance: fetch from merchants table for scoped merchant, or 0 for cross-merchant admin view
    let currentBalance = 0;
    const scopedMerchantId = user.role !== "admin" ? user.merchantId : (merchantId ? parseInt(merchantId) : null);
    if (scopedMerchantId) {
      const [m] = await db.select({ balance: merchantsTable.balance }).from(merchantsTable).where(eq(merchantsTable.id, scopedMerchantId)).limit(1);
      if (m) currentBalance = Number(m.balance);
    }

    res.json({
      data: rows.map(r => mapEntry(r.entry, r.merchantName)),
      total: Number(total),
      page: pageNum,
      limit: limitNum,
      currentBalance,
    });
  } catch (err) {
    next(err);
  }
});

// POST /api/ledger/adjustment — admin creates manual credit/debit adjustment
router.post("/adjustment", requireAdmin, async (req, res, next) => {
  try {
    const user = (req as any).user;
    const { merchantId, amount, description } = req.body as { merchantId?: number; amount?: number; description?: string };

    if (!merchantId || typeof merchantId !== "number") {
      res.status(400).json({ error: "merchantId is required" });
      return;
    }
    if (amount === undefined || amount === null || typeof amount !== "number" || amount === 0) {
      res.status(400).json({ error: "amount must be a non-zero number (positive = credit, negative = debit)" });
      return;
    }
    if (!description || typeof description !== "string" || !description.trim()) {
      res.status(400).json({ error: "description is required" });
      return;
    }

    let entry: typeof ledgerEntriesTable.$inferSelect;
    try {
      entry = await db.transaction(async (tx) => {
        const [merchant] = await tx
          .select({ balance: merchantsTable.balance })
          .from(merchantsTable)
          .where(eq(merchantsTable.id, merchantId))
          .limit(1);

        if (!merchant) throw Object.assign(new Error("Merchant not found"), { statusCode: 404 });

        const balanceBefore = Number(merchant.balance);
        const balanceAfter = balanceBefore + amount;

        if (balanceAfter < 0) {
          throw Object.assign(new Error("Adjustment would result in a negative balance"), { statusCode: 400 });
        }

        await tx
          .update(merchantsTable)
          .set({ balance: sql`${merchantsTable.balance} + ${amount}::numeric`, updatedAt: new Date() })
          .where(eq(merchantsTable.id, merchantId));

        const [created] = await tx
          .insert(ledgerEntriesTable)
          .values({
            merchantId,
            type: "adjustment",
            amount: amount.toFixed(2),
            balanceBefore: balanceBefore.toFixed(2),
            balanceAfter: balanceAfter.toFixed(2),
            referenceType: "manual",
            description: description.trim(),
            createdBy: user.id,
          })
          .returning();

        return created;
      });
    } catch (err: any) {
      const code = err?.statusCode ?? 500;
      res.status(code).json({ error: err?.message ?? "Adjustment failed" });
      return;
    }

    res.status(201).json(mapEntry(entry));
  } catch (err) {
    next(err);
  }
});

export default router;
