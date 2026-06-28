import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { useRouterState } from "@tanstack/react-router";
import type { AuthUser } from "./api/maskan";
import {
  portalScope,
  readStoredToken,
  readStoredUser,
  writeStoredAuth,
  clearStoredAuth,
  type PortalScope,
} from "./auth-storage";

type AuthState = {
  user: AuthUser | null;
  token: string | null;
  authLoading: boolean;
  /** Which portal this session belongs to (admin / partner / user). */
  scope: PortalScope;
  setAuth: (user: AuthUser, token: string) => void;
  clearAuth: () => void;
};

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  // The active portal is derived from the URL so each portal keeps an
  // independent session, even when several are open in different tabs.
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const scope = portalScope(pathname);

  // Start null on both server and client so SSR HTML matches hydration.
  // authLoading stays true until the effect below has run, so components
  // can distinguish "not yet checked" from "definitely logged out".
  const [user, setUser] = useState<AuthUser | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [authLoading, setAuthLoading] = useState(true);

  // Load the stored session for the active portal. Re-runs when the portal
  // changes (e.g. navigating from the user site into /admin within one tab),
  // swapping to that portal's credentials instead of leaking the previous one.
  useEffect(() => {
    setAuthLoading(true);
    const storedUser = readStoredUser<AuthUser>(scope);
    const storedToken = readStoredToken(scope);
    if (storedUser && storedToken) {
      setUser(storedUser);
      setToken(storedToken);
    } else {
      setUser(null);
      setToken(null);
    }
    setAuthLoading(false);
  }, [scope]);

  function setAuth(nextUser: AuthUser, nextToken: string) {
    writeStoredAuth(scope, nextUser, nextToken);
    setUser(nextUser);
    setToken(nextToken);
  }

  function clearAuth() {
    clearStoredAuth(scope);
    setUser(null);
    setToken(null);
  }

  return (
    <AuthContext.Provider value={{ user, token, authLoading, scope, setAuth, clearAuth }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
