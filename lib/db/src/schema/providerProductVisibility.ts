import { pgTable, serial, varchar, integer, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

export const providerProductVisibilityTable = pgTable("provider_product_visibility", {
  id: serial("id").primaryKey(),
  productKey: varchar("product_key", { length: 64 }).notNull(),
  merchantId: integer("merchant_id").notNull(),
  visibilityStatus: varchar("visibility_status", { length: 32 }).notNull().default("visible"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (t) => [
  uniqueIndex("ppv_product_merchant_uidx").on(t.productKey, t.merchantId),
]);

export type ProviderProductVisibility = typeof providerProductVisibilityTable.$inferSelect;
