import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { en } from "./en";
import { ar } from "./ar";

export type Language = "en" | "ar";

const DICTS = { en, ar };
const STORAGE_KEY = "maskan_lang";

type Ctx = {
  lang: Language;
  setLang: (l: Language) => void;
  dir: "ltr" | "rtl";
  t: (path: string, vars?: Record<string, string | number>) => string;
};

const LanguageContext = createContext<Ctx | null>(null);

function resolve(dict: unknown, path: string): unknown {
  return path.split(".").reduce<unknown>((acc, key) => {
    if (acc && typeof acc === "object") return (acc as Record<string, unknown>)[key];
    return undefined;
  }, dict);
}

function interpolate(str: string, vars?: Record<string, string | number>): string {
  if (!vars) return str;
  return str.replace(/\{\{(\w+)\}\}/g, (_, key: string) =>
    key in vars ? String(vars[key]) : `{{${key}}}`,
  );
}

export function LanguageProvider({ children }: { children: ReactNode }) {
  // Always start in English so server-rendered HTML matches the first client
  // render (see auth-context.tsx for the same SSR-safe pattern) — the stored
  // preference is applied after mount, once we can safely read localStorage.
  const [lang, setLangState] = useState<Language>("en");

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(STORAGE_KEY);
      if (stored === "ar" || stored === "en") setLangState(stored);
    } catch {
      // localStorage unavailable (private browsing) — stay on the default.
    }
  }, []);

  useEffect(() => {
    document.documentElement.lang = lang;
    document.documentElement.dir = lang === "ar" ? "rtl" : "ltr";
  }, [lang]);

  function setLang(l: Language) {
    setLangState(l);
    try {
      window.localStorage.setItem(STORAGE_KEY, l);
    } catch {
      // ignore
    }
  }

  function t(path: string, vars?: Record<string, string | number>): string {
    const value = resolve(DICTS[lang], path) ?? resolve(DICTS.en, path);
    if (typeof value !== "string") {
      if (import.meta.env.DEV) console.warn(`[i18n] missing key: ${path}`);
      return path;
    }
    return interpolate(value, vars);
  }

  const dir: "ltr" | "rtl" = lang === "ar" ? "rtl" : "ltr";

  return (
    <LanguageContext.Provider value={{ lang, setLang, dir, t }}>
      {children}
    </LanguageContext.Provider>
  );
}

export function useLanguage() {
  const ctx = useContext(LanguageContext);
  if (!ctx) throw new Error("useLanguage must be used within LanguageProvider");
  return ctx;
}
