import { pgTable, serial, integer, text, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const qrCodesTable = pgTable("qr_codes", {
  id: serial("id").primaryKey(),
  merchantId: integer("merchant_id").notNull(),
  type: text("type").notNull(), // static | dynamic
  label: text("label"),
  payload: text("payload").notNull(), // UPI QR string or URL
  amount: text("amount"), // fixed amount for static, null for dynamic
  orderId: text("order_id"),
  callbackUrl: text("callback_url"),
  merchantReference: text("merchant_reference"),
  expiresAt: timestamp("expires_at", { withTimezone: true }),
  ekqrOrderId: text("ekqr_order_id"),       // EKQR order ID returned by create_order
  ekqrPaymentUrl: text("ekqr_payment_url"), // EKQR hosted payment URL (for non-UPI clients)
  providerKey: text("provider_key"),                 // set when dispatched through an admin-added custom gateway (provider_integrations.providerKey)
  providerOrderId: text("provider_order_id"),         // custom gateway's order/reference id
  providerPaymentUrl: text("provider_payment_url"),   // custom gateway's hosted payment URL, if any
  status: text("status").notNull().default("active"), // active | inactive | expired | used
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertQrCodeSchema = createInsertSchema(qrCodesTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertQrCode = z.infer<typeof insertQrCodeSchema>;
export type QrCode = typeof qrCodesTable.$inferSelect;
