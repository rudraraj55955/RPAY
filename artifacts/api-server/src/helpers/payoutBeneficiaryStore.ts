import { db, payoutBeneficiariesTable, withdrawalsTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import {
  cashfreePayoutEnsureBeneficiary,
  type CashfreePayoutEnv,
} from "./cashfreePayout";

export type BeneficiaryDestinationInput = {
  payoutMode: string;
  bankAccount?: string | null;
  bankName?: string | null;
  ifscCode?: string | null;
  upiId?: string | null;
  accountHolder?: string | null;
  label?: string | null;
};

/**
 * Deterministic fingerprint of a payout destination (bank account+IFSC, or
 * UPI VPA), scoped to merchant+env by the caller via the unique index. Used
 * to dedup saved beneficiaries and to look up an already-registered one
 * before creating a new one at the provider.
 */
export function beneficiaryKeyFor(input: BeneficiaryDestinationInput): string {
  const isUpi = input.payoutMode === "UPI" && !!input.upiId?.trim();
  return isUpi
    ? `upi:${input.upiId!.trim().toLowerCase()}`
    : `bank:${(input.bankAccount ?? "").trim()}:${(input.ifscCode ?? "").trim().toUpperCase()}`;
}

export function maskBankAccountLast4(bankAccount?: string | null): string | null {
  if (!bankAccount) return null;
  const digits = bankAccount.trim();
  if (digits.length <= 4) return digits;
  return digits.slice(-4);
}

export function maskUpiId(upiId?: string | null): string | null {
  if (!upiId) return null;
  const [user, domain] = upiId.split("@");
  if (!domain) return upiId.length > 3 ? `${upiId.slice(0, 2)}***` : "***";
  const visible = user.slice(0, 2);
  return `${visible}***@${domain}`;
}

type BeneficiaryRow = typeof payoutBeneficiariesTable.$inferSelect;

/**
 * Find an existing beneficiary row for this merchant+env+destination, or
 * create a new one (provider_status = not_created — provider registration
 * happens separately via `ensureBeneficiaryProviderRegistered`).
 */
export async function resolveOrCreateBeneficiary(
  merchantId: number,
  env: CashfreePayoutEnv,
  input: BeneficiaryDestinationInput
): Promise<BeneficiaryRow> {
  const beneficiaryKey = beneficiaryKeyFor(input);

  const [existing] = await db
    .select()
    .from(payoutBeneficiariesTable)
    .where(
      and(
        eq(payoutBeneficiariesTable.merchantId, merchantId),
        eq(payoutBeneficiariesTable.env, env),
        eq(payoutBeneficiariesTable.beneficiaryKey, beneficiaryKey)
      )
    )
    .limit(1);

  if (existing) return existing;

  const [created] = await db
    .insert(payoutBeneficiariesTable)
    .values({
      merchantId,
      env,
      label: input.label ?? null,
      payoutMode: input.payoutMode,
      bankAccount: input.bankAccount ?? null,
      bankName: input.bankName ?? null,
      ifscCode: input.ifscCode ?? null,
      accountHolder: input.accountHolder ?? null,
      upiId: input.payoutMode === "UPI" ? (input.upiId ?? null) : null,
      beneficiaryKey,
      providerBeneficiaryId: null,
      localStatus: "active",
      providerStatus: "not_created",
      lastProviderError: null,
      // legacy columns kept in sync for backward compat
      status: "active",
      lastError: null,
    })
    .onConflictDoNothing({
      target: [
        payoutBeneficiariesTable.merchantId,
        payoutBeneficiariesTable.env,
        payoutBeneficiariesTable.beneficiaryKey,
      ],
    })
    .returning();

  if (created) return created;

  // Lost a race with a concurrent insert — fetch the row the other request created.
  const [raced] = await db
    .select()
    .from(payoutBeneficiariesTable)
    .where(
      and(
        eq(payoutBeneficiariesTable.merchantId, merchantId),
        eq(payoutBeneficiariesTable.env, env),
        eq(payoutBeneficiariesTable.beneficiaryKey, beneficiaryKey)
      )
    )
    .limit(1);
  return raced!;
}

export type EnsureProviderResult = {
  ok: boolean;
  providerBeneficiaryId?: string;
  message?: string;
};

/**
 * Ensure a beneficiary row is actually registered with the payout provider.
 * Trusts a prior `provider_status = 'created'` unless `forceRefresh` is set
 * (used when the provider reports beneficiary_not_found on a transfer).
 *
 * Uses an opaque, deterministic local ID derived from the row's own primary
 * key (never from raw bank/UPI details), and persists the outcome so future
 * approve/retry calls skip the network round trip.
 */
export async function ensureBeneficiaryProviderRegistered(
  req: any,
  beneficiaryRow: BeneficiaryRow,
  env: CashfreePayoutEnv,
  clientId: string,
  clientSecret: string,
  withdrawalId?: number | null,
  forceRefresh = false
): Promise<EnsureProviderResult> {
  if (!forceRefresh && beneficiaryRow.providerStatus === "created" && beneficiaryRow.providerBeneficiaryId) {
    return { ok: true, providerBeneficiaryId: beneficiaryRow.providerBeneficiaryId };
  }

  const localBeneficiaryId = `BENE_M${beneficiaryRow.merchantId}_${beneficiaryRow.id}`.replace(/[^A-Za-z0-9_]/g, "_").slice(0, 50);

  const ensured = await cashfreePayoutEnsureBeneficiary(clientId, clientSecret, env, localBeneficiaryId, {
    beneficiaryName: beneficiaryRow.accountHolder ?? undefined,
    accountNumber: beneficiaryRow.bankAccount ?? undefined,
    ifsc: beneficiaryRow.ifscCode ?? undefined,
    upiId: beneficiaryRow.payoutMode === "UPI" ? (beneficiaryRow.upiId ?? undefined) : undefined,
    amount: 0,
  });

  // Safe log only — whitelisted fields, never bank/secret/token/raw response.
  req.log.info(
    {
      withdrawalId: withdrawalId ?? null,
      localBeneficiaryId,
      amount: undefined,
      mode: beneficiaryRow.payoutMode,
      httpStatus: ensured.httpStatus,
      subCode: ensured.subCode,
      providerMessage: ensured.message,
    },
    "beneficiary_create_attempted"
  );

  if (ensured.ok) {
    await db
      .update(payoutBeneficiariesTable)
      .set({
        providerBeneficiaryId: ensured.beneficiaryId,
        providerStatus: "created",
        lastProviderError: null,
        status: "active",
        lastError: null,
      })
      .where(eq(payoutBeneficiariesTable.id, beneficiaryRow.id));
    return { ok: true, providerBeneficiaryId: ensured.beneficiaryId };
  }

  const safeMessage = "Beneficiary setup failed. Check bank account, IFSC, and name.";
  await db
    .update(payoutBeneficiariesTable)
    .set({
      providerStatus: "failed",
      lastProviderError: safeMessage,
      status: "failed",
      lastError: safeMessage,
    })
    .where(eq(payoutBeneficiariesTable.id, beneficiaryRow.id));

  return { ok: false, message: safeMessage };
}

/**
 * Reset a beneficiary's provider registration after the provider reports
 * beneficiary_not_found on a transfer, so the next attempt re-creates it
 * instead of retrying against an ID Cashfree says doesn't exist.
 */
export async function invalidateBeneficiaryProviderRegistration(beneficiaryId: number) {
  await db
    .update(payoutBeneficiariesTable)
    .set({
      providerStatus: "failed",
      lastProviderError: "Provider reported beneficiary not found on transfer — will re-register on next attempt",
      status: "failed",
      lastError: "Provider reported beneficiary not found on transfer",
    })
    .where(eq(payoutBeneficiariesTable.id, beneficiaryId));
}

/**
 * True once any withdrawal referencing this beneficiary reached
 * transferStatus = SUCCESS. Used to lock direct edits (audit integrity) —
 * callers should create a new beneficiary record instead.
 */
export async function beneficiaryUsedInSuccessfulPayout(beneficiaryId: number): Promise<boolean> {
  const [row] = await db
    .select({ id: withdrawalsTable.id })
    .from(withdrawalsTable)
    .where(
      and(
        eq(withdrawalsTable.beneficiaryId, beneficiaryId),
        eq(withdrawalsTable.transferStatus, "SUCCESS")
      )
    )
    .limit(1);
  return !!row;
}

export function mapBeneficiary(
  row: BeneficiaryRow,
  usedInSuccessfulPayout: boolean,
  merchantName?: string | null
) {
  return {
    id: row.id,
    merchantId: row.merchantId,
    merchantName: merchantName ?? null,
    label: row.label,
    payoutMode: row.payoutMode,
    bankName: row.bankName,
    bankAccountLast4: maskBankAccountLast4(row.bankAccount),
    ifscCode: row.ifscCode,
    accountHolder: row.accountHolder,
    upiIdMasked: maskUpiId(row.upiId),
    localStatus: row.localStatus,
    providerStatus: row.providerStatus,
    lastProviderError: row.lastProviderError,
    usedInSuccessfulPayout,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}
