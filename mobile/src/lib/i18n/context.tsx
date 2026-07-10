import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { I18nManager } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Updates from "expo-updates";
import { en } from "./en";
import { ar } from "./ar";

export type Language = "en" | "ar";

const DICTS = { en, ar };
const STORAGE_KEY = "maskan_lang";

type Ctx = {
  lang: Language;
  /** Persists the choice and flips native layout direction — requires an app
   * reload to take full effect, so this triggers one via expo-updates. */
  setLang: (l: Language) => Promise<void>;
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
  const [lang, setLangState] = useState<Language>(I18nManager.isRTL ? "ar" : "en");

  useEffect(() => {
    AsyncStorage.getItem(STORAGE_KEY).then((stored) => {
      if (stored === "ar" || stored === "en") setLangState(stored);
    });
  }, []);

  async function setLang(l: Language) {
    setLangState(l);
    await AsyncStorage.setItem(STORAGE_KEY, l);
    const shouldBeRTL = l === "ar";
    if (I18nManager.isRTL !== shouldBeRTL) {
      I18nManager.allowRTL(shouldBeRTL);
      I18nManager.forceRTL(shouldBeRTL);
      // Layout direction only fully applies after a reload.
      await Updates.reloadAsync();
    }
  }

  function t(path: string, vars?: Record<string, string | number>): string {
    const value = resolve(DICTS[lang], path) ?? resolve(DICTS.en, path);
    if (typeof value !== "string") {
      if (__DEV__) console.warn(`[i18n] missing key: ${path}`);
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
