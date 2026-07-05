---
name: Super admin as boolean flag, not a role value
description: Why isSuperAdmin is a separate boolean on users instead of a new "super_admin" role enum value
---

For RasoKart, super-admin-only permissions (e.g. editing company branding/support-contact settings) were implemented via an `isSuperAdmin` boolean column on `users`, gated with a `requireSuperAdmin` middleware (`role === "admin" && isSuperAdmin`), rather than adding a new `"super_admin"` value to the existing role enum.

**Why:** ~30 files across the codebase do strict `role === "admin"` checks (route guards, sidebar nav gating, UI conditionals). Introducing a new role value would have required auditing and updating every one of those call sites to also treat `"super_admin"` as admin-equivalent, with high risk of missing one and silently locking out a legitimate admin action. A boolean flag layered on top of the existing `"admin"` role preserves every existing `role === "admin"` check unchanged while adding a strictly narrower permission on top.

**How to apply:** When adding a new permission tier that is a *subset* of an existing role's capabilities (not a fully separate actor type), prefer a boolean/flag column plus a dedicated middleware over expanding the role enum. Only introduce a new role value when the new actor type should be excluded from existing role-based checks by default.
