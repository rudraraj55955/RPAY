import { pgTable, serial, varchar, integer, text, timestamp } from "drizzle-orm/pg-core";

export const activationRequestsTable = pgTable("activation_requests", {
  id: serial("id").primaryKey(),
  merchantId: integer("merchant_id").notNull(),
  productKey: varchar("product_key", { length: 64 }).notNull(),
  status: varchar("status", { length: 32 }).notNull().default("pending"),
  note: text("note"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export type ActivationRequest = typeof activationRequestsTable.$inferSelect;
export type ActivationRequestInsert = typeof activationRequestsTable.$inferInsert;
