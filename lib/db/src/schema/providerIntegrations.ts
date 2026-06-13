import { pgTable, serial, varchar, text, boolean, timestamp } from "drizzle-orm/pg-core";

export const providerIntegrationsTable = pgTable("provider_integrations", {
  id: serial("id").primaryKey(),
  providerKey: varchar("provider_key", { length: 64 }).notNull().unique(),
  providerNameInternal: varchar("provider_name_internal", { length: 255 }).notNull(),
  displayNamePublic: varchar("display_name_public", { length: 255 }).notNull(),
  environment: text("environment").notNull().default("test"),
  isEnabled: boolean("is_enabled").notNull().default(false),
  productType: varchar("product_type", { length: 100 }),
  webhookUrl: text("webhook_url"),
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
  updatedByEmail: varchar("updated_by_email", { length: 255 }),
});

export type ProviderIntegration = typeof providerIntegrationsTable.$inferSelect;
export type ProviderIntegrationInsert = typeof providerIntegrationsTable.$inferInsert;
