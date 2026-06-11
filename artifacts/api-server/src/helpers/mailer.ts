import {
  type SmtpConfig,
  type MailOptions,
  getSmtpConfigFromEnv,
  sendMailWithConfig,
} from "@workspace/mailer";
import { logger } from "../lib/logger";
import { db, systemSettingsTable } from "@workspace/db";
import { inArray } from "drizzle-orm";

export type { SmtpConfig, MailOptions };

export async function getSmtpConfig(): Promise<SmtpConfig | null> {
  const KEYS = ["smtp_host", "smtp_port", "smtp_user", "smtp_pass", "smtp_from"] as const;

  let dbConfig: Record<string, string | null | undefined> = {};
  try {
    const rows = await db
      .select()
      .from(systemSettingsTable)
      .where(inArray(systemSettingsTable.key, [...KEYS]));
    dbConfig = Object.fromEntries(rows.map(r => [r.key, r.value]));
  } catch {
    // DB unavailable — fall back to env vars only
  }

  const host = dbConfig["smtp_host"] ?? process.env["SMTP_HOST"] ?? null;
  const user = dbConfig["smtp_user"] ?? process.env["SMTP_USER"] ?? null;
  const pass = dbConfig["smtp_pass"] ?? process.env["SMTP_PASS"] ?? null;

  if (!host || !user || !pass) return null;

  const portRaw = dbConfig["smtp_port"] ?? process.env["SMTP_PORT"] ?? "587";
  const port = parseInt(portRaw as string, 10);
  const from =
    dbConfig["smtp_from"] ?? process.env["SMTP_FROM"] ?? "RasoKart <noreply@rasokart.com>";

  return { host, port: isNaN(port) ? 587 : port, user, pass, from };
}

export async function sendMail(opts: MailOptions): Promise<boolean> {
  const cfg = await getSmtpConfig();
  if (!cfg) {
    logger.warn("SMTP not configured (SMTP_HOST, SMTP_USER, SMTP_PASS required) — skipping email");
    return false;
  }

  const ok = await sendMailWithConfig(cfg, opts);
  if (ok) {
    logger.info({ to: opts.to, cc: opts.cc, subject: opts.subject }, "Email sent successfully");
  } else {
    logger.error({ to: opts.to, subject: opts.subject }, "Failed to send email");
  }
  return ok;
}

export { getSmtpConfigFromEnv };
