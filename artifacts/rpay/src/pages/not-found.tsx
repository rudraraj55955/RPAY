import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Home, ArrowLeft, Search, LayoutDashboard } from "lucide-react";

export default function NotFound() {
  const isAdmin = window.location.pathname.startsWith("/admin");
  const dashboardPath = isAdmin ? "/admin/dashboard" : "/merchant/dashboard";
  const loginPath = isAdmin ? "/admin/login" : "/merchant/login";

  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-4">
      <div className="max-w-lg w-full text-center space-y-8">
        {/* Large 404 */}
        <div className="relative select-none">
          <span className="text-[160px] font-black leading-none text-foreground/5 block">
            404
          </span>
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="space-y-1">
              <div className="flex items-center justify-center">
                <div className="w-14 h-14 rounded-2xl bg-primary/10 border border-primary/20 flex items-center justify-center">
                  <Search className="w-7 h-7 text-primary" />
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Text */}
        <div className="space-y-3">
          <h1 className="text-2xl font-bold text-foreground">Page not found</h1>
          <p className="text-muted-foreground text-sm leading-relaxed max-w-sm mx-auto">
            The page you're looking for doesn't exist or has been moved.
            Check the URL or navigate back to your dashboard.
          </p>
        </div>

        {/* Actions */}
        <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
          <Button
            variant="outline"
            onClick={() => window.history.back()}
            className="gap-2 w-full sm:w-auto"
          >
            <ArrowLeft className="w-4 h-4" />
            Go Back
          </Button>
          <Link href={dashboardPath}>
            <Button className="gap-2 w-full sm:w-auto">
              <LayoutDashboard className="w-4 h-4" />
              Go to Dashboard
            </Button>
          </Link>
        </div>

        {/* Footer hint */}
        <p className="text-xs text-muted-foreground/60">
          Error 404 &mdash; RasoKart Payment Gateway
        </p>
      </div>
    </div>
  );
}
