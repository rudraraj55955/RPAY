import { pgTable, text, serial, timestamp, integer, boolean, index } from "drizzle-orm/pg-core";

export const providersTable = pgTable("providers", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  logoUrl: text("logo_url"),
  category: text("category").notNull().default("upi"), // upi | bank | gateway
  status: text("status").notNull().default("live"),    // live | testing | coming_soon | disabled
  description: text("description"),
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index("providers_slug_idx").on(table.slug),
  index("providers_sort_idx").on(table.sortOrder),
]);

export type Provider = typeof providersTable.$inferSelect;
