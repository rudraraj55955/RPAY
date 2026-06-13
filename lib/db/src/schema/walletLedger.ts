import { pgTable, text, serial, timestamp, numeric, integer, index } from "drizzle-orm/pg-core";
import { merchantsTable } from "./merchants";

// txn_type values:
//   pending_credit      — payment success → pending balance up, total_collection up
//   settlement_transfer — settlement approved → pending down, available up
//   withdrawal_debit    — withdrawal approved → available down, total_payout up
//   reversal            — failed payout reversed → available up, total_reversals up
//   hold_created        — admin hold → available down, hold_balance up
//   hold_released       — admin release → hold down, available up
//   charge              — fee/charge → available down, total_charges up
//   refund              — refund credited → available up, total_refunds up
//   manual_credit       — admin manual credit → any bucket up
//   manual_debit        — admin manual debit → any bucket down

export const walletLedgerTable = pgTable(
  "wallet_ledger",
  {
    id: serial("id").primaryKey(),
    merchantId: integer("merchant_id").notNull().references(() => merchantsTable.id, { onDelete: "cascade" }),
    txnType: text("txn_type").notNull(),
    bucket: text("bucket").notNull(), // available | pending | hold | settlement | payout
    amount: numeric("amount", { precision: 18, scale: 2 }).notNull(), // signed: positive=credit, negative=debit for that bucket

    availableBefore:  numeric("available_before",  { precision: 18, scale: 2 }).notNull().default("0"),
    availableAfter:   numeric("available_after",   { precision: 18, scale: 2 }).notNull().default("0"),
    pendingBefore:    numeric("pending_before",    { precision: 18, scale: 2 }).notNull().default("0"),
    pendingAfter:     numeric("pending_after",     { precision: 18, scale: 2 }).notNull().default("0"),

    referenceType: text("reference_type"), // transaction | settlement | withdrawal | hold | charge | manual
    referenceId:   integer("reference_id"),
    description:   text("description").notNull(),
    createdBy:     integer("created_by"), // admin userId; null = system
    createdAt:     timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("wallet_ledger_merchant_created_idx").on(table.merchantId, table.createdAt),
    index("wallet_ledger_txn_type_idx").on(table.txnType),
  ]
);

export type WalletLedgerEntry = typeof walletLedgerTable.$inferSelect;
