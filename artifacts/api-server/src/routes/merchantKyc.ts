import { Router } from "express";
import { db, merchantKycVerificationsTable, merchantsTable, auditLogsTable, usersTable } from "@workspace/db";
import { eq, and, ne } from "drizzle-orm";
import { requireAuth } from "../middlewares/auth";
import { DbRateLimitStore } from "../lib/rateLimitStore";
import { makeRateLimiter, safeIpKey } from "../helpers/makeRateLimiter";
import { encryptValue, safeDecrypt, hashValue } from "../helpers/encryptionHelper";
import {
  loadAutoKycConfig,
  verifyPanAuto,
  startAadhaarOtp,
  verifyAadhaarOtp,
  computeNameMatchScore,
  maskPan,
} from "../helpers/merchantAutoKycProvider";

const router = Router();
router.use(requireAuth);

function requireMerchant(req: any, res: any, next: any) {
  const user = req.user;
  if (!user || user.role !== "merchant" || !user.merchantId) {
    res.status(403).json({ error: "Merchant access required" });
    return;
  }
  next();
}
router.use(requireMerchant);

const attemptLimiter = makeRateLimiter({
  windowMs: 60 * 60 * 1000,
  limit: 10,
  store: new DbRateLimitStore(),
  message: { error: "Too many KYC attempts. Please try again later." },
  keyGenerator: (req: any) => `merchant-kyc:${safeIpKey(req)}:${req.user?.merchantId ?? "anon"}`,
});

