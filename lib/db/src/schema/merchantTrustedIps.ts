import { pgTable, serial, integer, text, timestamp } from "drizzle-orm/pg-core";
import { usersTable } from "./users";
import { merchantsTable } from "./merchants";

export const merchantTrustedIpsTable = pgTable("merchant_trusted_ips", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  merchantId: integer("merchant_id").notNull().references(() => merchantsTable.id, { onDelete: "cascade" }),
  ipAddress: text("ip_address").notNull(),
  label: text("label").notNull(),
  labeledAt: timestamp("labeled_at", { withTimezone: true }).notNull().defaultNow(),
});

export type MerchantTrustedIp = typeof merchantTrustedIpsTable.$inferSelect;
