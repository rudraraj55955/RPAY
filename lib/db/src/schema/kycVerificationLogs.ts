import { pgTable, text, serial, timestamp, integer } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const kycVerificationLogsTable = pgTable("kyc_verification_logs", {
  id: serial("id").primaryKey(),
  merchantId: integer("merchant_id").notNull(),
  verificationType: text("verification_type").notNull(),
  status: text("status").notNull(),
  requestMasked: text("request_masked"),
  responseMasked: text("response_masked"),
  providerReferenceIdEncrypted: text("provider_reference_id_encrypted"),
  providerReferenceIdIv: text("provider_reference_id_iv"),
  providerReferenceIdTag: text("provider_reference_id_tag"),
  errorReason: text("error_reason"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertKycVerificationLogSchema = createInsertSchema(kycVerificationLogsTable).omit({ id: true, createdAt: true });
export type InsertKycVerificationLog = z.infer<typeof insertKycVerificationLogSchema>;
export type KycVerificationLog = typeof kycVerificationLogsTable.$inferSelect;
