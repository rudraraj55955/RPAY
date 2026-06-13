import { pgTable, text, serial, timestamp, numeric, integer, index } from "drizzle-orm/pg-core";
import { merchantsTable } from "./merchants";

export const walletHoldsTable = pgTable(
  "wallet_holds",
  {
    id: serial("id").primaryKey(),
    merchantId: integer("merchant_id").notNull().references(() => merchantsTable.id, { onDelete: "cascade" }),
    amount: numeric("amount", { precision: 18, scale: 2 }).notNull(),
    reason: text("reason").notNull(),
    status: text("status").notNull().default("active"), // active | released | expired
    createdBy: integer("created_by").notNull(),
    releasedBy: integer("released_by"),
    releasedAt: timestamp("released_at", { withTimezone: true }),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
  },
  (table) => [
    index("wallet_holds_merchant_status_idx").on(table.merchantId, table.status),
  ]
);

export type WalletHold = typeof walletHoldsTable.$inferSelect;
