import { Router } from "express";
import { db, credentialEventsTable, merchantTrustedIpsTable } from "@workspace/db";
import { eq, and, gte, lte, desc, count, min, max, isNotNull } from "drizzle-orm";
import { requireAuth } from "../middlewares/auth";

const router = Router();
router.use(requireAuth);

// GET /api/security/events
router.get("/events", async (req, res, next) => {
  try {
    const user = (req as any).user;
    if (user.role !== "merchant" || !user.merchantId) {
      res.status(403).json({ error: "Merchant access only" });
      return;
    }

    const { page = "1", limit = "50", dateFrom, dateTo, eventType, ipAddress } = req.query as Record<string, string>;
    const pageNum = Math.max(1, parseInt(page));
    const limitNum = Math.min(200, Math.max(1, parseInt(limit)));
    const offset = (pageNum - 1) * limitNum;

    const conditions: any[] = [eq(credentialEventsTable.merchantId, user.merchantId)];

    if (eventType && eventType !== "all") {
      conditions.push(eq(credentialEventsTable.eventType, eventType));
    }
    if (ipAddress) {
      conditions.push(eq(credentialEventsTable.ipAddress, ipAddress));
    }
    const dateRe = /^\d{4}-\d{2}-\d{2}$/;
    if (dateFrom && dateRe.test(dateFrom)) {
      const [y, m, d] = dateFrom.split("-").map(Number);
      const from = new Date(Date.UTC(y, m - 1, d, 0, 0, 0, 0));
      if (!isNaN(from.getTime())) conditions.push(gte(credentialEventsTable.createdAt, from));
    }
    if (dateTo && dateRe.test(dateTo)) {
      const [y, m, d] = dateTo.split("-").map(Number);
      const to = new Date(Date.UTC(y, m - 1, d, 23, 59, 59, 999));
      if (!isNaN(to.getTime())) conditions.push(lte(credentialEventsTable.createdAt, to));
    }

    const where = and(...conditions);

    const [{ total }] = await db
      .select({ total: count() })
      .from(credentialEventsTable)
      .where(where);

    const rows = await db
      .select()
      .from(credentialEventsTable)
      .where(where)
      .orderBy(desc(credentialEventsTable.createdAt))
      .limit(limitNum)
      .offset(offset);

    res.json({
      data: rows.map(r => ({
        id: r.id,
        eventType: r.eventType,
        actorEmail: r.actorEmail,
        keyPrefix: r.keyPrefix,
        ipAddress: r.ipAddress,
        occurredAt: r.createdAt.toISOString(),
      })),
      total: Number(total),
      page: pageNum,
      limit: limitNum,
    });
  } catch (err) {
    next(err);
  }
});

// GET /api/security/known-ips
router.get("/known-ips", async (req, res, next) => {
  try {
    const user = (req as any).user;
    if (user.role !== "merchant" || !user.merchantId) {
      res.status(403).json({ error: "Merchant access only" });
      return;
    }

    const rows = await db
      .select({
        ipAddress: credentialEventsTable.ipAddress,
        firstSeen: min(credentialEventsTable.createdAt),
        lastSeen: max(credentialEventsTable.createdAt),
      })
      .from(credentialEventsTable)
      .where(
        and(
          eq(credentialEventsTable.merchantId, user.merchantId),
          eq(credentialEventsTable.eventType, "merchant_login"),
          isNotNull(credentialEventsTable.ipAddress)
        )
      )
      .groupBy(credentialEventsTable.ipAddress)
      .orderBy(desc(max(credentialEventsTable.createdAt)))
      .limit(10);

    // Fetch labels for these IPs
    const labelRows = rows.length > 0
      ? await db
          .select()
          .from(merchantTrustedIpsTable)
          .where(eq(merchantTrustedIpsTable.merchantId, user.merchantId))
      : [];

    const labelMap = new Map(labelRows.map(r => [r.ipAddress, r]));

    res.json({
      data: rows.map(r => {
        const labelEntry = labelMap.get(r.ipAddress as string);
        return {
          ipAddress: r.ipAddress as string,
          firstSeen: (r.firstSeen as Date).toISOString(),
          lastSeen: (r.lastSeen as Date).toISOString(),
          label: labelEntry?.label ?? null,
          labeledAt: labelEntry?.labeledAt?.toISOString() ?? null,
        };
      }),
    });
  } catch (err) {
    next(err);
  }
});

// PATCH /api/security/known-ips/:ipAddress/label
router.patch("/known-ips/:ipAddress/label", async (req, res, next) => {
  try {
    const user = (req as any).user;
    if (user.role !== "merchant" || !user.merchantId) {
      res.status(403).json({ error: "Merchant access only" });
      return;
    }

    const ipAddress = req.params['ipAddress'] as string;
    const { label } = req.body as { label: "trusted" | "suspicious" | null };

    if (label !== null && label !== "trusted" && label !== "suspicious") {
      res.status(400).json({ message: "label must be 'trusted', 'suspicious', or null" });
      return;
    }

    // Verify IP is a known login IP for this merchant
    const [knownRow] = await db
      .select({
        ipAddress: credentialEventsTable.ipAddress,
        firstSeen: min(credentialEventsTable.createdAt),
        lastSeen: max(credentialEventsTable.createdAt),
      })
      .from(credentialEventsTable)
      .where(
        and(
          eq(credentialEventsTable.merchantId, user.merchantId),
          eq(credentialEventsTable.eventType, "merchant_login"),
          eq(credentialEventsTable.ipAddress, ipAddress)
        )
      )
      .groupBy(credentialEventsTable.ipAddress)
      .limit(1);

    if (!knownRow) {
      res.status(400).json({ message: "IP address not found in known login list" });
      return;
    }

    if (label === null) {
      // Clear the label
      await db
        .delete(merchantTrustedIpsTable)
        .where(
          and(
            eq(merchantTrustedIpsTable.merchantId, user.merchantId),
            eq(merchantTrustedIpsTable.ipAddress, ipAddress)
          )
        );

      res.json({
        ipAddress: knownRow.ipAddress as string,
        firstSeen: (knownRow.firstSeen as Date).toISOString(),
        lastSeen: (knownRow.lastSeen as Date).toISOString(),
        label: null,
        labeledAt: null,
      });
      return;
    }

    // Upsert the label
    const now = new Date();
    const existing = await db
      .select()
      .from(merchantTrustedIpsTable)
      .where(
        and(
          eq(merchantTrustedIpsTable.merchantId, user.merchantId),
          eq(merchantTrustedIpsTable.ipAddress, ipAddress)
        )
      )
      .limit(1);

    if (existing.length > 0) {
      await db
        .update(merchantTrustedIpsTable)
        .set({ label, labeledAt: now })
        .where(
          and(
            eq(merchantTrustedIpsTable.merchantId, user.merchantId),
            eq(merchantTrustedIpsTable.ipAddress, ipAddress)
          )
        );
    } else {
      await db
        .insert(merchantTrustedIpsTable)
        .values({
          userId: user.id,
          merchantId: user.merchantId,
          ipAddress,
          label,
          labeledAt: now,
        });
    }

    res.json({
      ipAddress: knownRow.ipAddress as string,
      firstSeen: (knownRow.firstSeen as Date).toISOString(),
      lastSeen: (knownRow.lastSeen as Date).toISOString(),
      label,
      labeledAt: now.toISOString(),
    });
  } catch (err) {
    next(err);
  }
});

export default router;
