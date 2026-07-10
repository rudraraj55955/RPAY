import { logger } from "../lib/logger";
import { db, merchantKycSettingsTable, kycVerificationLogsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { safeDecrypt, encryptValue } from "./encryptionHelper";

export interface AutoKycConfig {
  mode: string;
  clientId: string;
  clientSecret: string;
  baseUrl: string;
  minNameMatchScore: number;
  autoApproveEnabled: boolean;
  duplicateCheckEnabled: boolean;
  dailyVerificationLimit: number;
  perMerchantAttemptLimit: number;
  panApiEnabled: boolean;
  aadhaarApiEnabled: boolean;
}

export const DEFAULT_MIN_NAME_MATCH_SCORE = 80;

export async function loadAutoKycConfig(): Promise<AutoKycConfig | null> {
  const [row] = await db.select().from(merchantKycSettingsTable).where(eq(merchantKycSettingsTable.id, 1)).limit(1);
  if (!row) return null;
  const clientId = safeDecrypt(row.clientIdEncrypted, row.clientIdIv, row.clientIdTag);
  const clientSecret = safeDecrypt(row.clientSecretEncrypted, row.clientSecretIv, row.clientSecretTag);
  if (!clientId || !clientSecret) return null;
  return {
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
  };
}

function authHeaders(cfg: AutoKycConfig): Record<string, string> {
  return {
    "x-client-id": cfg.clientId,
    "x-client-secret": cfg.clientSecret,
    "Content-Type": "application/json",
    "Accept": "application/json",
  };
}

export function maskPan(pan: string): string {
  if (pan.length < 6) return "••••••";
  return `${pan.slice(0, 2)}${"*".repeat(pan.length - 4)}${pan.slice(-2)}`;
}

export function maskAadhaarToLast4(aadhaar: string): string {
  const digits = aadhaar.replace(/\D/g, "");
  return digits.slice(-4);
}

/**
 * Normalized Levenshtein-distance based similarity score (0-100).
 * Names are uppercased and stripped of extra whitespace/punctuation before comparing,
 * so minor formatting differences (middle initials aside) don't tank the score.
 */
export function computeNameMatchScore(nameA: string, nameB: string): number {
  const normalize = (s: string) => s.toUpperCase().replace(/[^A-Z\s]/g, "").replace(/\s+/g, " ").trim();
  const a = normalize(nameA);
  const b = normalize(nameB);
  if (!a || !b) return 0;
  if (a === b) return 100;

  const dp: number[][] = Array.from({ length: a.length + 1 }, () => new Array(b.length + 1).fill(0));
  for (let i = 0; i <= a.length; i++) dp[i]![0] = i;
  for (let j = 0; j <= b.length; j++) dp[0]![j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i]![j] = Math.min(
        dp[i - 1]![j]! + 1,
        dp[i]![j - 1]! + 1,
        dp[i - 1]![j - 1]! + cost,
      );
    }
  }
  const distance = dp[a.length]![b.length]!;
  const maxLen = Math.max(a.length, b.length);
  const similarity = maxLen === 0 ? 100 : Math.round((1 - distance / maxLen) * 100);
  return Math.max(0, Math.min(100, similarity));
}

export interface PanVerifyResult {
  ok: boolean;
  status: "VERIFIED" | "INVALID" | "PROVIDER_ERROR";
  panType?: string;
  registeredName?: string;
  requestId?: string;
}

export async function verifyPanAuto(
  cfg: AutoKycConfig,
  pan: string,
  merchantId: number,
): Promise<PanVerifyResult> {
  const panRegex = /^[A-Z]{5}[0-9]{4}[A-Z]$/;
  if (!panRegex.test(pan.toUpperCase())) {
    await logKyc(merchantId, "PAN", "FAILED", maskPan(pan), null, null, "invalid_format");
    return { ok: false, status: "INVALID" };
  }
  try {
    const resp = await fetch(`${cfg.baseUrl}/verification/v1/pan`, {
      method: "POST",
      headers: authHeaders(cfg),
      body: JSON.stringify({ pan: pan.toUpperCase() }),
      signal: AbortSignal.timeout(10_000),
    });
    const raw = (await resp.json().catch(() => ({}))) as Record<string, any>;
    const requestId: string | undefined = raw?.request_id;
    if (!resp.ok) {
      await logKyc(merchantId, "PAN", "PROVIDER_ERROR", maskPan(pan), requestId ?? null, `http_${resp.status}`, null);
      return { ok: false, status: "PROVIDER_ERROR", requestId };
    }
    const valid = raw?.status === "VALID";
    if (!valid) {
      await logKyc(merchantId, "PAN", "FAILED", maskPan(pan), requestId ?? null, "provider_invalid", null);
      return { ok: false, status: "INVALID", requestId };
    }
    await logKyc(merchantId, "PAN", "VERIFIED", maskPan(pan), requestId ?? null, "verified", null);
    return {
      ok: true,
      status: "VERIFIED",
      panType: raw?.pan_type ?? "PERSONAL",
      registeredName: raw?.registered_name ?? raw?.name,
      requestId,
    };
  } catch (err: any) {
    logger.warn({ err: err?.message, merchantId }, "auto_kyc_pan_verify_exception");
    await logKyc(merchantId, "PAN", "PROVIDER_ERROR", maskPan(pan), null, "timeout_or_network", null);
    return { ok: false, status: "PROVIDER_ERROR" };
  }
}

export interface AadhaarStartResult {
  ok: boolean;
  sessionId?: string;
  refId?: string;
}