function publicRow(row: any) {
  if (!row) {
    return {
      status: "PENDING",
      panVerified: false,
      aadhaarVerified: false,
      nameMatchScore: null,
      failureReason: null,
    };
  }
  return {
    status: row.verificationStatus,
    panVerified: row.panVerified,
    panNumberMasked: row.panNumberMasked,
    aadhaarVerified: row.aadhaarVerified,
    aadhaarLast4: row.aadhaarLast4,
    nameMatchScore: row.nameMatchScore,
    failureReason: row.failureReason,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

async function getOrCreateRow(merchantId: number) {
  const [existing] = await db.select().from(merchantKycVerificationsTable).where(eq(merchantKycVerificationsTable.merchantId, merchantId)).limit(1);
  if (existing) return existing;
  const [created] = await db.insert(merchantKycVerificationsTable).values({ merchantId, verificationStatus: "PENDING" }).returning();
  return created;
}

// GET /api/merchant-kyc/status
router.get("/status", async (req: any, res, next) => {
  try {
    const [row] = await db.select().from(merchantKycVerificationsTable).where(eq(merchantKycVerificationsTable.merchantId, req.user.merchantId)).limit(1);
    res.json(publicRow(row));
  } catch (err) { next(err); }
});

// POST /api/merchant-kyc/pan/verify
router.post("/pan/verify", attemptLimiter, async (req: any, res, next) => {
  try {
    const merchantId = req.user.merchantId as number;
    const { panNumber } = req.body as Record<string, unknown>;
    if (!panNumber || typeof panNumber !== "string") {
      res.status(400).json({ error: "PAN number is required" });
      return;
    }
    const pan = panNumber.trim().toUpperCase();

    const cfg = await loadAutoKycConfig();
    if (!cfg || !cfg.panApiEnabled) {
      res.status(503).json({ error: "RasoKart KYC Verification is temporarily unavailable. Please try again later." });
      return;
    }

    const row = await getOrCreateRow(merchantId);
    if (row.verificationStatus === "APPROVED") {
      res.status(400).json({ error: "KYC is already approved for this account." });
      return;
    }

    const panHash = hashValue(pan);
    if (cfg.duplicateCheckEnabled) {
      const [dup] = await db
        .select({ merchantId: merchantKycVerificationsTable.merchantId })
        .from(merchantKycVerificationsTable)
        .where(and(eq(merchantKycVerificationsTable.panNumberHash, panHash), ne(merchantKycVerificationsTable.merchantId, merchantId)))
        .limit(1);
      if (dup) {
        res.status(409).json({ error: "This PAN is already linked to another merchant account." });
        return;
      }
    }

    const result = await verifyPanAuto(cfg, pan, merchantId);
    if (!result.ok) {
      await db.update(merchantKycVerificationsTable).set({
        verificationStatus: "PAN_FAILED",
        failureReason: result.status === "INVALID" ? "PAN details could not be verified." : "Verification provider unavailable. Please try again.",
        updatedAt: new Date(),
      }).where(eq(merchantKycVerificationsTable.merchantId, merchantId));
      res.status(422).json({ error: result.status === "INVALID" ? "PAN details could not be verified." : "Verification provider unavailable. Please try again." });
      return;
    }

    const enc = result.requestId ? encryptValue(result.requestId) : null;
    await db.update(merchantKycVerificationsTable).set({
      panNumberMasked: maskPan(pan),
      panNumberHash: panHash,
      panName: result.registeredName ?? null,
      panType: result.panType ?? null,
      panVerified: true,
      panVerifiedAt: new Date(),
      panReferenceIdEncrypted: enc?.encrypted ?? null,
      panReferenceIdIv: enc?.iv ?? null,
      panReferenceIdTag: enc?.tag ?? null,
      verificationStatus: "PAN_VERIFIED",
      failureReason: null,
      updatedAt: new Date(),
    }).where(eq(merchantKycVerificationsTable.merchantId, merchantId));

    req.log.info({ merchantId }, "merchant_kyc_pan_verified");
    res.json({ ok: true, panType: result.panType });
  } catch (err) { next(err); }
});

// POST /api/merchant-kyc/aadhaar/start
router.post("/aadhaar/start", attemptLimiter, async (req: any, res, next) => {
  try {
    const merchantId = req.user.merchantId as number;
    const { aadhaarNumber } = req.body as Record<string, unknown>;
    if (!aadhaarNumber || typeof aadhaarNumber !== "string") {
      res.status(400).json({ error: "Aadhaar number is required" });
      return;
    }
    const cfg = await loadAutoKycConfig();
    if (!cfg || !cfg.aadhaarApiEnabled) {
      res.status(503).json({ error: "RasoKart KYC Verification is temporarily unavailable. Please try again later." });
      return;
    }

    const [row] = await db.select().from(merchantKycVerificationsTable).where(eq(merchantKycVerificationsTable.merchantId, merchantId)).limit(1);
    if (!row || !row.panVerified) {
      res.status(400).json({ error: "Please complete PAN verification first." });
      return;
    }

    const aadhaarHash = hashValue(aadhaarNumber.replace(/\D/g, ""));
    if (cfg.duplicateCheckEnabled) {
      const [dup] = await db
        .select({ merchantId: merchantKycVerificationsTable.merchantId })
        .from(merchantKycVerificationsTable)
        .where(and(eq(merchantKycVerificationsTable.aadhaarNumberHash, aadhaarHash), ne(merchantKycVerificationsTable.merchantId, merchantId)))
        .limit(1);
      if (dup) {
        res.status(409).json({ error: "This Aadhaar is already linked to another merchant account." });
        return;
      }
    }

    const result = await startAadhaarOtp(cfg, aadhaarNumber, merchantId);
    if (!result.ok || !result.sessionId) {
      res.status(422).json({ error: "Could not send Aadhaar OTP. Please check the number and try again." });
      return;
    }

    const enc = encryptValue(result.sessionId);
    await db.update(merchantKycVerificationsTable).set({
      aadhaarNumberHash: aadhaarHash,
      aadhaarOtpSessionEncrypted: enc.encrypted,
      aadhaarOtpSessionIv: enc.iv,
      aadhaarOtpSessionTag: enc.tag,
      consentIp: req.ip ?? null,
      consentUserAgent: req.headers["user-agent"] ?? null,
      consentAt: new Date(),
      updatedAt: new Date(),
    }).where(eq(merchantKycVerificationsTable.merchantId, merchantId));

    req.log.info({ merchantId }, "merchant_kyc_aadhaar_otp_sent");
    res.json({ ok: true, message: "OTP sent to your Aadhaar-linked mobile number." });
  } catch (err) { next(err); }
});

// POST /api/merchant-kyc/aadhaar/verify
router.post("/aadhaar/verify", attemptLimiter, async (req: any, res, next) => {
  try {
    const merchantId = req.user.merchantId as number;
    const { otp } = req.body as Record<string, unknown>;
    const cfg = await loadAutoKycConfig();
    if (!cfg) {
      res.status(503).json({ error: "RasoKart KYC Verification is temporarily unavailable. Please try again later." });
      return;
    }

    const [row] = await db.select().from(merchantKycVerificationsTable).where(eq(merchantKycVerificationsTable.merchantId, merchantId)).limit(1);
    const refId = row ? safeDecrypt(row.aadhaarOtpSessionEncrypted, row.aadhaarOtpSessionIv, row.aadhaarOtpSessionTag) : null;
    if (!row || !refId) {
      res.status(400).json({ error: "Please request an OTP first." });
      return;
    }
    if (!otp || typeof otp !== "string") {
      res.status(400).json({ error: "OTP is required" });
      return;
    }

    const result = await verifyAadhaarOtp(cfg, refId, otp, merchantId);
    if (!result.ok) {
      await db.update(merchantKycVerificationsTable).set({
        verificationStatus: "AADHAAR_FAILED",
        failureReason: "Aadhaar OTP verification failed. Please try again.",
        updatedAt: new Date(),
      }).where(eq(merchantKycVerificationsTable.merchantId, merchantId));
      res.status(422).json({ error: "Aadhaar OTP verification failed. Please try again." });
      return;
    }

    const [merchant] = await db.select({ contactName: merchantsTable.contactName, businessName: merchantsTable.businessName }).from(merchantsTable).where(eq(merchantsTable.id, merchantId)).limit(1);
    const aadhaarName = result.name ?? "";
    const panName = row.panName ?? "";
    const merchantOwnerName = merchant?.contactName ?? "";

    const scorePanAadhaar = computeNameMatchScore(panName, aadhaarName);
    const scorePanOwner = computeNameMatchScore(panName, merchantOwnerName);
    const scoreAadhaarOwner = computeNameMatchScore(aadhaarName, merchantOwnerName);
    const finalScore = Math.min(scorePanAadhaar, scorePanOwner, scoreAadhaarOwner);

    const passed = finalScore >= cfg.minNameMatchScore;
    const newStatus = passed ? (cfg.autoApproveEnabled ? "APPROVED" : "NAME_MATCH_PENDING_REVIEW") : "NAME_MISMATCH";

    await db.update(merchantKycVerificationsTable).set({
      aadhaarLast4: result.last4 ?? null,
      aadhaarName,
      aadhaarVerified: true,
      aadhaarVerifiedAt: new Date(),
      aadhaarOtpSessionEncrypted: null,
      aadhaarOtpSessionIv: null,
      aadhaarOtpSessionTag: null,
      nameMatchScore: finalScore,
      verificationStatus: newStatus,
      failureReason: passed ? null : "Name on PAN/Aadhaar does not sufficiently match the registered business owner name.",
      updatedAt: new Date(),
    }).where(eq(merchantKycVerificationsTable.merchantId, merchantId));

    if (newStatus === "APPROVED") {
      await db.update(merchantsTable).set({ status: "approved", verificationStatus: "approved", rejectionReason: null } as any).where(eq(merchantsTable.id, merchantId));
      const [merchantRow] = await db.select({ email: merchantsTable.email }).from(merchantsTable).where(eq(merchantsTable.id, merchantId)).limit(1);
      if (merchantRow) {
        await db.update(usersTable).set({ isActive: true }).where(eq(usersTable.email, merchantRow.email));
      }
      await db.insert(auditLogsTable).values({
        adminEmail: "auto-kyc@rasokart.com",
        action: "merchant_auto_kyc_approved",
        targetType: "merchant",
        targetId: merchantId,
        details: JSON.stringify({ nameMatchScore: finalScore }),
        ipAddress: req.ip ?? null,
      } as any);
      req.log.info({ merchantId, finalScore }, "merchant_auto_kyc_approved");
    } else {
      req.log.info({ merchantId, finalScore, newStatus }, "merchant_auto_kyc_not_approved");
    }

    res.json({ ok: passed, status: newStatus, nameMatchScore: finalScore });
  } catch (err) { next(err); }
});

export default router;
