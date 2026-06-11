import { sendMail } from "./mailer";
import { logger } from "../lib/logger";

const APP_DOMAIN = process.env["APP_DOMAIN"] ?? "https://rasokart.com";

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#x27;");
}

function buildWebhookSecretReminderHtml(opts: {
  businessName: string;
  daysSince: number;
  isOverdue: boolean;
  webhookSettingsUrl: string;
}): string {
  const { businessName, daysSince, isOverdue, webhookSettingsUrl } = opts;

  const headerBg = isOverdue ? "#7f1d1d" : "#78350f";
  const accentColor = isOverdue ? "#f87171" : "#fb923c";
  const badgeLabel = isOverdue ? "OVERDUE" : "REMINDER";
  const headline = isOverdue
    ? "Callback Secret Rotation Overdue"
    : "Callback Secret Rotation Recommended";
  const intro = isOverdue
    ? `Your callback signing secret is <strong style="color:${accentColor};">${daysSince} days old</strong> — it is now overdue for rotation. Webhook signature verification may be at risk. Please rotate your secret immediately.`
    : `Your callback signing secret is <strong style="color:${accentColor};">${daysSince} days old</strong>. We recommend rotating it every 90 days to keep your webhook integrations secure.`;

  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${escapeHtml(headline)} — RasoKart</title>
</head>
<body style="margin:0;padding:0;background:#0f0f0f;font-family:'Segoe UI',Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#0f0f0f;padding:40px 0;">
    <tr>
      <td align="center">
        <table width="600" cellpadding="0" cellspacing="0" style="background:#1a1a1a;border-radius:12px;overflow:hidden;border:1px solid #2a2a2a;">

          <!-- Header -->
          <tr>
            <td style="background:#111;padding:32px 40px;border-bottom:1px solid #2a2a2a;">
              <span style="font-size:22px;font-weight:700;color:#fff;letter-spacing:-0.5px;">
                Raso<span style="color:#f97316;">Kart</span>
              </span>
            </td>
          </tr>

          <!-- Banner -->
          <tr>
            <td style="background:${headerBg};padding:20px 40px;">
              <table width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td>
                    <span style="display:inline-block;background:${accentColor};color:#000;font-size:11px;font-weight:700;letter-spacing:0.08em;padding:3px 8px;border-radius:4px;text-transform:uppercase;">${badgeLabel}</span>
                    <h1 style="margin:8px 0 4px;font-size:20px;font-weight:600;color:#fff;">${escapeHtml(headline)}</h1>
                    <p style="margin:0;font-size:13px;color:#fde68a;">Security hygiene for your webhook integrations</p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Body -->
          <tr>
            <td style="padding:36px 40px;">
              <p style="margin:0 0 20px;font-size:15px;color:#d1d5db;line-height:1.6;">
                Dear <strong style="color:#fff;">${escapeHtml(businessName)}</strong>,
              </p>

              <p style="margin:0 0 24px;font-size:15px;color:#d1d5db;line-height:1.6;">
                ${intro}
              </p>

              <!-- Info box -->
              <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:28px;">
                <tr>
                  <td style="background:#111;border-left:3px solid ${accentColor};border-radius:6px;padding:16px 20px;">
                    <p style="margin:0 0 10px;font-size:12px;font-weight:600;color:${accentColor};text-transform:uppercase;letter-spacing:0.05em;">Secret Status</p>
                    <table width="100%" cellpadding="0" cellspacing="0">
                      <tr>
                        <td style="padding:4px 0;font-size:13px;color:#9ca3af;width:130px;">Days since rotation</td>
                        <td style="padding:4px 0;font-size:13px;color:#e5e7eb;font-weight:600;">${daysSince} days</td>
                      </tr>
                      <tr>
                        <td style="padding:4px 0;font-size:13px;color:#9ca3af;">Recommended cycle</td>
                        <td style="padding:4px 0;font-size:13px;color:#e5e7eb;">Every 90 days</td>
                      </tr>
                      <tr>
                        <td style="padding:4px 0;font-size:13px;color:#9ca3af;">Status</td>
                        <td style="padding:4px 0;font-size:13px;color:${accentColor};font-weight:600;">${isOverdue ? "Overdue" : "Approaching limit"}</td>
                      </tr>
                    </table>
                  </td>
                </tr>
              </table>

              <p style="margin:0 0 28px;font-size:14px;color:#9ca3af;line-height:1.6;">
                Rotating your callback signing secret takes less than a minute. After rotating, update the secret in your webhook receiver so signature verification continues to work.
              </p>

              <!-- CTA button -->
              <table cellpadding="0" cellspacing="0" style="margin-bottom:32px;">
                <tr>
                  <td style="background:#f97316;border-radius:6px;padding:12px 28px;">
                    <a href="${webhookSettingsUrl}"
                       style="color:#fff;font-size:14px;font-weight:600;text-decoration:none;display:block;">
                      Rotate My Callback Secret
                    </a>
                  </td>
                </tr>
              </table>

              <p style="margin:0 0 8px;font-size:12px;color:#6b7280;">
                If the button above doesn't work, copy this link into your browser:
              </p>
              <p style="margin:0;font-size:12px;color:#818cf8;word-break:break-all;">${webhookSettingsUrl}</p>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="padding:24px 40px;border-top:1px solid #2a2a2a;background:#111;">
              <p style="margin:0;font-size:12px;color:#6b7280;line-height:1.6;">
                This is an automated security reminder from RasoKart. You are receiving this because your account has an active callback signing secret.
                For support, contact <a href="mailto:support@rasokart.com" style="color:#f97316;text-decoration:none;">support@rasokart.com</a>.
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`.trim();
}

export async function sendWebhookSecretRotationEmail(opts: {
  to: string;
  businessName: string;
  daysSince: number;
  isOverdue: boolean;
}): Promise<boolean> {
  const { to, businessName, daysSince, isOverdue } = opts;
  const webhookSettingsUrl = `${APP_DOMAIN}/merchant/webhook`;

  const html = buildWebhookSecretReminderHtml({ businessName, daysSince, isOverdue, webhookSettingsUrl });

  const subject = isOverdue
    ? `[RasoKart] Action Required: Callback signing secret is overdue for rotation (${daysSince} days old)`
    : `[RasoKart] Reminder: Rotate your callback signing secret (${daysSince} days old)`;

  const sent = await sendMail({ to, subject, html });

  if (!sent) {
    logger.warn(
      { to, businessName, daysSince, isOverdue },
      "Webhook secret rotation email could not be sent (SMTP not configured or failed)",
    );
  }

  return sent;
}
