import cron from "node-cron";
import { db, merchantPlansTable, plansTable, planHistoryTable, merchantsTable } from "@workspace/db";
import { eq, lte, and, isNotNull } from "drizzle-orm";
import { logger } from "../lib/logger";

export async function processDueRenewals(): Promise<void> {
  const now = new Date();

  const due = await db
    .select({
      mp: merchantPlansTable,
      plan: plansTable,
      merchantName: merchantsTable.businessName,
    })
    .from(merchantPlansTable)
    .innerJoin(plansTable, eq(merchantPlansTable.planId, plansTable.id))
    .innerJoin(merchantsTable, eq(merchantPlansTable.merchantId, merchantsTable.id))
    .where(
      and(
        isNotNull(merchantPlansTable.scheduledRenewalAt),
        lte(merchantPlansTable.scheduledRenewalAt, now),
        eq(merchantPlansTable.status, "active"),
      ),
    );

  if (due.length === 0) return;

  logger.info({ count: due.length }, "Processing due scheduled plan renewals");

  for (const row of due) {
    const { mp, plan } = row;
    try {
      const currentExpiry = mp.expiresAt;
      let newExpiry: Date;

      if (currentExpiry && currentExpiry > now) {
        const periodMs = currentExpiry.getTime() - mp.assignedAt.getTime();
        const periodDays = Math.max(30, Math.round(periodMs / 86400000));
        newExpiry = new Date(currentExpiry.getTime() + periodDays * 86400000);
      } else {
        newExpiry = new Date(now.getTime() + 30 * 86400000);
      }

      await db
        .update(merchantPlansTable)
        .set({
          expiresAt: newExpiry,
          status: "active",
          renewedAt: now,
          scheduledRenewalAt: null,
        })
        .where(eq(merchantPlansTable.merchantId, mp.merchantId));

      await db.insert(planHistoryTable).values({
        merchantId: mp.merchantId,
        fromPlanId: mp.planId,
        toPlanId: mp.planId,
        action: "renewed",
        assignedBy: null,
        adminEmail: "system (auto-renewal)",
        notes: `Auto-renewed via scheduled renewal. New expiry: ${newExpiry.toISOString().split("T")[0]}`,
      });

      logger.info(
        { merchantId: mp.merchantId, planName: plan.name, newExpiresAt: newExpiry },
        "Plan auto-renewed via scheduled renewal",
      );
    } catch (err) {
      logger.error({ err, merchantId: mp.merchantId }, "Failed to auto-renew scheduled plan");
    }
  }
}

export function initPlanRenewalScheduler(): void {
  cron.schedule("0 * * * *", async () => {
    try {
      await processDueRenewals();
    } catch (err) {
      logger.error({ err }, "Plan renewal scheduler failed");
    }
  });

  logger.info("Plan renewal scheduler registered (runs every hour)");
}
