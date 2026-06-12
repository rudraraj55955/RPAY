/**
 * Cashfree Payout API helper
 *
 * Auth: Cashfree Payout uses X-Client-Id and X-Client-Secret headers directly.
 * No separate token step needed for the v1.2 transfer endpoints.
 *
 * Test base URL:  https://payout-gamma.cashfree.com
 * Live base URL:  https://payout.cashfree.com
 *
 * Key endpoints:
 *   POST /payout/v1.2/requestTransfer   — create a payout transfer
 *   GET  /payout/v1.2/getTransferStatus?referenceId={id} — fetch status
 */

export type CashfreePayoutEnv = "test" | "live";

const PAYOUT_BASE_TEST = "https://payout-gamma.cashfree.com";
const PAYOUT_BASE_LIVE = "https://payout.cashfree.com";

function payoutBaseUrl(env: CashfreePayoutEnv): string {
  return env === "live" ? PAYOUT_BASE_LIVE : PAYOUT_BASE_TEST;
}

function payoutHeaders(clientId: string, clientSecret: string): Record<string, string> {
  return {
    "Content-Type": "application/json",
    "X-Client-Id": clientId,
    "X-Client-Secret": clientSecret,
  };
}

export interface CashfreePayoutTransferRequest {
  /**
   * Our unique transfer reference ID (must be unique per transfer).
   * Cashfree uses this as referenceId / transferId for idempotency.
   */
  referenceId: string;
  /** Beneficiary bank account number (required if no upiId) */
  accountNumber?: string;
  /** Beneficiary IFSC code (required if accountNumber is provided) */
  ifsc?: string;
  /** Beneficiary UPI VPA (required if no accountNumber/ifsc) */
  upiId?: string;
  beneficiaryName: string;
  amount: number;
  /** Optional transfer remark / narration */
  remark?: string;
  /** Transfer mode — BANK_ACCOUNT or UPI (determined by presence of accountNumber vs upiId) */
  transferMode?: "BANK_ACCOUNT" | "UPI";
}

export interface CashfreePayoutTransferResponse {
  status?: string;
  message?: string;
  referenceId?: string;
  transferId?: string;
  utr?: string;
  bankAccount?: string;
  ifsc?: string;
  vpa?: string;
  [key: string]: unknown;
}

/**
 * Initiate a Cashfree payout transfer.
 *
 * POST https://payout-gamma.cashfree.com/payout/v1.2/requestTransfer
 *
 * Returns the raw response string and parsed JSON.
 */
export async function cashfreePayoutCreateTransfer(
  clientId: string,
  clientSecret: string,
  env: CashfreePayoutEnv,
  payload: CashfreePayoutTransferRequest,
): Promise<{ raw: string; parsed: CashfreePayoutTransferResponse }> {
  const body: Record<string, unknown> = {
    referenceId: payload.referenceId,
    amount: String(payload.amount),
    transferMode: payload.transferMode ?? (payload.upiId ? "UPI" : "BANK_ACCOUNT"),
    remarks: payload.remark ?? "Payout",
    beneDetails: {
      name: payload.beneficiaryName,
      ...(payload.accountNumber && payload.ifsc
        ? { bankAccount: payload.accountNumber, ifsc: payload.ifsc }
        : {}),
      ...(payload.upiId ? { vpa: payload.upiId } : {}),
    },
  };

  const res = await fetch(`${payoutBaseUrl(env)}/payout/v1.2/requestTransfer`, {
    method: "POST",
    headers: payoutHeaders(clientId, clientSecret),
    body: JSON.stringify(body),
  });

  const raw = await res.text();
  let parsed: CashfreePayoutTransferResponse;
  try {
    parsed = JSON.parse(raw) as CashfreePayoutTransferResponse;
  } catch {
    parsed = { message: raw };
  }
  return { raw, parsed };
}

/**
 * Fetch the status of a payout transfer by our referenceId.
 *
 * GET https://payout-gamma.cashfree.com/payout/v1.2/getTransferStatus?referenceId={id}
 */
export async function cashfreePayoutGetTransferStatus(
  clientId: string,
  clientSecret: string,
  env: CashfreePayoutEnv,
  referenceId: string,
): Promise<{ raw: string; parsed: CashfreePayoutTransferResponse }> {
  const url = new URL(`${payoutBaseUrl(env)}/payout/v1.2/getTransferStatus`);
  url.searchParams.set("referenceId", referenceId);

  const res = await fetch(url.toString(), {
    method: "GET",
    headers: payoutHeaders(clientId, clientSecret),
  });

  const raw = await res.text();
  let parsed: CashfreePayoutTransferResponse;
  try {
    parsed = JSON.parse(raw) as CashfreePayoutTransferResponse;
  } catch {
    parsed = { message: raw };
  }
  return { raw, parsed };
}

/**
 * Map a Cashfree payout status string to our canonical status.
 *
 * Cashfree payout statuses: SUCCESS, PENDING, FAILED, REVERSED, CANCELLED
 */
export function normalizeCashfreePayoutStatus(
  cashfreeStatus: string | undefined,
): "PENDING" | "SUCCESS" | "FAILED" | "REVERSED" {
  switch ((cashfreeStatus ?? "").toUpperCase()) {
    case "SUCCESS": return "SUCCESS";
    case "REVERSED": return "REVERSED";
    case "FAILED":
    case "CANCELLED":
    case "ERROR":
      return "FAILED";
    default:
      return "PENDING";
  }
}
