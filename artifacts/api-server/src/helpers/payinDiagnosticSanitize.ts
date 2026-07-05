/**
 * Pure sanitization helpers for the admin-only Payin gateway diagnostic
 * route. These exist so the diagnostic endpoint can surface *just enough*
 * signal for an admin to debug a broken gateway without ever leaking the
 * raw provider response, secrets, client id, or payment_session_id.
 */

/** True only for a well-formed https:// URL. Used for the `baseUrlValid` diagnostic field. */
export function isValidHttpsUrl(url: string | undefined | null): boolean {
  if (!url) return false;
  try {
    return new URL(url).protocol === "https:";
  } catch {
    return false;
  }
}

/**
 * Returns a short, redacted diagnostic message safe to show an admin.
 * Any of the provided `secrets` appearing verbatim in the message are
 * replaced with "[REDACTED]" before truncation, so a client secret or
 * client id echoed back by a provider error can never leak through.
 */
export function sanitizeDiagnosticMessage(
  message: string | undefined | null,
  secrets: Array<string | undefined | null> = [],
): string | null {
  if (!message || !message.trim()) return null;
  let safe = message;
  for (const secret of secrets) {
    if (secret && secret.trim().length > 0) {
      safe = safe.split(secret).join("[REDACTED]");
    }
  }
  const MAX_LEN = 300;
  if (safe.length > MAX_LEN) safe = `${safe.slice(0, MAX_LEN)}…`;
  return safe;
}

/** Returns a short, safe-to-display provider sub-code (e.g. "authentication_failed"). */
export function sanitizeSubCode(code: unknown): string | null {
  if (typeof code !== "string" || !code.trim()) return null;
  return code.slice(0, 100);
}

/**
 * Sanitized shape of a Postgres error, safe to log or return to an admin.
 * Deliberately omits `message`/`detail`/`hint` — those can echo back raw
 * column *values* (e.g. a customer phone number in a duplicate-key detail
 * message), whereas `code`/`table`/`column`/`constraint` are just schema
 * identifiers with no row data in them.
 */
export interface SafeDbError {
  safeDbCode: string | null;
  safeTable: string | null;
  safeColumn: string | null;
  safeConstraint: string | null;
}

/**
 * Extracts only schema-identifier fields from a `pg` driver error. Never
 * pass through `message`, `detail`, or `hint` — those may contain the raw
 * value that violated a constraint.
 */
export function sanitizeDbError(err: unknown): SafeDbError {
  const e = err as { code?: unknown; table?: unknown; column?: unknown; constraint?: unknown } | null | undefined;
  const clamp = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.slice(0, 100) : null);
  return {
    safeDbCode: clamp(e?.code),
    safeTable: clamp(e?.table),
    safeColumn: clamp(e?.column),
    safeConstraint: clamp(e?.constraint),
  };
}
