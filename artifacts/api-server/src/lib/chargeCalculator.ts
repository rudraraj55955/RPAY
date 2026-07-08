import { db } from "@workspace/db";
import { payinChargeSettingsTable, merchantChargeOverridesTable } from "@workspace/db";
import { eq } from "drizzle-orm";

type RoundingMode = "round" | "ceil" | "floor";

function applyRounding(value: number, mode: RoundingMode): number {
  const factor = 100;
  if (mode === "ceil")  return Math.ceil(value * factor)  / factor;
  if (mode === "floor") return Math.floor(value * factor) / factor;
  return Math.round(value * factor) / factor;
}

function toNum(v: string | number | null | undefined, fallback = 0): number {
  if (v == null) return fallback;
  const n = parseFloat(String(v));
  return isNaN(n) ? fallback : n;
}

export type ChargeResult = {
  payinFee: number;
  gstAmount: number;
  netAmount: number;
  grossAmount: number;
  chargesApplied: boolean;
};

export type EffectiveChargeSettings = {
  enabled: boolean;
  mdrPct: number;
  fixedFee: number;
  minFee: number;
  maxFee: number | null;
  gstPct: number;
  gstEnabled: boolean;
  roundingMode: RoundingMode;
  applyToOwnStaticUpi: boolean;
  applyToDynamicQr: boolean;
  applyToPaymentLinks: boolean;
  applyToApiGateway: boolean;
};

/**
 * Calculate payin fee + GST from gross amount and effective settings.
 * Returns net amount = gross − fee − gst.
 */
export function calculatePayinCharge(grossAmount: number, settings: EffectiveChargeSettings): ChargeResult {
  if (!settings.enabled || grossAmount <= 0) {
    return { payinFee: 0, gstAmount: 0, netAmount: grossAmount, grossAmount, chargesApplied: false };
  }

  const mode = settings.roundingMode;
  const mdrFee = grossAmount * (settings.mdrPct / 100);
  let fee = mdrFee + settings.fixedFee;

  // Apply min/max
  if (fee < settings.minFee) fee = settings.minFee;
  if (settings.maxFee != null && fee > settings.maxFee) fee = settings.maxFee;

  // Round fee
  fee = applyRounding(fee, mode);

  const gstAmount = settings.gstEnabled
    ? applyRounding(fee * (settings.gstPct / 100), mode)
    : 0;

  const total = fee + gstAmount;
  const netAmount = applyRounding(Math.max(0, grossAmount - total), mode);

  return { payinFee: fee, gstAmount, netAmount, grossAmount, chargesApplied: true };
}

/**
 * Resolve effective charge settings for a merchant.
 * Falls back to global settings if merchant has no override or useGlobal=true.
 * Merges custom fields over the global baseline.
 */
export async function resolveChargeSettings(merchantId: number): Promise<EffectiveChargeSettings> {
  // Always load global (needed as fallback baseline)
  const [global] = await db
    .select()
    .from(payinChargeSettingsTable)
    .where(eq(payinChargeSettingsTable.id, 1))
    .limit(1);

  const base: EffectiveChargeSettings = {
    enabled: global?.enabled ?? false,
    mdrPct: toNum(global?.mdrPct),
    fixedFee: toNum(global?.fixedFee),
    minFee: toNum(global?.minFee),
    maxFee: global?.maxFee != null ? toNum(global.maxFee) : null,
    gstPct: toNum(global?.gstPct, 18),
    gstEnabled: global?.gstEnabled ?? false,
    roundingMode: (global?.roundingMode as RoundingMode) ?? "round",
    applyToOwnStaticUpi: global?.applyToOwnStaticUpi ?? true,
    applyToDynamicQr: global?.applyToDynamicQr ?? true,
    applyToPaymentLinks: global?.applyToPaymentLinks ?? true,
    applyToApiGateway: global?.applyToApiGateway ?? true,
  };

  // Load merchant override
  const [override] = await db
    .select()
    .from(merchantChargeOverridesTable)
    .where(eq(merchantChargeOverridesTable.merchantId, merchantId))
    .limit(1);

  if (!override || override.useGlobal) return base;

  // Custom override — start from global but override fields that are set
  return {
    ...base,
    enabled: override.customEnabled,
    mdrPct:      override.mdrPct      != null ? toNum(override.mdrPct)      : base.mdrPct,
    fixedFee:    override.fixedFee    != null ? toNum(override.fixedFee)    : base.fixedFee,
    minFee:      override.minFee      != null ? toNum(override.minFee)      : base.minFee,
    maxFee:      override.maxFee      != null ? toNum(override.maxFee)      : base.maxFee,
    gstPct:      override.gstPct      != null ? toNum(override.gstPct)      : base.gstPct,
    gstEnabled:  override.gstEnabled  != null ? override.gstEnabled         : base.gstEnabled,
    roundingMode: (override.roundingMode as RoundingMode | null) ?? base.roundingMode,
  };
}
