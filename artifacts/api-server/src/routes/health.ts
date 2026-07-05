import { Router, type IRouter } from "express";
import { pool } from "@workspace/db";
import { logger } from "../lib/logger";

const router: IRouter = Router();

// Lightweight liveness check — no DB access, always fast, used by load
// balancers / uptime pingers that just need to know the process is up.
router.get("/health", (_req, res) => {
  res.json({ status: "ok" });
});

router.get("/healthz", (_req, res) => {
  res.json({ status: "ok" });
});

// Deep readiness check — verifies the DB connection AND the presence of the
// tables/columns most likely to drift on a fresh/older VPS deploy (see
// lib/schemaGuard.ts). Intended for deploy-time smoke tests
// (`curl .../api/healthz/deep`) so a missing-column 502 is caught by a
// health check immediately after deploy, instead of surfacing to a real
// user's first login attempt.
router.get("/healthz/deep", async (_req, res) => {
  const checks: Record<string, boolean> = {};
  let dbOk = true;

  try {
    await pool.query("SELECT 1");
    checks["database_connection"] = true;
  } catch (err) {
    dbOk = false;
    checks["database_connection"] = false;
    logger.error({ err }, "healthz_deep_db_connection_failed");
  }

  if (dbOk) {
    const tableChecks: Array<{ key: string; query: string }> = [
      { key: "users.is_super_admin", query: "SELECT is_super_admin FROM users LIMIT 1" },
      { key: "company_settings", query: "SELECT id FROM company_settings LIMIT 1" },
      { key: "merchant_auth_otps", query: "SELECT id FROM merchant_auth_otps LIMIT 1" },
      { key: "provider_integrations.is_custom", query: "SELECT is_custom FROM provider_integrations LIMIT 1" },
      { key: "routing_rules", query: "SELECT id FROM routing_rules LIMIT 1" },
      { key: "quiet_hours_queue.flushed", query: "SELECT flushed, deliver_after FROM quiet_hours_queue LIMIT 1" },
    ];

    for (const { key, query } of tableChecks) {
      try {
        await pool.query(query);
        checks[key] = true;
      } catch (err) {
        checks[key] = false;
        logger.error({ err, check: key }, "healthz_deep_schema_check_failed");
      }
    }
  }

  const allOk = Object.values(checks).every(Boolean);
  res.status(allOk ? 200 : 503).json({ status: allOk ? "ok" : "degraded", checks });
});

export default router;
