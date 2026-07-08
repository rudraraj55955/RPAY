import { Router } from "express";
import { requireAuth, requireAdmin } from "../middlewares/auth";
import { db, usersTable, agentsTable } from "@workspace/db";
import { eq, inArray, desc, count } from "drizzle-orm";
import bcrypt from "bcrypt";
import { z } from "zod/v4";

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

const createPayoutAdminSchema = z.object({
  email: z.string().email(),
  name: z.string().min(2),
  password: z.string().min(8),
  role: z.enum(["payout_admin", "payout_super_admin", "agent"]),
  canManagePayoutProviderCredentials: z.boolean().optional().default(false),
  permissionsJson: z.record(z.string(), z.boolean()).optional(),
  mobile: z.string().optional(),
  referralCode: z.string().optional(),
});

/**
 * POST /api/admin/payout-admins
 * Create a payout admin, payout super admin, or agent user.
 */
router.post("/", async (req, res) => {
  const parsed = createPayoutAdminSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid input" });
    return;
  }

  const { email, name, password, role, canManagePayoutProviderCredentials, permissionsJson, mobile, referralCode } = parsed.data;
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
        email,
        name,
        passwordHash,
        role,
        isActive: true,
        canManagePayoutProviderCredentials: canManagePayoutProviderCredentials ?? false,
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

const updatePermissionsSchema = z.object({
  isActive: z.boolean().optional(),
  canManagePayoutProviderCredentials: z.boolean().optional(),
  permissionsJson: z.record(z.string(), z.boolean()).optional(),
});

/**
 * PATCH /api/admin/payout-admins/:id/permissions
 * Update payout admin permissions (Super Admin only can toggle canManagePayoutProviderCredentials).
 */
router.patch("/:id/permissions", async (req, res) => {
  const id = parseInt(req.params["id"] as string);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid ID" }); return; }

  const parsed = updatePermissionsSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid input" });
    return;
  }

  const adminUser = (req as any).user;

  if (parsed.data.canManagePayoutProviderCredentials !== undefined && !adminUser.isSuperAdmin) {
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
    if (parsed.data.isActive !== undefined) updateValues.isActive = parsed.data.isActive;
    if (parsed.data.canManagePayoutProviderCredentials !== undefined)
      updateValues.canManagePayoutProviderCredentials = parsed.data.canManagePayoutProviderCredentials;
    if (parsed.data.permissionsJson !== undefined) updateValues.permissionsJson = parsed.data.permissionsJson;

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

    req.log.info({ adminId: adminUser.id, targetId: id, changes: parsed.data }, "payout_admin_permissions_updated");
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
