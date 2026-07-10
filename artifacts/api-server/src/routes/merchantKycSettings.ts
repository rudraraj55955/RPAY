import { Router } from "express";
import { db, merchantKycSettingsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { requireAuth, requireAdmin, requireSuperAdmin } from "../middlewares/auth";
import { encryptValue, safeDecrypt } from "../helpers/encryptionHelper";
import { testAutoKycConnection } from "../helpers/merchantAutoKycProvider";

const router = Router();
router.use(requireAuth, requireAdmin);

const MASKED = "••••••••••••••••";

function safeRow(row: any) {
  return {
    id: row.id,
    mode: row.mode,
    clientIdSet: !!row.clientIdEncrypted,
    clientSecretSet: !!row.clientSecretEncrypted,
    baseUrl: row.baseUrl,
    panApiEnabled: row.panApiEnabled,
    aadhaarApiEnabled: row.aadhaarApiEnabled,
    minNameMatchScore: row.minNameMatchScore,
    autoApproveEnabled: row.autoApproveEnabled,
    duplicateCheckEnabled: row.duplicateCheckEnabled,
    dailyVerificationLimit: row.dailyVerificationLimit,
    perMerchantAttemptLimit: row.perMerchantAttemptLimit,
    updatedByEmail: row.updatedByEmail,
    updatedAt: row.updatedAt,
  };
}

const DEFAULT_ROW = {
  id: 1, mode: "test", clientIdEncrypted: null, clientSecretEncrypted: null,
  baseUrl: null, panApiEnabled: true, aadhaarApiEnabled: true,
  minNameMatchScore: 80, autoApproveEnabled: true, duplicateCheckEnabled: true,
  dailyVerificationLimit: 200, perMerchantAttemptLimit: 5,
  updatedByEmail: null, updatedAt: null,
};

// GET /api/admin/merchant-kyc-settings
router.get("/", async (_req, res, next) => {
  try {
    const [row] = await db.select().from(merchantKycSettingsTable).where(eq(merchantKycSettingsTable.id, 1)).limit(1);
    res.json(safeRow(row ?? DEFAULT_ROW));
  } catch (err) { next(err); }
});

// PUT /api/admin/merchant-kyc-settings (super admin only)
router.put("/", requireSuperAdmin, async (req, res, next) => {
  try {
    const user = (req as any).user;
    const {
      mode, clientId, clientSecret, baseUrl, panApiEnabled, aadhaarApiEnabled,
      minNameMatchScore, autoApproveEnabled, duplicateCheckEnabled,
      dailyVerificationLimit, perMerchantAttemptLimit,
    } = req.body as Record<string, unknown>;

    const [existing] = await db.select().from(merchantKycSettingsTable).where(eq(merchantKycSettingsTable.id, 1)).limit(1);

    const update: Record<string, unknown> = { updatedByEmail: user.email };
    if (mode !== undefined) update["mode"] = String(mode);
    if (baseUrl !== undefined) update["baseUrl"] = baseUrl ? String(baseUrl) : null;
    if (panApiEnabled !== undefined) update["panApiEnabled"] = Boolean(panApiEnabled);
    if (aadhaarApiEnabled !== undefined) update["aadhaarApiEnabled"] = Boolean(aadhaarApiEnabled);
    if (minNameMatchScore !== undefined) update["minNameMatchScore"] = Math.max(0, Math.min(100, Number(minNameMatchScore)));
    if (autoApproveEnabled !== undefined) update["autoApproveEnabled"] = Boolean(autoApproveEnabled);
    if (duplicateCheckEnabled !== undefined) update["duplicateCheckEnabled"] = Boolean(duplicateCheckEnabled);
    if (dailyVerificationLimit !== undefined) update["dailyVerificationLimit"] = Math.max(1, Number(dailyVerificationLimit));
    if (perMerchantAttemptLimit !== undefined) update["perMerchantAttemptLimit"] = Math.max(1, Number(perMerchantAttemptLimit));

    if (clientId && typeof clientId === "string" && clientId !== MASKED) {
      const enc = encryptValue(clientId.trim());
      update["clientIdEncrypted"] = enc.encrypted;
      update["clientIdIv"] = enc.iv;
      update["clientIdTag"] = enc.tag;
    }
    if (clientSecret && typeof clientSecret === "string" && clientSecret !== MASKED) {
      const enc = encryptValue(clientSecret.trim());
      update["clientSecretEncrypted"] = enc.encrypted;
      update["clientSecretIv"] = enc.iv;
      update["clientSecretTag"] = enc.tag;
    }

    let row: any;
    if (existing) {
      [row] = await db.update(merchantKycSettingsTable).set(update as any).where(eq(merchantKycSettingsTable.id, 1)).returning();
    } else {
      [row] = await db.insert(merchantKycSettingsTable).values({ id: 1, ...update } as any).returning();
    }
    req.log.info({ mode: row.mode, updatedBy: user.email }, "merchant_kyc_settings_updated");
    res.json(safeRow(row));
  } catch (err) { next(err); }
});

// POST /api/admin/merchant-kyc-settings/test — verify credentials work
router.post("/test", requireSuperAdmin, async (req, res, next) => {
  try {
    const [row] = await db.select().from(merchantKycSettingsTable).where(eq(merchantKycSettingsTable.id, 1)).limit(1);
    if (!row) { res.status(400).json({ ok: false, message: "No settings configured" }); return; }
    const clientId = safeDecrypt(row.clientIdEncrypted, row.clientIdIv, row.clientIdTag);
    const clientSecret = safeDecrypt(row.clientSecretEncrypted, row.clientSecretIv, row.clientSecretTag);
    if (!clientId || !clientSecret) { res.status(400).json({ ok: false, message: "Credentials not configured" }); return; }

    const result = await testAutoKycConnection({
      mode: row.mode,
      clientId,
      clientSecret,
      baseUrl: row.baseUrl || (row.mode === "live" ? "https://api.cashfree.com" : "https://sandbox.cashfree.com"),
      minNameMatchScore: row.minNameMatchScore,
      autoApproveEnabled: row.autoApproveEnabled,
      duplicateCheckEnabled: row.duplicateCheckEnabled,
      dailyVerificationLimit: row.dailyVerificationLimit,
      perMerchantAttemptLimit: row.perMerchantAttemptLimit,
      panApiEnabled: row.panApiEnabled,
      aadhaarApiEnabled: row.aadhaarApiEnabled,
    });
    req.log.info({ ok: result.ok, mode: row.mode }, "merchant_kyc_credential_test");
    res.json(result);
  } catch (err: any) {
    res.json({ ok: false, message: "Connection failed — check network or provider URL" });
  }
});

export default router;
