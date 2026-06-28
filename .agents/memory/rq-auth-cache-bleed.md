---
name: React Query stale cache auth bleed
description: After login, React Query can return the previous session's cached user while the new /api/auth/me request is in-flight — causes ProtectedRoute to see the wrong role.
---

## The Rule
Always call `queryClient.removeQueries({ queryKey: getGetMeQueryKey() })` inside `login()` BEFORE setting the new token. Also hold a `tokenChanging` flag true until the fresh response arrives.

**Why:** React Query returns stale cached data synchronously while refetching. If a merchant was previously logged in, their cached user stays in memory when an admin token is set. `isUserLoading` is `false` (cache hit), so `ProtectedRoute` sees the merchant user on `/admin/dashboard` → redirects to `/merchant/dashboard`. This was the confirmed production bug: admin login showed "Welcome back, Admin." toast but then landed on `/merchant/dashboard`.

**How to apply:**
- `auth-context.tsx` `login()`: `queryClient.removeQueries({ queryKey: getGetMeQueryKey() })` then `setTokenChanging(true)` then set token.
- `auth-context.tsx` `logout()`: `queryClient.clear()` then remove token.
- `isLoading` must include `tokenChanging`: `!authTimedOut && (isUserLoading || tokenChanging) && !!token`.
- `getGetMeQueryKey` is exported from `@workspace/api-client-react` (re-exports all of `./generated/api`).
- `useQueryClient` is from `@tanstack/react-query`; can be called inside `AuthProvider` since it is mounted inside `QueryClientProvider`.
