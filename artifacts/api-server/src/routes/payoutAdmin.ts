import { Router } from "express";
import { requireAuth, requirePayoutAdmin } from "../middlewares/auth";
import { db, usersTable, agentsTable, merchantsTable, withdrawalsTable, merchantWalletsTable } from "@workspace/db";
import { eq, and, count, sum, sql, desc, ne } from "drizzle-orm";

const router = Router();

router.use(requireAuth, requirePayoutAdmin);

/**
 * GET /api/payout-admin/dashboard
 * Dashboard stats for payout admin.
 */
router.get("/dashboard", async (req, res) => {
  try {
    const [payoutMerchantCount] = await db
      .select({ count: count() })
      .from(merchantsTable)
      .where(ne(merchantsTable.merchantType, "NORMAL"));

    const [pendingPayoutCount] = await db
      .select({ count: count() })
      .from(withdrawalsTable)
      .where(eq(withdrawalsTable.status, "pending"));

    const [todayPayoutCount] = await db
      .select({ count: count() })
      .from(withdrawalsTable)
      .where(sql`DATE(${withdrawalsTable.createdAt}) = CURRENT_DATE`);

    const [todayPayoutVolume] = await db
      .select({ total: sum(withdrawalsTable.amount) })
      .from(withdrawalsTable)
      .where(and(
        sql`DATE(${withdrawalsTable.createdAt}) = CURRENT_DATE`,
        eq(withdrawalsTable.transferStatus, "SUCCESS")
      ));

    const [agentCount] = await db
      .select({ count: count() })
      .from(agentsTable)
      .where(eq(agentsTable.status, "active"));

    res.json({
      payoutMerchantCount: Number(payoutMerchantCount?.count ?? 0),
      pendingPayoutCount: Number(pendingPayoutCount?.count ?? 0),
      todayPayoutCount: Number(todayPayoutCount?.count ?? 0),
      todayPayoutVolume: Number(todayPayoutVolume?.total ?? 0),
      activeAgentCount: Number(agentCount?.count ?? 0),
    });
  } catch (err) {
    req.log.error({ err }, "payout_admin_dashboard_error");
    res.status(500).json({ error: "Failed to load dashboard stats" });
  }
});

/**
 * GET /api/payout-admin/payout-merchants
 * List payout merchants visible to payout admin (no payin-only merchants).
 */
router.get("/payout-merchants", async (req, res) => {
  try {
    const merchants = await db
      .select({
        id: merchantsTable.id,
        businessName: merchantsTable.businessName,
        email: merchantsTable.email,
        contactName: merchantsTable.contactName,
        phone: merchantsTable.phone,
        merchantType: merchantsTable.merchantType,
        status: merchantsTable.status,
        payoutServiceEnabled: merchantsTable.payoutServiceEnabled,
        agentId: merchantsTable.agentId,
        createdAt: merchantsTable.createdAt,
      })
      .from(merchantsTable)
      .where(ne(merchantsTable.merchantType, "NORMAL"))
      .orderBy(desc(merchantsTable.createdAt));

    res.json({ data: merchants });
  } catch (err) {
    req.log.error({ err }, "payout_admin_list_merchants_error");
    res.status(500).json({ error: "Failed to load payout merchants" });
  }
});

/**
 * GET /api/payout-admin/payouts
 * List recent payouts for payout admin review.
 */
router.get("/payouts", async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query["page"] as string) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query["limit"] as string) || 20));
    const offset = (page - 1) * limit;

    const payouts = await db
      .select({
        id: withdrawalsTable.id,
        merchantId: withdrawalsTable.merchantId,
        amount: withdrawalsTable.amount,
        mode: withdrawalsTable.payoutMode,
        localStatus: withdrawalsTable.status,
        transferStatus: withdrawalsTable.transferStatus,
        approvalType: withdrawalsTable.approvalType,
        approvedBySystem: withdrawalsTable.approvedBySystem,
        createdAt: withdrawalsTable.createdAt,
        updatedAt: withdrawalsTable.updatedAt,
      })
      .from(withdrawalsTable)
      .orderBy(desc(withdrawalsTable.createdAt))
      .limit(limit)
      .offset(offset);

    const [totalRow] = await db.select({ count: count() }).from(withdrawalsTable);
    const total = Number(totalRow?.count ?? 0);

    res.json({ data: payouts, total, page, limit });
  } catch (err) {
    req.log.error({ err }, "payout_admin_list_payouts_error");
    res.status(500).json({ error: "Failed to load payouts" });
  }
});

/**
 * GET /api/payout-admin/agents
 * List agents visible to payout admin.
 */
router.get("/agents", async (req, res) => {
  try {
    const agents = await db
      .select()
      .from(agentsTable)
      .orderBy(desc(agentsTable.createdAt));

    res.json({ data: agents });
  } catch (err) {
    req.log.error({ err }, "payout_admin_list_agents_error");
    res.status(500).json({ error: "Failed to load agents" });
  }
});

export default router;
