import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import type { AuthUser } from "./api/maskan";

type AuthState = {
  user: AuthUser | null;
  token: string | null;
  authLoading: boolean;
  setAuth: (user: AuthUser, token: string) => void;
  clearAuth: () => void;
};

const AuthContext = createContext<AuthState | null>(null);

function safeLocalStorage() {
  return typeof window !== "undefined" ? window.localStorage : null;
}

function readUser(): AuthUser | null {
  try {
    const raw = safeLocalStorage()?.getItem("maskan_user");
    return raw ? (JSON.parse(raw) as AuthUser) : null;
  } catch {
    return null;
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  // Start null on both server and client so SSR HTML matches hydration.
  // authLoading stays true until the useEffect below has run, so components
  // can distinguish "not yet checked" from "definitely logged out".
  const [user, setUser] = useState<AuthUser | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [authLoading, setAuthLoading] = useState(true);

  useEffect(() => {
    const storedUser = readUser();
    const storedToken = safeLocalStorage()?.getItem("maskan_token") ?? null;
    if (storedUser && storedToken) {
      setUser(storedUser);
      setToken(storedToken);
    }
    setAuthLoading(false);
  }, []);

  function setAuth(nextUser: AuthUser, nextToken: string) {
    safeLocalStorage()?.setItem("maskan_user", JSON.stringify(nextUser));
    safeLocalStorage()?.setItem("maskan_token", nextToken);
    setUser(nextUser);
    setToken(nextToken);
  }

  function clearAuth() {
    safeLocalStorage()?.removeItem("maskan_user");
    safeLocalStorage()?.removeItem("maskan_token");
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
