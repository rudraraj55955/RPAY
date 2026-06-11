import { pgTable, serial, integer, text, timestamp } from "drizzle-orm/pg-core";

export const storageCleanupRunsTable = pgTable("storage_cleanup_runs", {
  id: serial("id").primaryKey(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  totalScanned: integer("total_scanned").notNull().default(0),
  deleted: integer("deleted").notNull().default(0),
  errors: integer("errors").notNull().default(0),
  triggeredBy: text("triggered_by"),
});

export type StorageCleanupRun = typeof storageCleanupRunsTable.$inferSelect;
