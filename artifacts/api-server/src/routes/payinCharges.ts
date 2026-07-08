/**
 * Admin Payin Charge Settings
 *
 * GET  /api/admin/payin-charges              → global singleton settings
 * PUT  /api/admin/payin-charges              → update global settings (audit logged)
 * GET  /api/admin/payin-charges/merchants/:id → merchant override (auto-creates row if absent)
 * PUT  /api/admin/payin-charges/merchants/:id → upsert merchant override (audit logged)
 * GET  /api/admin/payin-charges/preview      → calculate charge for ?amount=&merchantId=
 */

import { Router } from "express";
import { db, payinChargeSettingsTable, merchantChargeOverridesTable, auditLogsTable, merchantsTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { requireAuth, requireAdmin } from "../middlewares/auth";
import { resolveChargeSettings, calculatePayinCharge } from "../lib/chargeCalculator";

const router = Router();
router.use(requireAuth, requireAdmin);

function fmtNum(n: number, scale = 2) {
  return n.toFixed(scale);
}

function toNum(v: string | number | null | undefined, fallback = 0): number {
  if (v == null) return fallback;
  const n = parseFloat(String(v));
  return isNaN(n) ? fallback : n;
}

function serializeGlobal(row: typeof payinChargeSettingsTable.$inferSelect) {
  return {
    id: row.id,
    enabled: row.enabled,
    mdrPct: toNum(row.mdrPct),
    fixedFee: toNum(row.fixedFee),
    minFee: toNum(row.minFee),
    maxFee: row.maxFee != null ? toNum(row.maxFee) : null,
    gstPct: toNum(row.gstPct, 18),
    gstEnabled: row.gstEnabled,
    roundingMode: row.roundingMode,
    applyToOwnStaticUpi: row.applyToOwnStaticUpi,
    applyToDynamicQr: row.applyToDynamicQr,
    applyToPaymentLinks: row.applyToPaymentLinks,
    applyToApiGateway: row.applyToApiGateway,
    updatedAt: row.updatedAt,
    updatedByEmail: row.updatedByEmail,
  };
}

function serializeOverride(row: typeof merchantChargeOverridesTable.$inferSelect) {
  return {
    id: row.id,
    merchantId: row.merchantId,
    useGlobal: row.useGlobal,
    customEnabled: row.customEnabled,
    mdrPct:   row.mdrPct   != null ? toNum(row.mdrPct)   : null,
    fixedFee: row.fixedFee != null ? toNum(row.fixedFee) : null,
    minFee:   row.minFee   != null ? toNum(row.minFee)   : null,
    maxFee:   row.maxFee   != null ? toNum(row.maxFee)   : null,
    gstPct:   row.gstPct   != null ? toNum(row.gstPct)   : null,
    gstEnabled: row.gstEnabled ?? null,
    roundingMode: row.roundingMode ?? null,
    notes: row.notes ?? null,
    updatedAt: row.updatedAt,
    updatedByEmail: row.updatedByEmail ?? null,
  };
}

// ── GET /api/admin/payin-charges ─────────────────────────────────────────────
router.get("/", async (req, res, next) => {
  try {
    let [row] = await db.select().from(payinChargeSettingsTable).where(eq(payinChargeSettingsTable.id, 1)).limit(1);
    if (!row) {
      [row] = await db.insert(payinChargeSettingsTable).values({ id: 1 }).returning();
    }
    res.json(serializeGlobal(row));
  } catch (err) { next(err); }
});

// ── PUT /api/admin/payin-charges ─────────────────────────────────────────────
router.put("/", async (req, res, next) => {
  try {
    const adminEmail: string = (req as any).user.email;
    const adminId:    number = (req as any).user.id;
    const body = req.body as {
      enabled?: boolean;
      mdrPct?: number;
      fixedFee?: number;
      minFee?: number;
      maxFee?: number | null;
      gstPct?: number;
      gstEnabled?: boolean;
      roundingMode?: string;
      applyToOwnStaticUpi?: boolean;
      applyToDynamicQr?: boolean;
      applyToPaymentLinks?: boolean;
      applyToApiGateway?: boolean;
    };

    const updates: Partial<typeof payinChargeSettingsTable.$inferInsert> = {};
    if (body.enabled         !== undefined) updates.enabled             = body.enabled;
    if (body.mdrPct          !== undefined) updates.mdrPct              = fmtNum(body.mdrPct ?? 0, 4);
    if (body.fixedFee        !== undefined) updates.fixedFee            = fmtNum(body.fixedFee ?? 0);
    if (body.minFee          !== undefined) updates.minFee              = fmtNum(body.minFee ?? 0);
    if ("maxFee" in body)                   updates.maxFee              = body.maxFee != null ? fmtNum(body.maxFee) : null;
    if (body.gstPct          !== undefined) updates.gstPct              = fmtNum(body.gstPct ?? 18, 4);
    if (body.gstEnabled      !== undefined) updates.gstEnabled          = body.gstEnabled;
    if (body.roundingMode    !== undefined) updates.roundingMode        = body.roundingMode;
    if (body.applyToOwnStaticUpi !== undefined) updates.applyToOwnStaticUpi = body.applyToOwnStaticUpi;
    if (body.applyToDynamicQr    !== undefined) updates.applyToDynamicQr    = body.applyToDynamicQr;
    if (body.applyToPaymentLinks !== undefined) updates.applyToPaymentLinks = body.applyToPaymentLinks;
    if (body.applyToApiGateway   !== undefined) updates.applyToApiGateway   = body.applyToApiGateway;
    updates.updatedByEmail = adminEmail;

    // Ensure singleton row exists then update
    let [existing] = await db.select().from(payinChargeSettingsTable).where(eq(payinChargeSettingsTable.id, 1)).limit(1);
    if (!existing) {
      [existing] = await db.insert(payinChargeSettingsTable).values({ id: 1 }).returning();
    }

    const [updated] = await db
      .update(payinChargeSettingsTable)
      .set(updates)
      .where(eq(payinChargeSettingsTable.id, 1))
      .returning();

    await db.insert(auditLogsTable).values({
      adminId,
      adminEmail,
      action: "payin_charges_updated",
      targetType: "payin_charge_settings",
      targetId: 1,
      details: JSON.stringify({ changes: updates }),
    });

    req.log.info({ adminEmail }, "payin_charges_global_updated");
    res.json(serializeGlobal(updated));
  } catch (err) { next(err); }
});

// ── GET /api/admin/payin-charges/merchants/:id ────────────────────────────────
router.get("/merchants/:id", async (req, res, next) => {
  try {
    const merchantId = parseInt(req.params["id"] as string);
    if (isNaN(merchantId)) { res.status(400).json({ error: "Invalid merchant id" }); return; }

    // Verify merchant exists
    const [m] = await db.select({ id: merchantsTable.id }).from(merchantsTable)
      .where(eq(merchantsTable.id, merchantId)).limit(1);
    if (!m) { res.status(404).json({ error: "Merchant not found" }); return; }

    let [row] = await db.select().from(merchantChargeOverridesTable)
      .where(eq(merchantChargeOverridesTable.merchantId, merchantId)).limit(1);
    if (!row) {
      [row] = await db.insert(merchantChargeOverridesTable)
        .values({ merchantId, useGlobal: true, customEnabled: false })
        .returning();
    }
    res.json(serializeOverride(row));
  } catch (err) { next(err); }
});

// ── PUT /api/admin/payin-charges/merchants/:id ────────────────────────────────
router.put("/merchants/:id", async (req, res, next) => {
  try {
    const merchantId = parseInt(req.params["id"] as string);
    if (isNaN(merchantId)) { res.status(400).json({ error: "Invalid merchant id" }); return; }
    const adminEmail: string = (req as any).user.email;
    const adminId:    number = (req as any).user.id;

    const body = req.body as {
      useGlobal?: boolean;
      customEnabled?: boolean;
      mdrPct?: number | null;
      fixedFee?: number | null;
      minFee?: number | null;
      maxFee?: number | null;
      gstPct?: number | null;
      gstEnabled?: boolean | null;
      roundingMode?: string | null;
      notes?: string | null;
    };

    const values: Partial<typeof merchantChargeOverridesTable.$inferInsert> = {
      merchantId,
      updatedByEmail: adminEmail,
    };
    if (body.useGlobal       !== undefined) values.useGlobal       = body.useGlobal;
    if (body.customEnabled   !== undefined) values.customEnabled   = body.customEnabled;
    if (body.mdrPct          !== undefined) values.mdrPct          = body.mdrPct   != null ? fmtNum(body.mdrPct, 4)   : null;
    if (body.fixedFee        !== undefined) values.fixedFee        = body.fixedFee != null ? fmtNum(body.fixedFee)    : null;
    if (body.minFee          !== undefined) values.minFee          = body.minFee   != null ? fmtNum(body.minFee)      : null;
    if ("maxFee" in body)                   values.maxFee          = body.maxFee   != null ? fmtNum(body.maxFee)      : null;
    if (body.gstPct          !== undefined) values.gstPct          = body.gstPct   != null ? fmtNum(body.gstPct, 4)  : null;
    if (body.gstEnabled      !== undefined) values.gstEnabled      = body.gstEnabled;
    if (body.roundingMode    !== undefined) values.roundingMode    = body.roundingMode;
    if (body.notes           !== undefined) values.notes           = body.notes;

    const [row] = await db
      .insert(merchantChargeOverridesTable)
      .values({ merchantId, useGlobal: true, customEnabled: false, ...values })
      .onConflictDoUpdate({ target: merchantChargeOverridesTable.merchantId, set: values })
      .returning();

    await db.insert(auditLogsTable).values({
      adminId,
      adminEmail,
      action: "merchant_charge_override_updated",
      targetType: "merchant",
      targetId: merchantId,
      details: JSON.stringify({ changes: values }),
    });

    req.log.info({ adminEmail, merchantId }, "merchant_charge_override_updated");
    res.json(serializeOverride(row));
  } catch (err) { next(err); }
});

// ── GET /api/admin/payin-charges/preview ─────────────────────────────────────
// ?amount=1000&merchantId=5
router.get("/preview", async (req, res, next) => {
  try {
    const gross = parseFloat((req.query["amount"] as string) ?? "0");
    const mid   = req.query["merchantId"] ? parseInt(req.query["merchantId"] as string) : null;

    if (isNaN(gross) || gross < 0) { res.status(400).json({ error: "Invalid amount" }); return; }

    const settings = mid != null && !isNaN(mid)
      ? await resolveChargeSettings(mid)
      : await resolveChargeSettings(0).catch(() => null);

    if (!settings) { res.status(400).json({ error: "Could not load charge settings" }); return; }

    const result = calculatePayinCharge(gross, settings);
    res.json({
      grossAmount: result.grossAmount,
      payinFee:    result.payinFee,
      gstAmount:   result.gstAmount,
      netAmount:   result.netAmount,
      chargesApplied: result.chargesApplied,
    });
  } catch (err) { next(err); }
});

export default router;
