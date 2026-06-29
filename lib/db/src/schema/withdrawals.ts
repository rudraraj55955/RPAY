import { pgTable, text, serial, timestamp, numeric, integer } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const withdrawalsTable = pgTable("withdrawals", {
  id: serial("id").primaryKey(),
  merchantId: integer("merchant_id").notNull(),
  amount: numeric("amount", { precision: 18, scale: 2 }).notNull(),
  currency: text("currency").notNull().default("INR"),
  status: text("status").notNull().default("pending"), // pending | approved | rejected
  // New payout-system fields
  transferStatus: text("transfer_status").notNull().default("NOT_STARTED"), // NOT_STARTED | INITIATED | PENDING | SUCCESS | FAILED | REVERSED
  providerReferenceId: text("provider_reference_id"),
  utr: text("utr"),
  failureReason: text("failure_reason"),
  approvedByAdminId: integer("approved_by_admin_id"),
  approvedAt: timestamp("approved_at", { withTimezone: true }),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  payoutMode: text("payout_mode").notNull().default("IMPS"), // IMPS | NEFT | RTGS | UPI
  upiId: text("upi_id"),
  remarks: text("remarks"),
  // Bank details
  bankAccount: text("bank_account").notNull(),
  bankName: text("bank_name").notNull(),
  ifscCode: text("ifsc_code").notNull(),
  accountHolder: text("account_holder").notNull(),
  rejectionReason: text("rejection_reason"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertWithdrawalSchema = createInsertSchema(withdrawalsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertWithdrawal = z.infer<typeof insertWithdrawalSchema>;
export type Withdrawal = typeof withdrawalsTable.$inferSelect;
