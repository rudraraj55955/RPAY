import { pgTable, text, serial, integer, timestamp, index } from "drizzle-orm/pg-core";

export const supportTicketsTable = pgTable("support_tickets", {
  id: serial("id").primaryKey(),
  merchantId: integer("merchant_id").notNull(),
  userId: integer("user_id").notNull(),
  category: text("category").notNull(), // payments | account | technical | billing
  subject: text("subject").notNull(),
  message: text("message").notNull(),
  screenshotUrl: text("screenshot_url"),
  status: text("status").notNull().default("open"), // open | in-progress | resolved
  priority: text("priority").notNull().default("normal"), // low | normal | high | urgent
  resolvedAt: timestamp("resolved_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (table) => [
  index("support_tickets_merchant_idx").on(table.merchantId, table.status, table.createdAt),
  index("support_tickets_status_idx").on(table.status, table.createdAt),
]);

export const ticketRepliesTable = pgTable("ticket_replies", {
  id: serial("id").primaryKey(),
  ticketId: integer("ticket_id").notNull(),
  authorId: integer("author_id").notNull(),
  authorRole: text("author_role").notNull(), // admin | merchant
  message: text("message").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index("ticket_replies_ticket_idx").on(table.ticketId, table.createdAt),
]);

export type SupportTicket = typeof supportTicketsTable.$inferSelect;
export type TicketReply = typeof ticketRepliesTable.$inferSelect;