export async function startAadhaarOtp(
  cfg: AutoKycConfig,
  aadhaarNumber: string,
  merchantId: number,
): Promise<AadhaarStartResult> {
  const digits = aadhaarNumber.replace(/\D/g, "");
  if (digits.length !== 12) {
    await logKyc(merchantId, "AADHAAR", "FAILED", `••••${digits.slice(-4)}`, null, null, "invalid_format");
    return { ok: false };
  }
  try {
    const resp = await fetch(`${cfg.baseUrl}/verification/v1/offline-aadhaar/otp`, {
      method: "POST",
      headers: authHeaders(cfg),
      body: JSON.stringify({ aadhaar_number: digits }),
      signal: AbortSignal.timeout(10_000),
    });
    const raw = (await resp.json().catch(() => ({}))) as Record<string, any>;
    if (!resp.ok || !raw?.ref_id) {
      await logKyc(merchantId, "AADHAAR", "PROVIDER_ERROR", `••••${digits.slice(-4)}`, raw?.ref_id ?? null, `http_${resp.status}`, null);
      return { ok: false };
    }
    await logKyc(merchantId, "AADHAAR", "OTP_SENT", `••••${digits.slice(-4)}`, String(raw.ref_id), "otp_sent", null);
    return { ok: true, sessionId: String(raw.ref_id), refId: String(raw.ref_id) };
  } catch (err: any) {
    logger.warn({ err: err?.message, merchantId }, "auto_kyc_aadhaar_start_exception");
    await logKyc(merchantId, "AADHAAR", "PROVIDER_ERROR", null, null, "timeout_or_network", null);
    return { ok: false };
  }
}

export interface AadhaarStatusResult {
  ok: boolean;
  status: "VERIFIED" | "PENDING" | "FAILED" | "CANCELLED" | "PROVIDER_ERROR";
  name?: string;
  last4?: string;
  requestId?: string;
}

export async function verifyAadhaarOtp(
  cfg: AutoKycConfig,
  refId: string,
  otp: string,
  merchantId: number,
): Promise<AadhaarStatusResult> {
  if (!otp || otp.trim().length === 0) {
    await logKyc(merchantId, "AADHAAR", "CANCELLED", null, refId, "otp_cancelled", null);
    return { ok: false, status: "CANCELLED" };
  }
  try {
    const resp = await fetch(`${cfg.baseUrl}/verification/v1/offline-aadhaar/verify`, {
      method: "POST",
      headers: authHeaders(cfg),
      body: JSON.stringify({ ref_id: refId, otp }),
      signal: AbortSignal.timeout(10_000),
    });
    const raw = (await resp.json().catch(() => ({}))) as Record<string, any>;
    if (!resp.ok) {
      await logKyc(merchantId, "AADHAAR", "PROVIDER_ERROR", null, refId, `http_${resp.status}`, null);
      return { ok: false, status: "PROVIDER_ERROR" };
    }
    const verified = raw?.status === "VALID" || raw?.verified === true;
    if (!verified) {
      await logKyc(merchantId, "AADHAAR", "FAILED", null, refId, "otp_invalid", null);
      return { ok: false, status: "FAILED" };
    }
    const name: string | undefined = raw?.name ?? raw?.full_name;
    const last4: string | undefined = (raw?.aadhaar_number ?? raw?.masked_aadhaar ?? "").toString().replace(/\D/g, "").slice(-4) || undefined;
    await logKyc(merchantId, "AADHAAR", "VERIFIED", last4 ? `••••${last4}` : null, refId, "verified", null);
    return { ok: true, status: "VERIFIED", name, last4, requestId: refId };
  } catch (err: any) {
    logger.warn({ err: err?.message, merchantId }, "auto_kyc_aadhaar_verify_exception");
    await logKyc(merchantId, "AADHAAR", "PROVIDER_ERROR", null, refId, "timeout_or_network", null);
    return { ok: false, status: "PROVIDER_ERROR" };
  }
}

export async function testAutoKycConnection(cfg: AutoKycConfig): Promise<{ ok: boolean; message: string }> {
  try {
    const resp = await fetch(`${cfg.baseUrl}/verification/v1/pan`, {
      method: "POST",
      headers: authHeaders(cfg),
      body: JSON.stringify({ pan: "ABCDE1234F" }),
      signal: AbortSignal.timeout(8000),
    });
    if (resp.status === 401 || resp.status === 403) {
      return { ok: false, message: "Credentials rejected by provider. Check Client ID / Secret." };
    }
    return { ok: true, message: "Provider reachable and credentials accepted." };
  } catch (err: any) {
    return { ok: false, message: "Could not reach provider (network/timeout)." };
  }
}

export async function logKyc(
  merchantId: number,
  verificationType: "PAN" | "AADHAAR",
  status: string,
  requestMasked: string | null,
  providerReferenceId: string | null,
  responseMasked: string | null,
  errorReason: string | null,
) {
  try {
    let refEnc: { encrypted: string; iv: string; tag: string } | null = null;
    if (providerReferenceId) refEnc = encryptValue(providerReferenceId);
    await db.insert(kycVerificationLogsTable).values({
      merchantId,
      verificationType,
      status,
      requestMasked,
      responseMasked,
      providerReferenceIdEncrypted: refEnc?.encrypted ?? null,
      providerReferenceIdIv: refEnc?.iv ?? null,
      providerReferenceIdTag: refEnc?.tag ?? null,
      errorReason,
    });
  } catch (err: unknown) {
    logger.warn({ err }, "kyc_verification_log_insert_error");
  }
}
