---
name: Silent 404 from unmounted router
description: A fully-implemented, typechecked Express route file can still 404 if it was never wired into routes/index.ts
---

A route module can be written correctly, imported in `routes/index.ts`, pass `tsc --noEmit` with zero errors, and still be completely unreachable (404 on every endpoint) if the corresponding `router.use("/path", theRouter)` line was never added.

**Why:** TypeScript only checks that the import binding is used *somewhere* as a value (or not even that, if it's re-exported) — it does not know or care whether an Express router was actually mounted on the app. An unused-import lint rule might catch it, but a plain `import X from "./x"` followed by forgetting the `router.use(...)` call compiles clean. The only way to detect this is an actual HTTP request against the running server.

**How to apply:** After adding a new route file to a pnpm-workspace Express API (see `pnpm-workspace` skill's server reference), always grep `routes/index.ts` (or wherever the app composes routers) to confirm a `router.use("/your-path", yourRouter)` line exists — don't just trust that importing it was enough. When a new endpoint 404s despite the handler code looking correct, check route mounting before debugging deeper logic.
