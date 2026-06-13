/**
 * Provider Integrations — Super-Admin-only API
 *
 * Manages the white-label provider architecture:
 *   GET  /api/provider-integrations            — list all backend integrations (admin sees Cashfree names)
 *   PUT  /api/provider-integrations/:key       — update metadata (env, enabled, notes, webhookUrl)
 *   GET  /api/provider-products                — list RasoKart service catalogue (admin sees internal names)
 *   PUT  /api/provider-products/:key           — update product metadata / status (admin only)
 *   GET  /api/activation-requests              — list activation requests (admin: all, merchant: own)
 *   POST /api/activation-requests              — merchant creates a request
 *   PUT  /api/activation-requests/:id          — admin approves / rejects
 *   GET  /api/provider-product-visibility      — list per-merchant visibility overrides
 *   PUT  /api/provider-product-visibility      — set visibility for a merchant+product pair
 */

import { Router } from "express";
import {
  db,
  providerIntegrationsTable,
  providerProductsTable,
  providerProductVisibilityTable,
  activationRequestsTable,
  merchantsTable,
  auditLogsTable,
} from "@workspace/db";
import { eq, and, asc, desc } from "drizzle-orm";
import { requireAuth, requireAdmin } from "../middlewares/auth";

const router = Router();
router.use(requireAuth);

// ── Provider Integrations ─────────────────────────────────────────────────────

/** GET /api/provider-integrations */
router.get("/integrations", requireAdmin, async (req, res, next) => {
  try {
    const rows = await db.select().from(providerIntegrationsTable).orderBy(asc(providerIntegrationsTable.id));
    res.json(rows.map(r => ({
      ...r,
      createdAt: r.createdAt.toISOString(),
      updatedAt: r.updatedAt.toISOString(),
    })));
  } catch (err) { next(err); }
});

/** PUT /api/provider-integrations/:key */
router.put("/integrations/:key", requireAdmin, async (req, res, next) => {
  try {
    const user = (req as any).user;
    const key = req.params["key"] as string;
    const { environment, isEnabled, webhookUrl, notes, displayNamePublic } = req.body as {
      environment?: string;
      isEnabled?: boolean;
      webhookUrl?: string;
      notes?: string;
      displayNamePublic?: string;
    };

    const [existing] = await db.select().from(providerIntegrationsTable)
      .where(eq(providerIntegrationsTable.providerKey, key)).limit(1);
    if (!existing) { res.status(404).json({ error: "Integration not found" }); return; }

    const updateSet: Record<string, unknown> = {};
    if (environment !== undefined) updateSet.environment = environment;
    if (isEnabled !== undefined) updateSet.isEnabled = isEnabled;
    if (webhookUrl !== undefined) updateSet.webhookUrl = webhookUrl;
    if (notes !== undefined) updateSet.notes = notes;
    if (displayNamePublic !== undefined) updateSet.displayNamePublic = displayNamePublic;
    updateSet.updatedByEmail = user.email;

    const [updated] = await db.update(providerIntegrationsTable)
      .set(updateSet as any)
      .where(eq(providerIntegrationsTable.providerKey, key))
      .returning();

    await db.insert(auditLogsTable).values({
      adminId: user.id, adminEmail: user.email,
      action: "provider_integration_updated", targetType: "provider_integration", targetId: null,
      details: JSON.stringify({ providerKey: key, ...updateSet }),
      ipAddress: (req as any).ip ?? null,
    });

    req.log.info({ key, isEnabled, environment }, "Provider integration updated");
    res.json({ ...updated!, createdAt: updated!.createdAt.toISOString(), updatedAt: updated!.updatedAt.toISOString() });
  } catch (err) { next(err); }
});

// ── Provider Products ─────────────────────────────────────────────────────────

/** GET /api/provider-integrations/products — all products (admin sees internal names) */
router.get("/products", requireAdmin, async (req, res, next) => {
  try {
    const rows = await db.select().from(providerProductsTable).orderBy(asc(providerProductsTable.sortOrder));
    res.json(rows.map(r => ({
      ...r,
      createdAt: r.createdAt.toISOString(),
      updatedAt: r.updatedAt.toISOString(),
    })));
  } catch (err) { next(err); }
});

/** PUT /api/provider-integrations/products/:key — update product (admin only) */
router.put("/products/:key", requireAdmin, async (req, res, next) => {
  try {
    const user = (req as any).user;
    const key = req.params["key"] as string;
    const { status, isEnabled, publicName, description, sortOrder, providerKey } = req.body as {
      status?: string;
      isEnabled?: boolean;
      publicName?: string;
      description?: string;
      sortOrder?: number;
      providerKey?: string;
    };

    const [existing] = await db.select().from(providerProductsTable)
      .where(eq(providerProductsTable.productKey, key)).limit(1);
    if (!existing) { res.status(404).json({ error: "Product not found" }); return; }

    const updateSet: Record<string, unknown> = {};
    if (status !== undefined) updateSet.status = status;
    if (isEnabled !== undefined) updateSet.isEnabled = isEnabled;
    if (publicName !== undefined) updateSet.publicName = publicName;
    if (description !== undefined) updateSet.description = description;
    if (sortOrder !== undefined) updateSet.sortOrder = sortOrder;
    if (providerKey !== undefined) updateSet.providerKey = providerKey;

    const [updated] = await db.update(providerProductsTable)
      .set(updateSet as any)
      .where(eq(providerProductsTable.productKey, key))
      .returning();

    req.log.info({ key, status, isEnabled }, "Provider product updated");
    res.json({ ...updated!, createdAt: updated!.createdAt.toISOString(), updatedAt: updated!.updatedAt.toISOString() });
  } catch (err) { next(err); }
});

