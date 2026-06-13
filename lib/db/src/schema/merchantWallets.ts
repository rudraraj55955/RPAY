import { pgTable, text, serial, timestamp, numeric, integer, uniqueIndex } from "drizzle-orm/pg-core";
import { merchantsTable } from "./merchants";

export const merchantWalletsTable = pgTable(
  "merchant_wallets",
  {
    id: serial("id").primaryKey(),
    merchantId: integer("merchant_id").notNull().references(() => merchantsTable.id, { onDelete: "cascade" }),
    currency: text("currency").notNull().default("INR"),
    availableBalance:  numeric("available_balance",  { precision: 18, scale: 2 }).notNull().default("0"),
    pendingBalance:    numeric("pending_balance",    { precision: 18, scale: 2 }).notNull().default("0"),
    holdBalance:       numeric("hold_balance",       { precision: 18, scale: 2 }).notNull().default("0"),
    settlementBalance: numeric("settlement_balance", { precision: 18, scale: 2 }).notNull().default("0"),
    payoutBalance:     numeric("payout_balance",     { precision: 18, scale: 2 }).notNull().default("0"),
    totalCollection:   numeric("total_collection",   { precision: 18, scale: 2 }).notNull().default("0"),
    totalPayout:       numeric("total_payout",       { precision: 18, scale: 2 }).notNull().default("0"),
    totalCharges:      numeric("total_charges",      { precision: 18, scale: 2 }).notNull().default("0"),
    totalRefunds:      numeric("total_refunds",      { precision: 18, scale: 2 }).notNull().default("0"),
    totalReversals:    numeric("total_reversals",    { precision: 18, scale: 2 }).notNull().default("0"),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
  },
  (table) => [
    uniqueIndex("merchant_wallets_merchant_id_uniq").on(table.merchantId),
  ]
);

export type MerchantWallet = typeof merchantWalletsTable.$inferSelect;
