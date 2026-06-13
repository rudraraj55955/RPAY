import { Router } from "express";
import { db, supportTicketsTable, ticketRepliesTable, merchantsTable, usersTable } from "@workspace/db";
import { eq, and, desc, count, inArray } from "drizzle-orm";
import { requireAuth, requireAdmin } from "../middlewares/auth";
import { createNotification } from "../helpers/notifications";

const router = Router();
router.use(requireAuth);

function mapTicket(
  t: typeof supportTicketsTable.$inferSelect,
  merchantName?: string | null,
) {
  return {
    id: t.id,
    merchantId: t.merchantId,
    userId: t.userId,
    merchantName: merchantName ?? null,
    category: t.category,
    subject: t.subject,
    message: t.message,
    screenshotUrl: t.screenshotUrl ?? null,
    status: t.status,
    priority: t.priority,
    resolvedAt: t.resolvedAt ? t.resolvedAt.toISOString() : null,
    createdAt: t.createdAt.toISOString(),
    updatedAt: t.updatedAt.toISOString(),
  };
}

function mapReply(
  r: typeof ticketRepliesTable.$inferSelect,
  authorName?: string | null,
) {
  return {
    id: r.id,
    ticketId: r.ticketId,
    authorId: r.authorId,
    authorRole: r.authorRole,
    authorName: authorName ?? null,
    message: r.message,
    createdAt: r.createdAt.toISOString(),
  };
}

// GET /api/support/tickets/stats  (admin only)
router.get("/tickets/stats", requireAdmin, async (_req, res, next) => {
  try {
    const rows = await db
      .select({ status: supportTicketsTable.status, cnt: count() })
      .from(supportTicketsTable)
      .groupBy(supportTicketsTable.status);

    const counts: Record<string, number> = {};
    for (const r of rows) counts[r.status] = Number(r.cnt);

    res.json({
      open: counts["open"] ?? 0,
      inProgress: counts["in-progress"] ?? 0,
      resolved: counts["resolved"] ?? 0,
      total: Object.values(counts).reduce((a, b) => a + b, 0),
    });
  } catch (err) {
    next(err);
  }
});

// GET /api/support/tickets
router.get("/tickets", async (req, res, next) => {
  try {
    const user = (req as any).user;
    const { status, category, priority, merchantId, page = "1", limit = "20" } =
      req.query as Record<string, string>;
    const pageNum = Math.max(1, parseInt(page));
    const limitNum = Math.min(100, Math.max(1, parseInt(limit)));
    const offset = (pageNum - 1) * limitNum;

    const conditions: any[] = [];

    if (user.role !== "admin") {
      if (!user.merchantId) {
        res.json({ data: [], total: 0, page: pageNum, limit: limitNum });
        return;
      }
      conditions.push(eq(supportTicketsTable.merchantId, user.merchantId));
    } else if (merchantId) {
      conditions.push(eq(supportTicketsTable.merchantId, parseInt(merchantId)));
    }

    if (status) conditions.push(eq(supportTicketsTable.status, status));
    if (category) conditions.push(eq(supportTicketsTable.category, category));
    if (priority) conditions.push(eq(supportTicketsTable.priority, priority));

    const where = conditions.length > 0 ? and(...conditions) : undefined;

    const [{ total }] = await db
      .select({ total: count() })
      .from(supportTicketsTable)
      .where(where);

    const tickets = await db
      .select()
      .from(supportTicketsTable)
      .where(where)
      .orderBy(desc(supportTicketsTable.createdAt))
      .limit(limitNum)
      .offset(offset);

    let merchantNameMap: Record<number, string> = {};
    if (user.role === "admin" && tickets.length > 0) {
      const merchantIds = [...new Set(tickets.map((t) => t.merchantId))];
      const merchants = await db
        .select({ id: merchantsTable.id, businessName: merchantsTable.businessName })
        .from(merchantsTable)
        .where(inArray(merchantsTable.id, merchantIds));
      for (const m of merchants) merchantNameMap[m.id] = m.businessName;
    }

    res.json({
      data: tickets.map((t) => mapTicket(t, merchantNameMap[t.merchantId])),
      total: Number(total),
      page: pageNum,
      limit: limitNum,
    });
  } catch (err) {
    next(err);
  }
});

