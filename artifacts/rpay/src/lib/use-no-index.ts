import { useEffect } from "react";
import { useLocation } from "wouter";

/**
 * Keeps the document's <meta name="robots"> tag in sync with the current
 * route. Admin/super-admin surfaces (anything under /admin) are only ever
 * reachable via direct URL — they must never be indexed or followed by
 * search engines. All other routes stay indexable.
 */
export function useNoIndexSync() {
  const [location] = useLocation();

  useEffect(() => {
    const meta = document.querySelector('meta[name="robots"]');
    if (!meta) return;
    const isAdminSurface = location === "/admin" || location.startsWith("/admin/");
    meta.setAttribute("content", isAdminSurface ? "noindex, nofollow" : "index, follow");
  }, [location]);
}
