import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import type { AuthUser } from "./api/maskan";
import { fetchMe, onUnauthorized } from "./api/maskan";
import { readStoredToken, readStoredUser, writeStoredAuth, clearStoredAuth } from "./auth-storage";
import { reregisterIfPermittedAsync, unregisterCurrentDeviceAsync } from "./push";
import { useLanguage } from "./i18n/context";

type AuthState = {
  user: AuthUser | null;
  token: string | null;
  authLoading: boolean;
  setAuth: (user: AuthUser, token: string) => Promise<void>;
  clearAuth: () => Promise<void>;
  refreshUser: () => Promise<void>;
};

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const { lang } = useLanguage();
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
    // Quiet re-registration only — never prompts for OS permission here;
    // if the user already granted it in an earlier session (or on another
    // device with the same install), this keeps the backend's device row
    // pointing at a fresh token. First-time permission is only ever asked
    // via the contextual PushPermissionPrompt.
    reregisterIfPermittedAsync(lang).catch(() => {});
  }

  async function clearAuth() {
    // Unregister BEFORE clearing stored auth — unregisterDevice() needs a
    // valid bearer token to identify which user's device row to delete.
    await unregisterCurrentDeviceAsync();
    await clearStoredAuth();
    setUser(null);
    setToken(null);
  }

  // Re-fetches /auth/me so screens that change server-side user state (e.g.
  // subscribing to premium) can reflect it immediately without a re-login.
  async function refreshUser() {
    if (!token) return;
    const nextUser = await fetchMe(token);
    await writeStoredAuth(nextUser, token);
    setUser(nextUser);
  }

  return (
    <AuthContext.Provider value={{ user, token, authLoading, setAuth, clearAuth, refreshUser }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
