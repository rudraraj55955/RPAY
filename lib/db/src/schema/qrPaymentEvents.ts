import { pgTable, serial, integer, text, timestamp, numeric } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const qrPaymentEventsTable = pgTable("qr_payment_events", {
  id: serial("id").primaryKey(),
  qrCodeId: integer("qr_code_id").notNull(),
  merchantId: integer("merchant_id").notNull(),
  transactionId: integer("transaction_id"),
  amount: text("amount"),
  orderId: text("order_id"),
  merchantReference: text("merchant_reference"),
  receivedAt: timestamp("received_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertQrPaymentEventSchema = createInsertSchema(qrPaymentEventsTable).omit({ id: true, receivedAt: true });
export type InsertQrPaymentEvent = z.infer<typeof insertQrPaymentEventSchema>;
export type QrPaymentEvent = typeof qrPaymentEventsTable.$inferSelect;
