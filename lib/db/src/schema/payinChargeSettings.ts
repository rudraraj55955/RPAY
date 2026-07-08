import { pgTable, serial, boolean, numeric, text, integer, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { merchantsTable } from "./merchants";

export const payinChargeSettingsTable = pgTable("payin_charge_settings", {
  id: serial("id").primaryKey(),
  enabled: boolean("enabled").notNull().default(false),
  mdrPct: numeric("mdr_pct", { precision: 8, scale: 4 }).notNull().default("0"),
  fixedFee: numeric("fixed_fee", { precision: 18, scale: 2 }).notNull().default("0"),
  minFee: numeric("min_fee", { precision: 18, scale: 2 }).notNull().default("0"),
  maxFee: numeric("max_fee", { precision: 18, scale: 2 }),
  gstPct: numeric("gst_pct", { precision: 8, scale: 4 }).notNull().default("18"),
  gstEnabled: boolean("gst_enabled").notNull().default(false),
  roundingMode: text("rounding_mode").notNull().default("round"),
  applyToOwnStaticUpi: boolean("apply_to_own_static_upi").notNull().default(true),
  applyToDynamicQr: boolean("apply_to_dynamic_qr").notNull().default(true),
  applyToPaymentLinks: boolean("apply_to_payment_links").notNull().default(true),
  applyToApiGateway: boolean("apply_to_api_gateway").notNull().default(true),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
  updatedByEmail: text("updated_by_email"),
});

export const merchantChargeOverridesTable = pgTable(
  "merchant_charge_overrides",
  {
    id: serial("id").primaryKey(),
    merchantId: integer("merchant_id").notNull().references(() => merchantsTable.id, { onDelete: "cascade" }),
    useGlobal: boolean("use_global").notNull().default(true),
    customEnabled: boolean("custom_enabled").notNull().default(false),
    mdrPct: numeric("mdr_pct", { precision: 8, scale: 4 }),
    fixedFee: numeric("fixed_fee", { precision: 18, scale: 2 }),
    minFee: numeric("min_fee", { precision: 18, scale: 2 }),
    maxFee: numeric("max_fee", { precision: 18, scale: 2 }),
    gstPct: numeric("gst_pct", { precision: 8, scale: 4 }),
    gstEnabled: boolean("gst_enabled"),
    roundingMode: text("rounding_mode"),
    notes: text("notes"),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
    updatedByEmail: text("updated_by_email"),
  },
  (table) => [uniqueIndex("merchant_charge_overrides_merchant_id_uniq").on(table.merchantId)],
);

export type PayinChargeSettings = typeof payinChargeSettingsTable.$inferSelect;
export type MerchantChargeOverride = typeof merchantChargeOverridesTable.$inferSelect;
