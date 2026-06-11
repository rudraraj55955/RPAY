import { getSmtpConfigFromEnv, sendMailWithConfig } from "@workspace/mailer";

const ADMIN_EMAIL =
  process.env["ADMIN_EMAIL"] ?? "admin@rasokart.com";

export async function sendAdminAlert(opts: {
  subject: string;
  html: string;
}): Promise<void> {
  const cfg = getSmtpConfigFromEnv();
  if (!cfg) {
    console.warn(
      "MAILER: SMTP not configured (SMTP_HOST, SMTP_USER, SMTP_PASS required) — skipping alert email",
    );
    return;
  }

  const ok = await sendMailWithConfig(cfg, {
    to: ADMIN_EMAIL,
    subject: opts.subject,
    html: opts.html,
  });

  if (ok) {
    console.log(`MAILER: Alert email sent to ${ADMIN_EMAIL}`);
  } else {
    console.error(`MAILER: Failed to send alert email to ${ADMIN_EMAIL}`);
  }
}
