import { ReactNode, useEffect } from "react";
import { useAuth } from "@/lib/auth-context";
import { useLocation } from "wouter";
import { Spinner } from "@/components/ui/spinner";
import { UserRole } from "@workspace/api-client-react";

interface ProtectedRouteProps {
  children: ReactNode;
  allowedRoles?: string[];
}

function AuthRedirect({ to }: { to: string }) {
  const [, setLocation] = useLocation();
  useEffect(() => {
    setLocation(to, { replace: true } as Parameters<typeof setLocation>[1]);
  }, [to]);
  return (
    <div className="flex items-center justify-center min-h-screen bg-background">
      <Spinner className="w-8 h-8 text-primary" />
    </div>
  );
}

function getHomePath(role: string): string {
  switch (role) {
    case UserRole.admin:             return "/admin/dashboard";
    case UserRole.merchant:          return "/merchant/dashboard";
    case UserRole.payout_merchant:   return "/payout-merchant/dashboard";
    case UserRole.payout_admin:
    case UserRole.payout_super_admin: return "/payout-admin/dashboard";
    case UserRole.agent:             return "/agent/dashboard";
    default:                         return "/";
  }
}

function getLoginPath(location: string): string {
  if (location.startsWith("/payout-admin"))    return "/payout-admin/login";
  if (location.startsWith("/payout-merchant")) return "/payout-merchant/login";
  if (location.startsWith("/agent"))           return "/agent";
  if (location.startsWith("/admin"))           return "/admin";
  return "/merchant";
}

export function ProtectedRoute({ children, allowedRoles }: ProtectedRouteProps) {
  const { user, isLoading } = useAuth();
  const [location] = useLocation();

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-background">
        <Spinner className="w-8 h-8 text-primary" />
      </div>
    );
  }

  if (!user) {
    return <AuthRedirect to={getLoginPath(location)} />;
  }

  if (allowedRoles && !allowedRoles.includes(user.role)) {
    return <AuthRedirect to={getHomePath(user.role)} />;
  }

  return <>{children}</>;
}
