import { pgTable, serial, integer, boolean, numeric, timestamp, index } from "drizzle-orm/pg-core";

export const providerVisibilityTable = pgTable("provider_visibility", {
  id: serial("id").primaryKey(),
  providerId: integer("provider_id").notNull(),
  merchantId: integer("merchant_id"),    // null = global rule
  visible: boolean("visible").notNull().default(true),
  minAmount: numeric("min_amount", { precision: 18, scale: 2 }),
  maxAmount: numeric("max_amount", { precision: 18, scale: 2 }),
  dailyLimit: numeric("daily_limit", { precision: 18, scale: 2 }),
  priorityOverride: integer("priority_override"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index("pv_provider_merchant_idx").on(table.providerId, table.merchantId),
]);

export type ProviderVisibility = typeof providerVisibilityTable.$inferSelect;
