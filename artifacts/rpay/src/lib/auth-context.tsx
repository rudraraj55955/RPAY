import { createContext, useContext, ReactNode, useEffect, useState } from "react";
import { useGetMe, User } from "@workspace/api-client-react";
import { getToken, removeToken, setToken } from "./auth";
import { useLocation } from "wouter";

interface AuthContextType {
  user: User | null;
  isLoading: boolean;
  login: (token: string) => void;
  logout: () => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [token, setLocalToken] = useState<string | null>(getToken());
  const [_, setLocation] = useLocation();
  // Safety net: if the /api/auth/me request never completes (e.g. API server
  // is down or network hangs), stop showing the spinner after 10 s and treat
  // the session as unauthenticated — prevents an infinite loading state.
  const [authTimedOut, setAuthTimedOut] = useState(false);

  const { data: user, isLoading: isUserLoading, error } = useGetMe({
    query: {
      enabled: !!token,
      retry: false,
      networkMode: "always" as const,
    } as any,
  });

  const isLoading = !authTimedOut && isUserLoading && !!token;

  // Reset timeout whenever the token changes; start a fresh 10-second window.
  useEffect(() => {
    setAuthTimedOut(false);
    if (!token) return;
    const t = setTimeout(() => setAuthTimedOut(true), 10_000);
    return () => clearTimeout(t);
  }, [token]);

  useEffect(() => {
    if (error) {
      removeToken();
      setLocalToken(null);
    }
  }, [error]);

  const login = (newToken: string) => {
    setToken(newToken);
    setLocalToken(newToken);
  };

  const logout = () => {
    removeToken();
    setLocalToken(null);
    setLocation("/");
  };

  return (
    <AuthContext.Provider value={{ user: user || null, isLoading, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
}
