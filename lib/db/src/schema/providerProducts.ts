import { pgTable, serial, varchar, text, boolean, integer, timestamp } from "drizzle-orm/pg-core";

export const providerProductsTable = pgTable("provider_products", {
  id: serial("id").primaryKey(),
  providerKey: varchar("provider_key", { length: 64 }),
  productKey: varchar("product_key", { length: 64 }).notNull().unique(),
  publicName: varchar("public_name", { length: 255 }).notNull(),
  internalName: varchar("internal_name", { length: 255 }),
  description: text("description"),
  iconKey: varchar("icon_key", { length: 64 }),
  isEnabled: boolean("is_enabled").notNull().default(true),
  status: varchar("status", { length: 32 }).notNull().default("coming_soon"),
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export type ProviderProduct = typeof providerProductsTable.$inferSelect;
export type ProviderProductInsert = typeof providerProductsTable.$inferInsert;
