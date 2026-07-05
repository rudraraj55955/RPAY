import { db, systemConfigTable, SYSTEM_CONFIG_KEYS, SYSTEM_CONFIG_DEFAULTS } from "@workspace/db";
import { inArray } from "drizzle-orm";
import type { CashfreeEnv } from "./cashfree";

/**
 * Single source of truth for loading the live RasoKart Payin (Cashfree) gateway
 * configuration. Shared by the merchant deposit-creation route and the
 * admin-only diagnostic route so both always read the exact same settings —
 * no risk of the two drifting out of sync.
 */
export async function loadPayinConfig() {
  const keys = [
    SYSTEM_CONFIG_KEYS.CASHFREE_CLIENT_ID,
    SYSTEM_CONFIG_KEYS.CASHFREE_CLIENT_SECRET,
    SYSTEM_CONFIG_KEYS.CASHFREE_ENV,
    SYSTEM_CONFIG_KEYS.CASHFREE_ENABLED,
    SYSTEM_CONFIG_KEYS.CASHFREE_BASE_URL,
    SYSTEM_CONFIG_KEYS.CASHFREE_API_VERSION,
    SYSTEM_CONFIG_KEYS.CASHFREE_UPI_ENABLED,
    SYSTEM_CONFIG_KEYS.CASHFREE_MERCHANT_PAYIN_ENABLED,
    SYSTEM_CONFIG_KEYS.CASHFREE_MIN_AMOUNT,
    SYSTEM_CONFIG_KEYS.CASHFREE_MAX_AMOUNT,
    SYSTEM_CONFIG_KEYS.CASHFREE_DAILY_LIMIT,
  ];
  const rows = await db.select().from(systemConfigTable).where(inArray(systemConfigTable.key, keys));
  const cfg = new Map(rows.map((r) => [r.key, r.value]));
  return {
    clientId: cfg.get(SYSTEM_CONFIG_KEYS.CASHFREE_CLIENT_ID) ?? "",
    rawClientSecret: cfg.get(SYSTEM_CONFIG_KEYS.CASHFREE_CLIENT_SECRET) ?? "",
    env: (cfg.get(SYSTEM_CONFIG_KEYS.CASHFREE_ENV) ?? "test") as CashfreeEnv,
    enabled: cfg.get(SYSTEM_CONFIG_KEYS.CASHFREE_ENABLED) === "true",
    baseUrl: cfg.get(SYSTEM_CONFIG_KEYS.CASHFREE_BASE_URL) || undefined,
    apiVersion: cfg.get(SYSTEM_CONFIG_KEYS.CASHFREE_API_VERSION) || undefined,
    upiEnabled: (cfg.get(SYSTEM_CONFIG_KEYS.CASHFREE_UPI_ENABLED) ?? SYSTEM_CONFIG_DEFAULTS[SYSTEM_CONFIG_KEYS.CASHFREE_UPI_ENABLED]) !== "false",
    merchantPayinEnabled: (cfg.get(SYSTEM_CONFIG_KEYS.CASHFREE_MERCHANT_PAYIN_ENABLED) ?? SYSTEM_CONFIG_DEFAULTS[SYSTEM_CONFIG_KEYS.CASHFREE_MERCHANT_PAYIN_ENABLED]) !== "false",
    minAmount: parseFloat(cfg.get(SYSTEM_CONFIG_KEYS.CASHFREE_MIN_AMOUNT) ?? SYSTEM_CONFIG_DEFAULTS[SYSTEM_CONFIG_KEYS.CASHFREE_MIN_AMOUNT]),
    maxAmount: parseFloat(cfg.get(SYSTEM_CONFIG_KEYS.CASHFREE_MAX_AMOUNT) ?? SYSTEM_CONFIG_DEFAULTS[SYSTEM_CONFIG_KEYS.CASHFREE_MAX_AMOUNT]),
    dailyLimit: parseFloat(cfg.get(SYSTEM_CONFIG_KEYS.CASHFREE_DAILY_LIMIT) ?? SYSTEM_CONFIG_DEFAULTS[SYSTEM_CONFIG_KEYS.CASHFREE_DAILY_LIMIT]),
  };
}

export type PayinConfig = Awaited<ReturnType<typeof loadPayinConfig>>;
