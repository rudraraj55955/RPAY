import { pgTable, text, serial, timestamp, numeric, integer, uniqueIndex, index } from "drizzle-orm/pg-core";
import { merchantsTable } from "./merchants";

/**
 * payout_wallet_load_orders — tracks every fund-load attempt into a payout merchant's wallet.
 *
 * method:
 *   ONLINE          — payment gateway (Cashfree). Auto-credited after SUCCESS webhook.
 *   BANK_TRANSFER_UTR — merchant submits UTR; admin verifies and approves.
 *   ADMIN_TOPUP     — admin credits wallet directly (with mandatory reason).
 *
 * status flow:
 *   ONLINE:          CREATED → PROCESSING → SUCCESS | FAILED | EXPIRED
 *   BANK_TRANSFER:   CREATED → PENDING_VERIFICATION → SUCCESS | REJECTED
 *   ADMIN_TOPUP:     CREATED → SUCCESS (immediate)
 *
 * Security rules:
 *   - provider_order_id and provider_payment_id are admin-only; never returned to merchant.
 *   - utr has a unique constraint to block duplicate UTR submissions.
 *   - Wallet credit happens only in the backend (webhook or admin approval); never from frontend.
 *   - internal_order_id is "WLOAD_{loadId}" and acts as the Cashfree order_id for online loads.
 */
export const payoutWalletLoadOrdersTable = pgTable(
  "payout_wallet_load_orders",
  {
    id: serial("id").primaryKey(),
    loadId:         text("load_id").notNull(),
    merchantId:     integer("merchant_id").notNull().references(() => merchantsTable.id, { onDelete: "restrict" }),
    amount:         numeric("amount",          { precision: 18, scale: 2 }).notNull(),
    feeAmount:      numeric("fee_amount",      { precision: 18, scale: 2 }).notNull().default("0"),
    gstAmount:      numeric("gst_amount",      { precision: 18, scale: 2 }).notNull().default("0"),
    netCreditAmount: numeric("net_credit_amount", { precision: 18, scale: 2 }).notNull(),
    method:  text("method").notNull(),           // ONLINE | BANK_TRANSFER_UTR | ADMIN_TOPUP
    status:  text("status").notNull().default("CREATED"), // CREATED | PROCESSING | PENDING_VERIFICATION | SUCCESS | FAILED | REJECTED | EXPIRED
    internalOrderId:   text("internal_order_id"),    // WLOAD_{loadId} — Cashfree order_id for ONLINE
    providerPaymentId: text("provider_payment_id"),  // admin-only; Cashfree cf_payment_id
    utr:             text("utr"),                    // unique UTR for BANK_TRANSFER_UTR
    payerName:       text("payer_name"),
    payerReference:  text("payer_reference"),
    screenshotUrl:   text("screenshot_url"),
    rejectionReason: text("rejection_reason"),
    creditedAt:  timestamp("credited_at",  { withTimezone: true }),
    approvedBy:  integer("approved_by"),             // admin user.id
    approvedAt:  timestamp("approved_at",  { withTimezone: true }),
    adminNote:   text("admin_note"),
    createdAt:   timestamp("created_at",   { withTimezone: true }).notNull().defaultNow(),
    updatedAt:   timestamp("updated_at",   { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
  },
  (table) => [
    uniqueIndex("pwlo_load_id_uniq").on(table.loadId),
    uniqueIndex("pwlo_internal_order_id_uniq").on(table.internalOrderId),
    uniqueIndex("pwlo_utr_uniq").on(table.utr),
    index("pwlo_merchant_created_idx").on(table.merchantId, table.createdAt),
    index("pwlo_status_idx").on(table.status),
  ]
);

export type PayoutWalletLoadOrder = typeof payoutWalletLoadOrdersTable.$inferSelect;
export type InsertPayoutWalletLoadOrder = typeof payoutWalletLoadOrdersTable.$inferInsert;
