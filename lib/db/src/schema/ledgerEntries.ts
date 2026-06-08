import { pgTable, text, serial, timestamp, numeric, integer, index } from "drizzle-orm/pg-core";

export const ledgerEntriesTable = pgTable("ledger_entries", {
  id: serial("id").primaryKey(),
  merchantId: integer("merchant_id").notNull(),
  type: text("type").notNull(), // deposit | settlement | fee | adjustment | refund
  amount: numeric("amount", { precision: 18, scale: 2 }).notNull(), // positive = credit, negative = debit
  balanceBefore: numeric("balance_before", { precision: 18, scale: 2 }).notNull(),
  balanceAfter: numeric("balance_after", { precision: 18, scale: 2 }).notNull(),
  referenceType: text("reference_type"), // transaction | settlement | invoice | manual
  referenceId: integer("reference_id"),
  description: text("description").notNull(),
  createdBy: integer("created_by"), // userId — null for system-generated entries
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index("ledger_merchant_created_idx").on(table.merchantId, table.createdAt),
]);

export type LedgerEntry = typeof ledgerEntriesTable.$inferSelect;
