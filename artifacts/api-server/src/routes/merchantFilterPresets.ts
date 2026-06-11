import { Router } from "express";
import { db, merchantFilterPresetsTable, merchantsTable } from "@workspace/db";
import { eq, and, asc, max } from "drizzle-orm";
import { requireAuth } from "../middlewares/auth";

const router = Router();
router.use(requireAuth);

function mapPreset(row: typeof merchantFilterPresetsTable.$inferSelect) {
  return {
    id: row.id,
    merchantId: row.merchantId,
    name: row.name,
    presetType: row.presetType,
    payload: row.payload,
    sortOrder: row.sortOrder,
    createdAt: row.createdAt.toISOString(),
  };
}

// GET /api/merchant/filter-presets
router.get("/", async (req, res, next) => {
  try {
    const user = (req as any).user;
    if (!user.merchantId) {
      res.status(403).json({ error: "Merchant account required" });
      return;
    }
    const rows = await db.select().from(merchantFilterPresetsTable)
      .where(eq(merchantFilterPresetsTable.merchantId, user.merchantId))
      .orderBy(asc(merchantFilterPresetsTable.sortOrder), asc(merchantFilterPresetsTable.id));
    res.json({ data: rows.map(mapPreset) });
  } catch (err) {
    next(err);
  }
});

// POST /api/merchant/filter-presets
router.post("/", async (req, res, next) => {
  try {
    const user = (req as any).user;
    if (!user.merchantId) {
      res.status(403).json({ error: "Merchant account required" });
      return;
    }
    const { name, presetType, payload } = req.body;
    if (!name?.trim()) {
      res.status(400).json({ error: "name is required" });
      return;
    }
    const validTypes = ["combined", "smart", "date"];
    if (!presetType || !validTypes.includes(presetType)) {
      res.status(400).json({ error: "presetType must be one of: combined, smart, date" });
      return;
    }
    if (!payload || typeof payload !== "object") {
      res.status(400).json({ error: "payload is required and must be an object" });
      return;
    }

    const existing = await db.select({ id: merchantFilterPresetsTable.id })
      .from(merchantFilterPresetsTable)
      .where(and(
        eq(merchantFilterPresetsTable.merchantId, user.merchantId),
        eq(merchantFilterPresetsTable.name, name.trim()),
        eq(merchantFilterPresetsTable.presetType, presetType),
      ))
      .limit(1);

    if (existing.length > 0) {
      res.status(409).json({ error: "A preset with this name already exists" });
      return;
    }

    // Place new presets at the end (max sortOrder + 1)
    const [maxRow] = await db.select({ maxSort: max(merchantFilterPresetsTable.sortOrder) })
      .from(merchantFilterPresetsTable)
      .where(eq(merchantFilterPresetsTable.merchantId, user.merchantId));
    const nextSort = (maxRow?.maxSort ?? -1) + 1;

    const [inserted] = await db.insert(merchantFilterPresetsTable).values({
      merchantId: user.merchantId,
      name: name.trim(),
      presetType,
      payload,
      sortOrder: nextSort,
    }).returning();

    res.status(201).json(mapPreset(inserted!));
  } catch (err) {
    next(err);
  }
});

// PATCH /api/merchant/filter-presets/reorder
router.patch("/reorder", async (req, res, next) => {
  try {
    const user = (req as any).user;
    if (!user.merchantId) {
      res.status(403).json({ error: "Merchant account required" });
      return;
    }
    const { ids } = req.body;
    if (!Array.isArray(ids) || ids.some(id => typeof id !== "number")) {
      res.status(400).json({ error: "ids must be an array of numbers" });
      return;
    }
    if (ids.length === 0) {
      res.json({ message: "Order updated" });
      return;
    }

    // Update sortOrder for each ID — only update presets belonging to this merchant
    await Promise.all(
      (ids as number[]).map((id, index) =>
        db.update(merchantFilterPresetsTable)
          .set({ sortOrder: index })
          .where(and(
            eq(merchantFilterPresetsTable.id, id),
            eq(merchantFilterPresetsTable.merchantId, user.merchantId),
          ))
      )
    );

    res.json({ message: "Order updated" });
  } catch (err) {
    next(err);
  }
});

// DELETE /api/merchant/filter-presets/:id
router.delete("/:id", async (req, res, next) => {
  try {
    const user = (req as any).user;
    if (!user.merchantId) {
      res.status(403).json({ error: "Merchant account required" });
      return;
    }
    const id = parseInt(req.params['id'] as string);
    if (isNaN(id)) {
      res.status(400).json({ error: "Invalid id" });
      return;
    }

    const deleted = await db.delete(merchantFilterPresetsTable)
      .where(and(
        eq(merchantFilterPresetsTable.id, id),
        eq(merchantFilterPresetsTable.merchantId, user.merchantId),
      ))
      .returning({ id: merchantFilterPresetsTable.id });

    if (deleted.length === 0) {
      res.status(404).json({ error: "Filter preset not found" });
      return;
    }

    res.json({ message: "Filter preset deleted" });
  } catch (err) {
    next(err);
  }
});

export default router;