// POST /api/support/tickets  (merchant only)
router.post("/tickets", async (req, res, next) => {
  try {
    const user = (req as any).user;
    if (user.role === "admin") {
      res.status(403).json({ error: "Only merchants can raise support tickets" });
      return;
    }
    if (!user.merchantId) {
      res.status(403).json({ error: "No merchant account linked" });
      return;
    }

    const { category, subject, message, screenshotUrl } = req.body;
    if (!category?.trim() || !subject?.trim() || !message?.trim()) {
      res.status(400).json({ error: "category, subject, and message are required" });
      return;
    }
    const validCategories = ["payments", "account", "technical", "billing"];
    if (!validCategories.includes(category)) {
      res.status(400).json({ error: `category must be one of: ${validCategories.join(", ")}` });
      return;
    }

    const [ticket] = await db
      .insert(supportTicketsTable)
      .values({
        merchantId: user.merchantId,
        userId: user.id,
        category: category.trim(),
        subject: subject.trim(),
        message: message.trim(),
        screenshotUrl: screenshotUrl?.trim() || null,
        status: "open",
        priority: "normal",
      })
      .returning();

    // Notify all admins about the new ticket
    const admins = await db
      .select({ id: usersTable.id })
      .from(usersTable)
      .where(eq(usersTable.role, "admin"));

    const [merchant] = await db
      .select({ businessName: merchantsTable.businessName })
      .from(merchantsTable)
      .where(eq(merchantsTable.id, user.merchantId))
      .limit(1);

    for (const admin of admins) {
      await createNotification({
        userId: admin.id,
        type: "system_notice",
        title: "New Support Ticket",
        body: `${merchant?.businessName ?? "A merchant"} raised a ticket: "${ticket.subject}"`,
        metadata: { ticketId: ticket.id, merchantId: user.merchantId, category: ticket.category },
      });
    }

    res.status(201).json(mapTicket(ticket));
  } catch (err) {
    next(err);
  }
});

// GET /api/support/tickets/:id
router.get("/tickets/:id", async (req, res, next) => {
  try {
    const user = (req as any).user;
    const id = parseInt(req.params["id"] as string);

    const [ticket] = await db
      .select()
      .from(supportTicketsTable)
      .where(eq(supportTicketsTable.id, id))
      .limit(1);

    if (!ticket) {
      res.status(404).json({ error: "Ticket not found" });
      return;
    }

    if (user.role !== "admin" && ticket.merchantId !== user.merchantId) {
      res.status(404).json({ error: "Ticket not found" });
      return;
    }

    const replies = await db
      .select()
      .from(ticketRepliesTable)
      .where(eq(ticketRepliesTable.ticketId, id))
      .orderBy(ticketRepliesTable.createdAt);

    let merchantName: string | null = null;
    if (user.role === "admin") {
      const [m] = await db
        .select({ businessName: merchantsTable.businessName })
        .from(merchantsTable)
        .where(eq(merchantsTable.id, ticket.merchantId))
        .limit(1);
      merchantName = m?.businessName ?? null;
    }

    const authorIds = [...new Set(replies.map((r) => r.authorId))];
    let nameMap: Record<number, string> = {};
    if (authorIds.length > 0) {
      const users = await db
        .select({ id: usersTable.id, name: usersTable.name })
        .from(usersTable)
        .where(inArray(usersTable.id, authorIds));
      for (const u of users) nameMap[u.id] = u.name;
    }

    res.json({
      ticket: mapTicket(ticket, merchantName),
      replies: replies.map((r) => mapReply(r, nameMap[r.authorId])),
    });
  } catch (err) {
    next(err);
  }
});

