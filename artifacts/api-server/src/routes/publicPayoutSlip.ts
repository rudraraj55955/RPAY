import { Router } from "express";
import { db, withdrawalsTable, merchantsTable, auditLogsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { verifySlipShareToken } from "../helpers/payoutSlipShare";
import { buildSlipData } from "./withdrawals";
import { buildPayoutSlipPdf } from "../helpers/payoutSlipPdf";

const router = Router();

// GET /api/public/payout-slip/:token — read-only slip data from a signed share token
router.get("/:token", async (req, res, next) => {
  try {
    const token = req.params["token"] as string;

    let payload: ReturnType<typeof verifySlipShareToken>;
    try {
      payload = verifySlipShareToken(token);
    } catch {
      res.status(401).json({ error: "Slip link expired or invalid", code: "SLIP_LINK_EXPIRED" });
      return;
    }

    const { payoutId } = payload;

    const [row] = await db
      .select({ withdrawal: withdrawalsTable, merchantName: merchantsTable.businessName })
      .from(withdrawalsTable)
      .leftJoin(merchantsTable, eq(withdrawalsTable.merchantId, merchantsTable.id))
      .where(eq(withdrawalsTable.id, payoutId))
      .limit(1);

    if (!row) {
      res.status(404).json({ error: "Payout not found" });
      return;
    }

    await db
      .insert(auditLogsTable)
      .values({
        adminId: 0,
        adminEmail: "public-link",
        action: "payout_slip_link_opened",
        targetType: "withdrawal",
        targetId: payoutId,
        details: JSON.stringify({ payoutId, via: "share_link", ip: req.ip }),
        ipAddress: req.ip ?? null,
      })
      .catch(() => {});

    res.json(buildSlipData(row.withdrawal, row.merchantName ?? null));
  } catch (err) {
    next(err);
  }
});

// GET /api/public/payout-slip/:token/pdf — PDF download from signed share token
router.get("/:token/pdf", async (req, res, next) => {
  try {
    const token = req.params["token"] as string;

    let payload: ReturnType<typeof verifySlipShareToken>;
    try {
      payload = verifySlipShareToken(token);
    } catch {
      res.status(401).json({ error: "Slip link expired or invalid", code: "SLIP_LINK_EXPIRED" });
      return;
    }

    const { payoutId } = payload;

    const [row] = await db
      .select({ withdrawal: withdrawalsTable, merchantName: merchantsTable.businessName })
      .from(withdrawalsTable)
      .leftJoin(merchantsTable, eq(withdrawalsTable.merchantId, merchantsTable.id))
      .where(eq(withdrawalsTable.id, payoutId))
      .limit(1);

    if (!row) {
      res.status(404).json({ error: "Payout not found" });
      return;
    }

    const slip = buildSlipData(row.withdrawal, row.merchantName ?? null);
    const pdfBuf = await buildPayoutSlipPdf(slip);

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader(
      "Content-Disposition",
      `inline; filename="rasokart-payout-slip-${payoutId}.pdf"`,
    );
    res.setHeader("Cache-Control", "no-store");
    res.send(pdfBuf);
  } catch (err) {
    next(err);
  }
});

export default router;
