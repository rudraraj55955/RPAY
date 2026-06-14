import { logger } from "../lib/logger";
import { sendMail } from "./mailer";

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#x27;");
}

export async function sendPrefChangeUnknownDeviceEmail(opts: {
  to: string;
  businessName: string;
  ip: string;
  changedAt: Date;
}): Promise<void> {
  const { to, businessName, ip, changedAt } = opts;

  const appUrl = process.env["APP_URL"] ?? "https://rasokart.com";
  const securityUrl = `${appUrl}/merchant/security`;
  const formattedDate = changedAt.toUTCString();

  const html = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Notification Preferences Changed — RasoKart</title>
</head>
<body style="margin:0;padding:0;background:#0f0f0f;font-family:'Segoe UI',Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#0f0f0f;padding:40px 0;">
    <tr>
      <td align="center">
        <table width="600" cellpadding="0" cellspacing="0" style="background:#1a1a1a;border-radius:12px;overflow:hidden;border:1px solid #2a2a2a;">

          <!-- Header -->
          <tr>
            <td style="background:#111;padding:32px 40px;border-bottom:1px solid #2a2a2a;">
              <span style="font-size:22px;font-weight:700;color:#fff;letter-spacing:-0.5px;">Raso<span style="color:#f97316;">Kart</span></span>
            </td>
          </tr>

          <!-- Body -->
          <tr>
            <td style="padding:40px;">
              <h1 style="margin:0 0 8px;font-size:22px;font-weight:600;color:#f1f1f1;">
                Notification Preferences Changed from an Unrecognised Device
              </h1>
              <p style="margin:0 0 24px;font-size:14px;color:#9ca3af;line-height:1.6;">
                Your RasoKart notification preferences were recently modified.
              </p>

              <p style="margin:0 0 24px;font-size:15px;color:#d1d5db;line-height:1.6;">
                Dear <strong style="color:#fff;">${escapeHtml(businessName)}</strong>,
              </p>

              <p style="margin:0 0 24px;font-size:15px;color:#d1d5db;line-height:1.6;">
                Your notification preferences were updated from an IP address that is not recognised as a trusted device for your account.
                If this was you, no action is needed. If you do not recognise this activity, review your Security Activity immediately and change your password.
              </p>

              <!-- Details box -->
              <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:28px;">
                <tr>
                  <td style="background:#111;border-left:3px solid #f97316;border-radius:6px;padding:16px 20px;">
                    <p style="margin:0 0 10px;font-size:12px;font-weight:600;color:#f97316;text-transform:uppercase;letter-spacing:0.05em;">Change Details</p>
                    <table width="100%" cellpadding="0" cellspacing="0">
                      <tr>
                        <td style="padding:4px 0;font-size:13px;color:#9ca3af;width:120px;">IP address</td>
                        <td style="padding:4px 0;font-size:13px;color:#e5e7eb;">${escapeHtml(ip)}</td>
                      </tr>
                      <tr>
                        <td style="padding:4px 0;font-size:13px;color:#9ca3af;width:120px;">Date &amp; time</td>
                        <td style="padding:4px 0;font-size:13px;color:#e5e7eb;">${escapeHtml(formattedDate)}</td>
                      </tr>
                    </table>
                  </td>
                </tr>
              </table>

              <!-- Action button -->
              <table cellpadding="0" cellspacing="0" style="margin-bottom:32px;">
                <tr>
                  <td style="background:#f97316;border-radius:6px;padding:12px 24px;">
                    <a href="${securityUrl}" style="color:#fff;font-size:14px;font-weight:600;text-decoration:none;">
                      View Security Activity
                    </a>
                  </td>
                </tr>
              </table>

              <p style="margin:0;font-size:14px;color:#9ca3af;line-height:1.6;">
                If you did not make this change, please contact <a href="mailto:support@rasokart.com" style="color:#f97316;text-decoration:none;">support@rasokart.com</a> immediately and change your password.
              </p>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="padding:24px 40px;border-top:1px solid #2a2a2a;background:#111;">
              <p style="margin:0;font-size:12px;color:#6b7280;line-height:1.6;">
                This is an automated security alert from RasoKart. It is sent regardless of your notification preferences to ensure your account security.
                Please do not reply directly to this email.
                For support, contact <a href="mailto:support@rasokart.com" style="color:#f97316;text-decoration:none;">support@rasokart.com</a>.
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>
  `.trim();

  const sent = await sendMail({
    to,
    subject: "Security Alert: Notification Preferences Changed from an Unrecognised Device — RasoKart",
    html,
  });

  if (!sent) {
    logger.warn({ to, businessName }, "Pref-change unknown-device email could not be sent (SMTP not configured or failed)");
  }
}