// PATCH /api/support/tickets/:id/status  (admin only)
router.patch("/tickets/:id/status", requireAdmin, async (req, res, next) => {
  try {
    const id = parseInt(req.params["id"] as string);
    const { status, priority } = req.body;

    const validStatuses = ["open", "in-progress", "resolved"];
    const validPriorities = ["low", "normal", "high", "urgent"];

    if (status && !validStatuses.includes(status)) {
      res.status(400).json({ error: `status must be one of: ${validStatuses.join(", ")}` });
      return;
    }
    if (priority && !validPriorities.includes(priority)) {
      res.status(400).json({ error: `priority must be one of: ${validPriorities.join(", ")}` });
      return;
    }

    const [ticket] = await db
      .select()
      .from(supportTicketsTable)
      .where(eq(supportTicketsTable.id, id))
      .limit(1);

    if (!ticket) {
      res.status(404).json({ error: "Ticket not found" });
      return;
    }

    const updates: Record<string, any> = {};
    if (status) updates.status = status;
    if (priority) updates.priority = priority;
    if (status === "resolved") updates.resolvedAt = new Date();
    if (status && status !== "resolved") updates.resolvedAt = null;

    const [updated] = await db
      .update(supportTicketsTable)
      .set(updates)
      .where(eq(supportTicketsTable.id, id))
      .returning();

    // Notify the merchant
    if (status && status !== ticket.status) {
      const statusLabel: Record<string, string> = {
        open: "Open",
        "in-progress": "In Progress",
        resolved: "Resolved",
      };
      await createNotification({
        userId: ticket.userId,
        type: "system_notice",
        title: "Support Ticket Updated",
        body: `Your ticket "${ticket.subject}" is now ${statusLabel[status] ?? status}.`,
        metadata: { ticketId: ticket.id, status },
      });
    }

    res.json(mapTicket(updated));
  } catch (err) {
    next(err);
  }
});

// POST /api/support/tickets/:id/replies
router.post("/tickets/:id/replies", async (req, res, next) => {
  try {
    const user = (req as any).user;
    const id = parseInt(req.params["id"] as string);
    const { message } = req.body;

    if (!message?.trim()) {
      res.status(400).json({ error: "message is required" });
      return;
    }

    const [ticket] = await db
      .select()
      .from(supportTicketsTable)
      .where(eq(supportTicketsTable.id, id))
      .limit(1);

    if (!ticket) {
      res.status(404).json({ error: "Ticket not found" });
      return;
    }

    if (user.role !== "admin" && ticket.merchantId !== user.merchantId) {
      res.status(404).json({ error: "Ticket not found" });
      return;
    }

    const [reply] = await db
      .insert(ticketRepliesTable)
      .values({
        ticketId: id,
        authorId: user.id,
        authorRole: user.role,
        message: message.trim(),
      })
      .returning();

    // If admin replied, notify the merchant; if merchant replied, notify admins
    if (user.role === "admin") {
      await createNotification({
        userId: ticket.userId,
        type: "system_notice",
        title: "Support Ticket Reply",
        body: `Support replied to your ticket "${ticket.subject}".`,
        metadata: { ticketId: ticket.id },
      });

      // Move ticket to in-progress if still open
      if (ticket.status === "open") {
        await db
          .update(supportTicketsTable)
          .set({ status: "in-progress" })
          .where(eq(supportTicketsTable.id, id));
      }
    } else {
      // Notify admins of merchant follow-up
      const admins = await db
        .select({ id: usersTable.id })
        .from(usersTable)
        .where(eq(usersTable.role, "admin"));

      for (const admin of admins) {
        await createNotification({
          userId: admin.id,
          type: "system_notice",
          title: "Merchant Replied to Ticket",
          body: `A merchant replied to ticket "${ticket.subject}".`,
          metadata: { ticketId: ticket.id, merchantId: ticket.merchantId },
        });
      }
    }

    res.status(201).json(mapReply(reply, user.name));
  } catch (err) {
    next(err);
  }
});

export default router;
