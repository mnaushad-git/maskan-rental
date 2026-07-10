import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import type { AuthUser } from "./api/maskan";
import { onUnauthorized } from "./api/maskan";
import { readStoredToken, readStoredUser, writeStoredAuth, clearStoredAuth } from "./auth-storage";

type AuthState = {
  user: AuthUser | null;
  token: string | null;
  authLoading: boolean;
  setAuth: (user: AuthUser, token: string) => Promise<void>;
  clearAuth: () => Promise<void>;
};

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [authLoading, setAuthLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const [storedUser, storedToken] = await Promise.all([readStoredUser(), readStoredToken()]);
      if (storedUser && storedToken) {
        setUser(storedUser);
        setToken(storedToken);
      }
      setAuthLoading(false);
    })();
  }, []);

  // A 401 from any request clears SecureStore directly (see api/maskan.ts) —
  // this keeps in-memory state in sync since mobile has no page reload to
  // naturally re-read storage the way the web app's SSR/hydration cycle does.
  useEffect(() => onUnauthorized(() => clearAuth()), []);

  async function setAuth(nextUser: AuthUser, nextToken: string) {
    await writeStoredAuth(nextUser, nextToken);
    setUser(nextUser);
    setToken(nextToken);
  }

  async function clearAuth() {
    await clearStoredAuth();
    setUser(null);
    setToken(null);
  }

  return (
    <AuthContext.Provider value={{ user, token, authLoading, setAuth, clearAuth }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
