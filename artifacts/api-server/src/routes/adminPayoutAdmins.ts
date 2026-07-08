import { Router } from "express";
import { requireAuth, requireAdmin } from "../middlewares/auth";
import { db, usersTable, agentsTable } from "@workspace/db";
import { eq, inArray, desc } from "drizzle-orm";
import bcrypt from "bcryptjs";

const router = Router();

router.use(requireAuth, requireAdmin);

const PAYOUT_ADMIN_ROLES = ["payout_admin", "payout_super_admin", "agent"];

/**
 * GET /api/admin/payout-admins
 * List payout admins and agents.
 */
router.get("/", async (req, res) => {
  try {
    const users = await db
      .select({
        id: usersTable.id,
        email: usersTable.email,
        name: usersTable.name,
        role: usersTable.role,
        isActive: usersTable.isActive,
        canManagePayoutProviderCredentials: usersTable.canManagePayoutProviderCredentials,
        permissionsJson: usersTable.permissionsJson,
        createdAt: usersTable.createdAt,
        lastLoginAt: usersTable.lastLoginAt,
      })
      .from(usersTable)
      .where(inArray(usersTable.role, PAYOUT_ADMIN_ROLES))
      .orderBy(desc(usersTable.createdAt));

    res.json({ data: users });
  } catch (err) {
    req.log.error({ err }, "admin_list_payout_admins_error");
    res.status(500).json({ error: "Failed to load payout admins" });
  }
});

/**
 * POST /api/admin/payout-admins
 * Create a payout admin, payout super admin, or agent user.
 */
router.post("/", async (req, res) => {
  const { email, name, password, role, canManagePayoutProviderCredentials, permissionsJson, mobile, referralCode } = req.body ?? {};

  // Manual validation (avoids direct zod/v4 import — not a direct dep of api-server)
  if (!email || typeof email !== "string" || !email.includes("@")) {
    res.status(400).json({ error: "Valid email is required" }); return;
  }
  if (!name || typeof name !== "string" || name.trim().length < 2) {
    res.status(400).json({ error: "Name must be at least 2 characters" }); return;
  }
  if (!password || typeof password !== "string" || password.length < 8) {
    res.status(400).json({ error: "Password must be at least 8 characters" }); return;
  }
  if (!role || !["payout_admin", "payout_super_admin", "agent"].includes(role)) {
    res.status(400).json({ error: "Role must be payout_admin, payout_super_admin, or agent" }); return;
  }

  const adminUser = (req as any).user;

  try {
    const [existing] = await db.select({ id: usersTable.id }).from(usersTable).where(eq(usersTable.email, email)).limit(1);
    if (existing) {
      res.status(409).json({ error: "Email already registered" });
      return;
    }

    const passwordHash = await bcrypt.hash(password, 10);

    const [created] = await db
      .insert(usersTable)
      .values({
        email: email.toLowerCase().trim(),
        name: name.trim(),
        passwordHash,
        role,
        isActive: true,
        canManagePayoutProviderCredentials: canManagePayoutProviderCredentials === true,
        permissionsJson: permissionsJson ?? null,
      })
      .returning({
        id: usersTable.id,
        email: usersTable.email,
        name: usersTable.name,
        role: usersTable.role,
        isActive: usersTable.isActive,
        canManagePayoutProviderCredentials: usersTable.canManagePayoutProviderCredentials,
      });

    if (role === "agent" && created) {
      const code = referralCode ?? `AGT${created.id.toString().padStart(4, "0")}`;
      await db.insert(agentsTable).values({
        userId: created.id,
        name,
        mobile: mobile ?? "",
        email,
        referralCode: code,
        status: "active",
        createdByAdminId: adminUser.id,
      });
    }

    req.log.info({ adminId: adminUser.id, newUserId: created?.id, role }, "payout_admin_created");
    res.status(201).json(created);
  } catch (err) {
    req.log.error({ err }, "admin_create_payout_admin_error");
    res.status(500).json({ error: "Failed to create user" });
  }
});

/**
 * PATCH /api/admin/payout-admins/:id/permissions
 * Update payout admin permissions (Super Admin only can toggle canManagePayoutProviderCredentials).
 */
router.patch("/:id/permissions", async (req, res) => {
  const id = parseInt(req.params["id"] as string);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid ID" }); return; }

  const { isActive, canManagePayoutProviderCredentials, permissionsJson } = req.body ?? {};
  const adminUser = (req as any).user;

  if (canManagePayoutProviderCredentials !== undefined && !adminUser.isSuperAdmin) {
    res.status(403).json({ error: "Only Super Admin can grant provider credential access" });
    return;
  }

  try {
    const [target] = await db.select({ role: usersTable.role }).from(usersTable).where(eq(usersTable.id, id)).limit(1);
    if (!target || !PAYOUT_ADMIN_ROLES.includes(target.role)) {
      res.status(404).json({ error: "Payout admin not found" });
      return;
    }

    const updateValues: Partial<typeof usersTable.$inferInsert> = {};
    if (isActive !== undefined) updateValues.isActive = Boolean(isActive);
    if (canManagePayoutProviderCredentials !== undefined)
      updateValues.canManagePayoutProviderCredentials = Boolean(canManagePayoutProviderCredentials);
    if (permissionsJson !== undefined) updateValues.permissionsJson = permissionsJson;

    const [updated] = await db
      .update(usersTable)
      .set(updateValues)
      .where(eq(usersTable.id, id))
      .returning({
        id: usersTable.id,
        email: usersTable.email,
        role: usersTable.role,
        isActive: usersTable.isActive,
        canManagePayoutProviderCredentials: usersTable.canManagePayoutProviderCredentials,
        permissionsJson: usersTable.permissionsJson,
      });

    req.log.info({ adminId: adminUser.id, targetId: id, changes: { isActive, canManagePayoutProviderCredentials, permissionsJson } }, "payout_admin_permissions_updated");
    res.json(updated);
  } catch (err) {
    req.log.error({ err }, "admin_update_payout_admin_permissions_error");
    res.status(500).json({ error: "Failed to update permissions" });
  }
});

/**
 * GET /api/admin/agents
 * List agents (alias route).
 */
router.get("/agents", async (req, res) => {
  try {
    const agents = await db
      .select()
      .from(agentsTable)
      .orderBy(desc(agentsTable.createdAt));

    res.json({ data: agents });
  } catch (err) {
    req.log.error({ err }, "admin_list_agents_error");
    res.status(500).json({ error: "Failed to load agents" });
  }
});

export default router;
