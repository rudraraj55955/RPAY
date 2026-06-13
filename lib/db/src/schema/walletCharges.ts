import { pgTable, text, serial, timestamp, numeric, integer, index } from "drizzle-orm/pg-core";
import { merchantsTable } from "./merchants";

export const walletChargesTable = pgTable(
  "wallet_charges",
  {
    id: serial("id").primaryKey(),
    merchantId: integer("merchant_id").notNull().references(() => merchantsTable.id, { onDelete: "cascade" }),
    amount: numeric("amount", { precision: 18, scale: 2 }).notNull(), // always positive
    chargeType: text("charge_type").notNull().default("fee"), // fee | platform | gst | other
    description: text("description").notNull(),
    referenceType: text("reference_type"),
    referenceId: integer("reference_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("wallet_charges_merchant_idx").on(table.merchantId),
  ]
);

export type WalletCharge = typeof walletChargesTable.$inferSelect;
