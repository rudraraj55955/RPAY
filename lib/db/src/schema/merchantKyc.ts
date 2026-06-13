import { pgTable, text, serial, timestamp, integer, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { merchantsTable } from "./merchants";

export const merchantKycTable = pgTable(
  "merchant_kyc",
  {
    id: serial("id").primaryKey(),
    merchantId: integer("merchant_id").notNull().references(() => merchantsTable.id, { onDelete: "cascade" }),
    docType: text("doc_type").notNull(), // pan | gst | bank_details | business_proof
    fileUrl: text("file_url").notNull(), // objectPath from object storage
    fileName: text("file_name"),
    status: text("status").notNull().default("pending"), // pending | approved | rejected
    adminNote: text("admin_note"),
    reviewedBy: integer("reviewed_by"),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
  },
  (table) => [
    index("merchant_kyc_merchant_id_idx").on(table.merchantId),
    index("merchant_kyc_status_idx").on(table.status),
  ]
);

export const insertMerchantKycSchema = createInsertSchema(merchantKycTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertMerchantKyc = z.infer<typeof insertMerchantKycSchema>;
export type MerchantKyc = typeof merchantKycTable.$inferSelect;
