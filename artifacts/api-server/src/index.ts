import app from "./app";
import { logger } from "./lib/logger";
import { pool } from "@workspace/db";
import { seed } from "./seed";
import cron from "node-cron";
import { processPendingRetries } from "./helpers/callbackRetry";
import { initReconciliationScheduler } from "./helpers/reconScheduler";
import { initAuditReportScheduler } from "./helpers/auditReportScheduler";
import { startProviderLimitAlertScheduler, runProviderLimitAlertScan } from "./helpers/providerLimitScheduler";
import { initQrCleanupScheduler } from "./helpers/qrCleanupScheduler";
import { initVaCleanupScheduler } from "./helpers/vaCleanupScheduler";
import { initPlanExpiryScheduler } from "./helpers/planExpiryScheduler";
import { initPlanRenewalScheduler } from "./helpers/planRenewalScheduler";
import { initRateLimitCleanupScheduler } from "./helpers/rateLimitCleanupScheduler";
import { initTestEmailRetentionScheduler } from "./helpers/testEmailRetentionScheduler";
import { initAuditReportRetentionScheduler } from "./helpers/auditReportRetentionScheduler";
import { initDormantMerchantScheduler, runDormantMerchantScan } from "./helpers/dormantMerchantScheduler";
import { initEkqrSyncScheduler } from "./helpers/ekqrSyncScheduler";
import { initMerchantReportScheduler } from "./helpers/merchantReportScheduler";
import { initOverdueReportScheduler, runOverdueReportScan } from "./helpers/overdueReportScheduler";
import { initDeliveryHealthDigestScheduler } from "./helpers/reportDeliveryHealthEmail";
import { initDeliverySuccessRateAlertScheduler, runDeliverySuccessRateAlertScan } from "./helpers/deliverySuccessRateAlertScheduler";
import { flushAllReadyQuietHoursQueues } from "./helpers/quietHours";
import { db, systemConfigTable, SYSTEM_CONFIG_KEYS, SYSTEM_CONFIG_DEFAULTS } from "@workspace/db";
import { eq } from "drizzle-orm";
import { initNotifReminderScheduler, runNotifReminderScan } from "./helpers/notifReminderScheduler";
import { initSnoozeCleanupScheduler, runSnoozeCleanup } from "./helpers/snoozeCleanupScheduler";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

function scheduleCallbackRetryWorker() {
  cron.schedule("* * * * *", async () => {
    try {
      await processPendingRetries();
    } catch (err) {
      logger.error({ err }, "Callback retry worker failed");
    }
  });

  logger.info("Callback retry worker registered (runs every minute)");
}

async function getQuietHoursFlushIntervalMs(): Promise<number> {
  try {
    const [row] = await db
      .select({ value: systemConfigTable.value })
      .from(systemConfigTable)
      .where(eq(systemConfigTable.key, SYSTEM_CONFIG_KEYS.QUIET_HOURS_FLUSH_INTERVAL_SECONDS))
      .limit(1);
    const seconds = parseInt(
      row?.value ?? SYSTEM_CONFIG_DEFAULTS[SYSTEM_CONFIG_KEYS.QUIET_HOURS_FLUSH_INTERVAL_SECONDS]
    );
    return Math.max(10, seconds) * 1000;
  } catch {
    const fallbackMs = parseInt(process.env["QUIET_HOURS_FLUSH_INTERVAL_MS"] ?? "60000", 10);
    return fallbackMs;
  }
}

function initQuietHoursFlushScheduler() {
  const envFallbackMs = parseInt(process.env["QUIET_HOURS_FLUSH_INTERVAL_MS"] ?? "60000", 10);

  async function tick() {
    try {
      logger.info("Quiet hours flush: scanning for ready queues");
      const { usersProcessed, totalFlushed } = await flushAllReadyQuietHoursQueues();
      if (usersProcessed > 0) {
        logger.info({ usersProcessed, totalFlushed }, "Quiet hours flush complete");
      }
    } catch (err) {
      logger.error({ err }, "Quiet hours flush sweep failed");
    }
    const intervalMs = await getQuietHoursFlushIntervalMs();
    setTimeout(tick, intervalMs);
  }

  getQuietHoursFlushIntervalMs()
    .then((intervalMs) => {
      logger.info({ intervalMs }, "Quiet hours flush scheduler registered");
      setTimeout(tick, intervalMs);
    })
    .catch(() => {
      logger.info({ intervalMs: envFallbackMs }, "Quiet hours flush scheduler registered (env fallback)");
      setTimeout(tick, envFallbackMs);
    });
}

