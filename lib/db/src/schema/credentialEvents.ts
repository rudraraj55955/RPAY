import { pgTable, serial, integer, text, timestamp, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const credentialEventsTable = pgTable("credential_events", {
  id: serial("id").primaryKey(),
  merchantId: integer("merchant_id").notNull(),
  eventType: text("event_type").notNull(), // callback_secret_rotated | api_key_generated | api_key_revoked
  keyPrefix: text("key_prefix"), // populated for api_key_generated / api_key_revoked events
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index("credential_events_merchant_idx").on(table.merchantId, table.createdAt),
]);

export const insertCredentialEventSchema = createInsertSchema(credentialEventsTable).omit({ id: true, createdAt: true });
export type InsertCredentialEvent = z.infer<typeof insertCredentialEventSchema>;
export type CredentialEvent = typeof credentialEventsTable.$inferSelect;
