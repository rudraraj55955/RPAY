import { pgTable, text, serial, timestamp, boolean, integer } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const merchantKycSettingsTable = pgTable("merchant_kyc_settings", {
  id: serial("id").primaryKey(),
  panApiEnabled: boolean("pan_api_enabled").notNull().default(true),
  aadhaarApiEnabled: boolean("aadhaar_api_enabled").notNull().default(true),
  mode: text("mode").notNull().default("test"),
  clientIdEncrypted: text("client_id_encrypted"),
  clientIdIv: text("client_id_iv"),
  clientIdTag: text("client_id_tag"),
  clientSecretEncrypted: text("client_secret_encrypted"),
  clientSecretIv: text("client_secret_iv"),
  clientSecretTag: text("client_secret_tag"),
  baseUrl: text("base_url"),
  minNameMatchScore: integer("min_name_match_score").notNull().default(80),
  autoApproveEnabled: boolean("auto_approve_enabled").notNull().default(true),
  duplicateCheckEnabled: boolean("duplicate_check_enabled").notNull().default(true),
  dailyVerificationLimit: integer("daily_verification_limit").notNull().default(200),
  perMerchantAttemptLimit: integer("per_merchant_attempt_limit").notNull().default(5),
  updatedByEmail: text("updated_by_email"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertMerchantKycSettingsSchema = createInsertSchema(merchantKycSettingsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertMerchantKycSettings = z.infer<typeof insertMerchantKycSettingsSchema>;
export type MerchantKycSettings = typeof merchantKycSettingsTable.$inferSelect;