// ── Activation Requests ───────────────────────────────────────────────────────

/** GET /api/provider-integrations/activation-requests */
router.get("/activation-requests", async (req, res, next) => {
  try {
    const user = (req as any).user;
    const isAdmin = user.role === "admin";

    const rows = isAdmin
      ? await db.select().from(activationRequestsTable).orderBy(desc(activationRequestsTable.createdAt)).limit(200)
      : await db.select().from(activationRequestsTable)
          .where(eq(activationRequestsTable.merchantId, user.merchantId))
          .orderBy(desc(activationRequestsTable.createdAt));

    res.json(rows.map(r => ({
      ...r,
      createdAt: r.createdAt.toISOString(),
      updatedAt: r.updatedAt.toISOString(),
    })));
  } catch (err) { next(err); }
});

/** POST /api/provider-integrations/activation-requests — merchant submits request */
router.post("/activation-requests", async (req, res, next) => {
  try {
    const user = (req as any).user;
    if (user.role !== "merchant" || !user.merchantId) {
      res.status(403).json({ error: "Merchant access only" }); return;
    }
    const { productKey, note } = req.body as { productKey?: string; note?: string };
    if (!productKey?.trim()) { res.status(400).json({ error: "productKey is required" }); return; }

    // Check product exists
    const [product] = await db.select().from(providerProductsTable)
      .where(eq(providerProductsTable.productKey, productKey)).limit(1);
    if (!product) { res.status(404).json({ error: "Service not found" }); return; }
    if (product.status === "active") { res.status(400).json({ error: "Service is already active" }); return; }

    // Check for existing pending request
    const [existing] = await db.select().from(activationRequestsTable)
      .where(and(
        eq(activationRequestsTable.merchantId, user.merchantId),
        eq(activationRequestsTable.productKey, productKey),
        eq(activationRequestsTable.status, "pending"),
      )).limit(1);
    if (existing) { res.status(400).json({ error: "A pending request already exists for this service" }); return; }

    const [row] = await db.insert(activationRequestsTable).values({
      merchantId: user.merchantId,
      productKey: productKey.trim(),
      status: "pending",
      note: note?.trim() ?? null,
    }).returning();

    req.log.info({ merchantId: user.merchantId, productKey }, "Activation request submitted");
    res.json({ ...row!, createdAt: row!.createdAt.toISOString(), updatedAt: row!.updatedAt.toISOString() });
  } catch (err) { next(err); }
});

/** PUT /api/provider-integrations/activation-requests/:id — admin approves/rejects */
router.put("/activation-requests/:id", requireAdmin, async (req, res, next) => {
  try {
    const user = (req as any).user;
    const id = parseInt(req.params["id"] as string);
    const { status, note } = req.body as { status?: string; note?: string };

    if (!status || !["pending", "approved", "rejected"].includes(status)) {
      res.status(400).json({ error: "status must be pending, approved, or rejected" }); return;
    }

    const [existing] = await db.select().from(activationRequestsTable)
      .where(eq(activationRequestsTable.id, id)).limit(1);
    if (!existing) { res.status(404).json({ error: "Request not found" }); return; }

    const [updated] = await db.update(activationRequestsTable)
      .set({ status, note: note ?? existing.note })
      .where(eq(activationRequestsTable.id, id))
      .returning();

    await db.insert(auditLogsTable).values({
      adminId: user.id, adminEmail: user.email,
      action: `activation_request_${status}`, targetType: "activation_request", targetId: id,
      details: JSON.stringify({ productKey: existing.productKey, merchantId: existing.merchantId, note }),
      ipAddress: (req as any).ip ?? null,
    });

    req.log.info({ id, status, productKey: existing.productKey }, "Activation request updated");
    res.json({ ...updated!, createdAt: updated!.createdAt.toISOString(), updatedAt: updated!.updatedAt.toISOString() });
  } catch (err) { next(err); }
});

// ── Product Visibility ────────────────────────────────────────────────────────

/** GET /api/provider-integrations/product-visibility?merchantId=N */
router.get("/product-visibility", requireAdmin, async (req, res, next) => {
  try {
    const merchantId = req.query["merchantId"] ? parseInt(req.query["merchantId"] as string) : undefined;
    const rows = merchantId
      ? await db.select().from(providerProductVisibilityTable)
          .where(eq(providerProductVisibilityTable.merchantId, merchantId))
      : await db.select().from(providerProductVisibilityTable);
    res.json(rows.map(r => ({ ...r, createdAt: r.createdAt.toISOString(), updatedAt: r.updatedAt.toISOString() })));
  } catch (err) { next(err); }
});

/** PUT /api/provider-integrations/product-visibility */
router.put("/product-visibility", requireAdmin, async (req, res, next) => {
  try {
    const user = (req as any).user;
    const { merchantId, productKey, visibilityStatus } = req.body as {
      merchantId?: number; productKey?: string; visibilityStatus?: string;
    };

    if (!merchantId || !productKey || !visibilityStatus) {
      res.status(400).json({ error: "merchantId, productKey, visibilityStatus required" }); return;
    }

    const [row] = await db.insert(providerProductVisibilityTable)
      .values({ merchantId, productKey, visibilityStatus })
      .onConflictDoUpdate({
        target: [providerProductVisibilityTable.productKey, providerProductVisibilityTable.merchantId],
        set: { visibilityStatus },
      }).returning();

    req.log.info({ merchantId, productKey, visibilityStatus }, "Product visibility updated");
    res.json({ ...row!, createdAt: row!.createdAt.toISOString(), updatedAt: row!.updatedAt.toISOString() });
  } catch (err) { next(err); }
});

export default router;
