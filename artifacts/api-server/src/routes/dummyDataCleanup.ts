import { Router } from "express";
import { requireAuth, requireAdmin, requireSuperAdmin } from "../middlewares/auth";
import { detectDummyData, executeCleanup, getCleanupHistory } from "../helpers/dummyDataCleanup";

const router = Router();
router.use(requireAuth, requireAdmin, requireSuperAdmin);

// GET /api/admin/dummy-data-cleanup/dry-run
router.get("/dry-run", async (req, res, next) => {
  try {
    const result = await detectDummyData();
    res.json({
      findings: result.findings,
      totalRows: result.findings.reduce((sum, f) => sum + f.count, 0),
      protectedDemoMerchantCount: result.protectedDemoMerchantIds.length,
      deletableDummyMerchantCount: result.deletableDummyMerchantIds.length,
    });
  } catch (err) {
    next(err);
  }
});

// POST /api/admin/dummy-data-cleanup/confirm  { confirm: "CLEAN_DUMMY_DATA" }
router.post("/confirm", async (req, res, next) => {
  try {
    if (req.body?.confirm !== "CLEAN_DUMMY_DATA") {
      res.status(400).json({ error: "Confirmation phrase mismatch. Send { confirm: \"CLEAN_DUMMY_DATA\" } to proceed." });
      return;
    }
    const user = (req as any).user;
    const results = await executeCleanup({ adminId: user.id, adminEmail: user.email });
    res.json({
      results,
      totalRowsDeleted: results.reduce((sum, r) => sum + r.rowsDeleted, 0),
    });
  } catch (err) {
    next(err);
  }
});

// GET /api/admin/dummy-data-cleanup/history
router.get("/history", async (req, res, next) => {
  try {
    const history = await getCleanupHistory();
    res.json({ history });
  } catch (err) {
    next(err);
  }
});

export default router;
