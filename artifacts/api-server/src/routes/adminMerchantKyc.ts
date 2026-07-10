import { Router } from "express";
import { db, merchantKycVerificationsTable, merchantsTable, kycVerificationLogsTable, auditLogsTable, usersTable } from "@workspace/db";
import { eq, desc } from "drizzle-orm";
import { requireAuth, requireAdmin } from "../middlewares/auth";

const router = Router();
router.use(requireAuth, requireAdmin);

// GET /api/admin/merchant-kyc — list all auto-KYC verification records
router.get("/", async (_req, res, next) => {
  try {
    const rows = await db
      .select({
        merchantId: merchantKycVerificationsTable.merchantId,
        businessName: merchantsTable.businessName,
        email: merchantsTable.email,
        verificationStatus: merchantKycVerificationsTable.verificationStatus,
        panVerified: merchantKycVerificationsTable.panVerified,
        aadhaarVerified: merchantKycVerificationsTable.aadhaarVerified,
        nameMatchScore: merchantKycVerificationsTable.nameMatchScore,
        failureReason: merchantKycVerificationsTable.failureReason,
        createdAt: merchantKycVerificationsTable.createdAt,
        updatedAt: merchantKycVerificationsTable.updatedAt,
      })
      .from(merchantKycVerificationsTable)
      .innerJoin(merchantsTable, eq(merchantsTable.id, merchantKycVerificationsTable.merchantId))
      .orderBy(desc(merchantKycVerificationsTable.updatedAt));
    res.json(rows);
  } catch (err) { next(err); }
});

// GET /api/admin/merchant-kyc/:merchantId — detail incl. masked audit trail
router.get("/:merchantId", async (req, res, next) => {
  try {
    const merchantId = parseInt(req.params["merchantId"] as string);
    const [row] = await db.select().from(merchantKycVerificationsTable).where(eq(merchantKycVerificationsTable.merchantId, merchantId)).limit(1);
    if (!row) { res.status(404).json({ error: "No auto-KYC record found for this merchant" }); return; }
    const [merchant] = await db.select({ businessName: merchantsTable.businessName, email: merchantsTable.email, contactName: merchantsTable.contactName }).from(merchantsTable).where(eq(merchantsTable.id, merchantId)).limit(1);
    const logs = await db
      .select({
        id: kycVerificationLogsTable.id,
        verificationType: kycVerificationLogsTable.verificationType,
        status: kycVerificationLogsTable.status,
        requestMasked: kycVerificationLogsTable.requestMasked,
        responseMasked: kycVerificationLogsTable.responseMasked,
        errorReason: kycVerificationLogsTable.errorReason,
        createdAt: kycVerificationLogsTable.createdAt,
      })
      .from(kycVerificationLogsTable)
      .where(eq(kycVerificationLogsTable.merchantId, merchantId))
      .orderBy(desc(kycVerificationLogsTable.createdAt))
      .limit(50);

    res.json({
      merchantId,
      businessName: merchant?.businessName,
      email: merchant?.email,
      ownerName: merchant?.contactName,
      panNumberMasked: row.panNumberMasked,
      panName: row.panName,
      panType: row.panType,
      panVerified: row.panVerified,
      panVerifiedAt: row.panVerifiedAt,
      aadhaarLast4: row.aadhaarLast4,
      aadhaarName: row.aadhaarName,
      aadhaarVerified: row.aadhaarVerified,
      aadhaarVerifiedAt: row.aadhaarVerifiedAt,
      nameMatchScore: row.nameMatchScore,
      verificationStatus: row.verificationStatus,
      failureReason: row.failureReason,
      consentAt: row.consentAt,
      adminDecisionBy: row.adminDecisionBy,
      adminDecisionAt: row.adminDecisionAt,
      adminDecisionNote: row.adminDecisionNote,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      logs,
    });
  } catch (err) { next(err); }
});

// POST /api/admin/merchant-kyc/:merchantId/override — manual approve/reject after review
router.post("/:merchantId/override", async (req, res, next) => {
  try {
    const merchantId = parseInt(req.params["merchantId"] as string);
    const admin = (req as any).user;
    const { decision, note } = req.body as { decision?: string; note?: string };
    if (decision !== "APPROVED" && decision !== "REJECTED") {
      res.status(400).json({ error: "decision must be APPROVED or REJECTED" });
      return;
    }

    const [row] = await db.select().from(merchantKycVerificationsTable).where(eq(merchantKycVerificationsTable.merchantId, merchantId)).limit(1);
    if (!row) { res.status(404).json({ error: "No auto-KYC record found for this merchant" }); return; }

    await db.update(merchantKycVerificationsTable).set({
      verificationStatus: decision,
      adminDecisionBy: admin.email,
      adminDecisionAt: new Date(),
      adminDecisionNote: note ?? null,
      updatedAt: new Date(),
    }).where(eq(merchantKycVerificationsTable.merchantId, merchantId));

    if (decision === "APPROVED") {
      const [merchant] = await db.update(merchantsTable).set({ status: "approved", verificationStatus: "approved", rejectionReason: null }).where(eq(merchantsTable.id, merchantId)).returning();
      if (merchant) {
        await db.update(usersTable).set({ isActive: true }).where(eq(usersTable.email, merchant.email));
      }
    }

    await db.insert(auditLogsTable).values({
      adminId: admin.id,
      adminEmail: admin.email,
      action: decision === "APPROVED" ? "merchant_auto_kyc_manual_approve" : "merchant_auto_kyc_manual_reject",
      targetType: "merchant",
      targetId: merchantId,
      details: JSON.stringify({ note: note ?? null }),
      ipAddress: req.ip ?? null,
    });

    req.log.info({ merchantId, decision, admin: admin.email }, "merchant_auto_kyc_admin_override");
    res.json({ ok: true, status: decision });
  } catch (err) { next(err); }
});

export default router;