async function main() {
  try {
    await pool.query("SELECT 1");
    logger.info("Database connection verified");
  } catch (err) {
    logger.error({ err }, "Database health check failed — cannot start server");
    process.exit(1);
  }

  try {
    await seed();
    logger.info("Database seed complete");
  } catch (err) {
    logger.error({ err }, "Seed failed — cannot start server without baseline data");
    process.exit(1);
  }

  await initReconciliationScheduler();
  initAuditReportScheduler();
  startProviderLimitAlertScheduler();
  initQrCleanupScheduler();
  initVaCleanupScheduler();
  initPlanExpiryScheduler();
  initPlanRenewalScheduler();
  initRateLimitCleanupScheduler();
  initTestEmailRetentionScheduler();
  initAuditReportRetentionScheduler();
  initDormantMerchantScheduler();
  initEkqrSyncScheduler();
  initMerchantReportScheduler();
  initOverdueReportScheduler();
  initDeliveryHealthDigestScheduler();
  initDeliverySuccessRateAlertScheduler();
  initNotifReminderScheduler();
  initSnoozeCleanupScheduler();
  scheduleCallbackRetryWorker();
  initQuietHoursFlushScheduler();

  // Startup sweep: immediately scan all active connections so merchants receive
  // provider_limit_reset (and warning/reached) notifications even when the server
  // was down at the start of the month. The dedup indexes make this idempotent.
  runProviderLimitAlertScan().catch((err) => {
    logger.warn({ err }, "Startup provider limit sweep failed");
  });

  // Startup sweep: scan for newly dormant merchants so admins are alerted even
  // when the server was down at the scheduled run time. Dedup keys make this safe.
  runDormantMerchantScan().catch((err) => {
    logger.warn({ err }, "Startup dormant merchant sweep failed");
  });

  // Startup sweep: scan for overdue scheduled reports so admins are alerted even
  // when the server was down at the daily run time. Dedup keys make this safe.
  runOverdueReportScan().catch((err) => {
    logger.warn({ err }, "Startup overdue report sweep failed");
  });

  // Startup sweep: check delivery success rates so admins are alerted even when
  // the server was down at the scheduled run time. Dedup keys make this safe.
  runDeliverySuccessRateAlertScan().catch((err) => {
    logger.warn({ err }, "Startup delivery success-rate alert sweep failed");
  });

  // Startup sweep: send notif reminder emails to merchants who have had
  // notifications disabled for ≥30 days and haven't received a reminder yet.
  // notif_reminder_sent_at guards against duplicate sends within 30 days.
  runNotifReminderScan().catch((err) => {
    logger.warn({ err }, "Startup notif reminder sweep failed");
  });

  // Startup sweep: clear any snooze timestamps that expired while the server
  // was down so they don't linger until the next nightly run.
  runSnoozeCleanup().catch((err) => {
    logger.warn({ err }, "Startup snooze cleanup sweep failed");
  });

  


/* RASOKART_TPIPAY_PROVIDER_ROUTES_START */
type RkTpipaySettings = {
  providerStatus: "enabled" | "disabled";
  environment: "sandbox" | "live";
  collectionMode: "static" | "dynamic";
  apiToken: string;
  sellerIdentifier: string;
  createOrderEndpoint: string;
  checkTransactionEndpoint: string;
  callbackUrl: string;
  serverIp: string;
  minAmount: string;
  maxAmount: string;
  testAmount: string;
  services: Record<string, boolean>;
  updatedAt?: string;
};

const rkTpipayDataDir = `${process.cwd()}/data`;
const rkTpipaySettingsFile = `${rkTpipayDataDir}/tpipay-provider-settings.json`;
const rkTpipayCallbackLogFile = `${rkTpipayDataDir}/tpipay-callbacks.jsonl`;
const rkTpipayOrderLogFile = `${rkTpipayDataDir}/tpipay-orders.jsonl`;
const rkTpipayAuditLogFile = `${rkTpipayDataDir}/tpipay-audit.jsonl`;

function rkTpipayDefaultSettings(): RkTpipaySettings {
  return {
    providerStatus: "disabled",
    environment: "live",
    collectionMode: "dynamic",
    apiToken: process.env.TPIPAY_API_TOKEN || "",
    sellerIdentifier: process.env.TPIPAY_SELLER_IDENTIFIER || process.env.TPIPAY_PAYEE_VPA || "",
    createOrderEndpoint: process.env.TPIPAY_INTENT_URL || "https://banking.mytpipay.com/api/collect-payment/v1/createOrder",
    checkTransactionEndpoint: process.env.TPIPAY_CHECK_TRANSACTION_URL || "https://banking.mytpipay.com/api/collect-payment/v1/check-transaction",
    callbackUrl: process.env.TPIPAY_CALLBACK_URL || "https://rasokart.com/api/webhooks/tpipay",
    serverIp: process.env.PUBLIC_SERVER_IP || "167.233.77.68",
    minAmount: process.env.TPIPAY_MIN_AMOUNT || "1",
    maxAmount: process.env.TPIPAY_MAX_AMOUNT || "50000",
    testAmount: "1",
    services: {
      upiCollection: true,
      dynamicQr: true,
      staticCollection: true,
      checkTransaction: true,
      payinSettlement: true,
      payout: false,
      verifyKyc: false,
      reports: true,
      ledger: true,
      providerList: true,
    },
  };
}

async function rkTpipayFs() {
  return await import("node:fs");
}

async function rkTpipayEnsureDir() {
  const fs = await rkTpipayFs();
  if (!fs.existsSync(rkTpipayDataDir)) fs.mkdirSync(rkTpipayDataDir, { recursive: true, mode: 0o700 });
}

function rkTpipayMask(value: string) {
  if (!value) return "";
  if (value.length <= 16) return `${value.slice(0, 4)}...****`;
  return `${value.slice(0, 10)}...****...${value.slice(-6)}`;
}

async function rkTpipayReadSettings(): Promise<RkTpipaySettings> {
  await rkTpipayEnsureDir();
  const fs = await rkTpipayFs();
  const defaults = rkTpipayDefaultSettings();
  try {
    if (!fs.existsSync(rkTpipaySettingsFile)) return defaults;
    const parsed = JSON.parse(fs.readFileSync(rkTpipaySettingsFile, "utf8"));
    return { ...defaults, ...parsed, services: { ...defaults.services, ...(parsed.services || {}) } };
  } catch {
    return defaults;
  }
}

async function rkTpipayWriteSettings(settings: RkTpipaySettings) {
  await rkTpipayEnsureDir();
  const fs = await rkTpipayFs();
  fs.writeFileSync(rkTpipaySettingsFile, JSON.stringify(settings, null, 2), { mode: 0o600 });
  try { fs.chmodSync(rkTpipaySettingsFile, 0o600); } catch {}
}

function rkTpipayPublicSettings(settings: RkTpipaySettings) {
  const { apiToken, ...safe } = settings;
  return { ...safe, hasApiToken: Boolean(apiToken), apiTokenMasked: rkTpipayMask(apiToken) };
}

async function rkTpipayAppendJsonl(file: string, row: any) {
  await rkTpipayEnsureDir();
  const fs = await rkTpipayFs();
  fs.appendFileSync(file, JSON.stringify({ ...row, at: new Date().toISOString() }) + "\n", { mode: 0o600 });
  try { fs.chmodSync(file, 0o600); } catch {}
}

async function rkTpipayCurrentUser(req: any) {
  const header = String(req.headers?.authorization || "");
  const token = header.replace(/^Bearer\s+/i, "").trim();
  if (!token) return null;

  const secret =
    process.env.JWT_SECRET ||
    process.env.AUTH_SECRET ||
    process.env.ACCESS_TOKEN_SECRET ||
    process.env.SESSION_SECRET ||
    process.env.TOKEN_SECRET ||
    "";

  if (!secret) return null;

  try {
    const jwtMod: any = await import("jsonwebtoken");
    const jwt: any = jwtMod.default || jwtMod;
    const decoded: any = jwt.verify(token, secret);
    const role = String(decoded.role || decoded.user?.role || decoded.userRole || decoded.type || "").toLowerCase();
    const id = decoded.id || decoded.userId || decoded.user?.id || decoded.sub || "unknown";
    return { id, role, raw: decoded };
  } catch {
    return null;
  }
}

async function rkTpipayRequire(req: any, res: any, allowedRoles: string[]) {
  const user = await rkTpipayCurrentUser(req);
  if (!user || !allowedRoles.includes(user.role)) {
    res.status(401).json({ error: "Unauthorized" });
    return null;
  }
  return user;
}

app.get("/api/admin/tpipay-provider-settings", async (req: any, res: any) => {
  const user = await rkTpipayRequire(req, res, ["admin", "super_admin", "superadmin", "merchant"]);
  if (!user) return;
  const settings = await rkTpipayReadSettings();
  res.json({ settings: rkTpipayPublicSettings(settings) });
});

app.post("/api/admin/tpipay-provider-settings", async (req: any, res: any) => {
  const user = await rkTpipayRequire(req, res, ["admin", "super_admin", "superadmin"]);
  if (!user) return;

  const oldSettings = await rkTpipayReadSettings();
  const body = req.body || {};

  const updated: RkTpipaySettings = {
    ...oldSettings,
    providerStatus: body.providerStatus === "enabled" ? "enabled" : "disabled",
    environment: body.environment === "sandbox" ? "sandbox" : "live",
    collectionMode: body.collectionMode === "static" ? "static" : "dynamic",
    sellerIdentifier: String(body.sellerIdentifier || "").trim(),
    createOrderEndpoint: String(body.createOrderEndpoint || oldSettings.createOrderEndpoint).trim(),
    checkTransactionEndpoint: String(body.checkTransactionEndpoint || oldSettings.checkTransactionEndpoint).trim(),
    callbackUrl: String(body.callbackUrl || oldSettings.callbackUrl).trim(),
    serverIp: String(body.serverIp || oldSettings.serverIp).trim(),
    minAmount: String(body.minAmount || oldSettings.minAmount).trim(),
    maxAmount: String(body.maxAmount || oldSettings.maxAmount).trim(),
    testAmount: String(body.testAmount || oldSettings.testAmount || "1").trim(),
    services: { ...(oldSettings.services || {}), ...(body.services || {}) },
    updatedAt: new Date().toISOString(),
  };

  if (typeof body.apiToken === "string" && body.apiToken.trim()) {
    updated.apiToken = body.apiToken.trim();
  }

  if (updated.collectionMode === "dynamic" && !updated.sellerIdentifier) {
    res.status(400).json({ error: "sellerIdentifier is required for Dynamic QR collection." });
    return;
  }

  await rkTpipayWriteSettings(updated);
  await rkTpipayAppendJsonl(rkTpipayAuditLogFile, {
    event: "tpipay_provider_settings_updated",
    actor_id: user.id,
    actor_role: user.role,
    collectionMode: updated.collectionMode,
    providerStatus: updated.providerStatus,
  });

  res.json({ settings: rkTpipayPublicSettings(updated) });
});

app.post("/api/admin/tpipay-provider-settings/test-qr", async (req: any, res: any) => {
  const user = await rkTpipayRequire(req, res, ["admin", "super_admin", "superadmin"]);
  if (!user) return;

  const settings = await rkTpipayReadSettings();

  if (settings.providerStatus !== "enabled") {
    res.status(400).json({ error: "Provider is disabled. Enable provider first." });
    return;
  }
  if (!settings.apiToken) {
    res.status(400).json({ error: "API token is required." });
    return;
  }
  if (settings.collectionMode === "dynamic" && !settings.sellerIdentifier) {
    res.status(400).json({ error: "sellerIdentifier is required for Dynamic QR collection." });
    return;
  }

  const amount = Number(req.body?.amount || settings.testAmount || 1);
  if (!Number.isFinite(amount) || amount <= 0) {
    res.status(400).json({ error: "Valid test amount is required." });
    return;
  }

  const clientId = `RK_TEST_${Date.now()}`;
  const payload = {
    api_token: settings.apiToken,
    isDynamic: settings.collectionMode === "dynamic" ? 1 : 0,
    sellerIdentifier: settings.sellerIdentifier,
    amount,
    callback_url: settings.callbackUrl,
  };

  try {
    const providerRes = await fetch(settings.createOrderEndpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(payload),
    });

    const raw = await providerRes.text();
    let json: any = null;
    try { json = JSON.parse(raw); } catch { json = { raw }; }

    const data = json?.data || {};
    const safeData = {
      vpa: data.vpa || json?.vpa || "",
      qrString: data.qrString || json?.qrString || "",
      order_id: data.order_id || data.orderId || json?.order_id || json?.orderId || "",
      client_id: data.client_id || json?.client_id || clientId,
      status: json?.status || "",
      message: json?.message || "",
    };

    await rkTpipayAppendJsonl(rkTpipayOrderLogFile, {
      event: "tpipay_test_qr",
      actor_id: user.id,
      actor_role: user.role,
      http_status: providerRes.status,
      amount,
      has_qr: Boolean(safeData.qrString || safeData.vpa),
      provider_status: safeData.status,
      provider_message: safeData.message,
    });

    res.status(providerRes.ok ? 200 : 502).json({
      ok: providerRes.ok,
      httpStatus: providerRes.status,
      message: safeData.message || "Provider response received",
      data: safeData,
      providerResponse: json,
    });
  } catch (err: any) {
    res.status(502).json({ error: err?.message || "Provider request failed" });
  }
});

app.post(
  "/api/webhooks/tpipay",
  async (req: any, res: any) => {
    const body = req.body || {};
    const status = String(body.status || "").toLowerCase();
    const isSuccess = status === "credit" || status === "success";

    await rkTpipayAppendJsonl(rkTpipayCallbackLogFile, {
      event: "tpipay_callback_received",
      success: isSuccess,
      status: body.status,
      amount: body.amount,
      client_id: body.client_id,
      order_id: body.order_id,
      utr: body.utr,
      receiver_vpa: body.receiver_vpa,
      PayerName: body.PayerName,
      PayerVPA: body.PayerVPA,
      raw: body,
    });

    res.json({ status: "success", message: "Callback received and processed successfully." });
  }
);
/* RASOKART_TPIPAY_PROVIDER_ROUTES_END */


app.listen(port, (err) => {
    if (err) {
      logger.error({ err }, "Error listening on port");
      process.exit(1);
    }
    logger.info({ port }, "Server listening");
  });
}

main();
