import { Router } from "express";
import { requireAuth, requireAgent } from "../middlewares/auth";
import { db, agentsTable, merchantsTable, usersTable } from "@workspace/db";
import { eq, and, count, desc } from "drizzle-orm";

const router = Router();

router.use(requireAuth, requireAgent);

/**
 * Resolves the agent record for the currently authenticated agent user.
 */
async function getAgentForUser(userId: number) {
  const [agent] = await db
    .select()
    .from(agentsTable)
    .where(eq(agentsTable.userId, userId))
    .limit(1);
  return agent ?? null;
}

/**
 * GET /api/agent/me
 * Get agent profile.
 */
router.get("/me", async (req, res) => {
  try {
    const user = (req as any).user;
    const agent = await getAgentForUser(user.id);
    if (!agent) {
      res.status(404).json({ error: "Agent profile not found" });
      return;
    }
    res.json(agent);
  } catch (err) {
    req.log.error({ err }, "agent_me_error");
    res.status(500).json({ error: "Failed to load agent profile" });
  }
});

/**
 * GET /api/agent/dashboard
 * Dashboard stats for agent (only own merchants).
 */
router.get("/dashboard", async (req, res) => {
  try {
    const user = (req as any).user;
    const agent = await getAgentForUser(user.id);
    if (!agent) {
      res.status(404).json({ error: "Agent profile not found" });
      return;
    }

    const myMerchants = await db
      .select({
        id: merchantsTable.id,
        status: merchantsTable.status,
      })
      .from(merchantsTable)
      .where(eq(merchantsTable.agentId, agent.id));

    const total = myMerchants.length;
    const pending = myMerchants.filter((m) => m.status === "pending").length;
    const approved = myMerchants.filter((m) => m.status === "approved").length;
    const rejected = myMerchants.filter((m) => m.status === "rejected").length;
    const suspended = myMerchants.filter((m) => m.status === "suspended").length;

    res.json({
      totalMerchantsOnboarded: total,
      pendingMerchants: pending,
      approvedMerchants: approved,
      rejectedMerchants: rejected,
      suspendedMerchants: suspended,
      walletBalance: Number(agent.walletBalance),
      totalCommissionEarned: Number(agent.totalCommissionEarned),
      totalCommissionPaid: Number(agent.totalCommissionPaid),
      withdrawableCommission: Math.max(0, Number(agent.walletBalance)),
    });
  } catch (err) {
    req.log.error({ err }, "agent_dashboard_error");
    res.status(500).json({ error: "Failed to load dashboard stats" });
  }
});

/**
 * GET /api/agent/payout-merchants
 * List only this agent's payout merchants (no full KYC, no provider details).
 */
router.get("/payout-merchants", async (req, res) => {
  try {
    const user = (req as any).user;
    const agent = await getAgentForUser(user.id);
    if (!agent) {
      res.status(404).json({ error: "Agent profile not found" });
      return;
    }

    const merchants = await db
      .select({
        id: merchantsTable.id,
        businessName: merchantsTable.businessName,
        email: merchantsTable.email,
        contactName: merchantsTable.contactName,
        phone: merchantsTable.phone,
        status: merchantsTable.status,
        payoutServiceEnabled: merchantsTable.payoutServiceEnabled,
        createdAt: merchantsTable.createdAt,
      })
      .from(merchantsTable)
      .where(eq(merchantsTable.agentId, agent.id))
      .orderBy(desc(merchantsTable.createdAt));

    res.json({ data: merchants });
  } catch (err) {
    req.log.error({ err }, "agent_list_merchants_error");
    res.status(500).json({ error: "Failed to load merchants" });
  }
});

export default router;
