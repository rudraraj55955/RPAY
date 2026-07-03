import { pgTable, serial, varchar, text, integer, timestamp, unique } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

/**
 * A merchant-saved payout beneficiary (bank account or UPI destination).
 *
 * `beneficiaryKey` is a deterministic fingerprint of the payout destination
 * (bank account + IFSC, or UPI VPA) scoped to merchant + environment, used to
 * prevent duplicate beneficiaries and to look up an already-registered
 * beneficiary before creating a new one at the provider.
 *
 * `providerBeneficiaryId` is the Cashfree Payouts V2 beneficiary_id we
 * registered for this destination. It is intentionally never returned to the
 * merchant/admin frontend — only `providerStatus` is exposed there. Keeping
 * this authoritative record is what fixes "beneficiary_not_found" transfer
 * failures: we never guess or recompute an ID that may not actually exist on
 * Cashfree's side.
 *
 * `localStatus` (active | disabled) is merchant/admin controlled — a
 * disabled beneficiary cannot be selected for new payouts.
 * `providerStatus` (not_created | created | failed) tracks whether the
 * beneficiary is actually registered with Cashfree.
 *
 * Editing is only allowed while no withdrawal referencing this beneficiary
 * has reached transferStatus = SUCCESS; once used successfully, edits must
 * create a new beneficiary record instead, to preserve payout audit history.
 */
export const payoutBeneficiariesTable = pgTable(
  "payout_beneficiaries",
  {
    id: serial("id").primaryKey(),
    merchantId: integer("merchant_id").notNull(),
    env: text("env").notNull(), // test | live
    label: text("label"), // optional merchant-friendly nickname
    payoutMode: text("payout_mode").notNull(), // IMPS | NEFT | RTGS | UPI
    bankAccount: text("bank_account"),
    bankName: text("bank_name"),
    ifscCode: text("ifsc_code"),
    accountHolder: text("account_holder"),
    upiId: text("upi_id"),
    beneficiaryKey: varchar("beneficiary_key", { length: 120 }).notNull(),
    providerBeneficiaryId: varchar("provider_beneficiary_id", { length: 64 }),
    localStatus: text("local_status").notNull().default("active"), // active | disabled
    providerStatus: text("provider_status").notNull().default("not_created"), // not_created | created | failed
    lastProviderError: text("last_provider_error"),
    // Legacy columns kept for backward compat with the earlier cache-only table;
    // no longer written by new code paths, safe to ignore.
    status: text("status").notNull().default("active"),
    lastError: text("last_error"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
  },
  (t) => [unique("payout_beneficiaries_merchant_env_key_unique").on(t.merchantId, t.env, t.beneficiaryKey)]
);

export const insertPayoutBeneficiarySchema = createInsertSchema(payoutBeneficiariesTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertPayoutBeneficiary = z.infer<typeof insertPayoutBeneficiarySchema>;
export type PayoutBeneficiary = typeof payoutBeneficiariesTable.$inferSelect;
