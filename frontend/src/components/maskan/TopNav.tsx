import { useEffect, useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import { Check, ChevronDown, Globe, Home, Menu, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { NavAuthButton } from "@/components/maskan/NavAuthButton";
import { useAuth } from "@/lib/auth-context";
import { useLanguage, type Language } from "@/lib/i18n/context";
import { cn } from "@/lib/utils";

function useNavLinks() {
  const { t } = useLanguage();
  const NAV_LINKS = [
    { label: t("nav.search"), to: "/search" },
    { label: t("nav.exploreAreas"), to: "/areas" },
    { label: t("nav.partners"), to: "/partners" },
    { label: t("nav.aiAdvisor"), to: "/advisor" },
    { label: t("nav.saved"), to: "/saved" },
    { label: t("nav.compare"), to: "/compare" },
  ] as const;
  // Only relevant once a lead can exist for the account, so it's shown in the
  // persistent nav (not just buried in the account dropdown) when signed in.
  const MY_LEADS_LINK = { label: t("nav.myLeads"), to: "/my-leads" } as const;
  return { NAV_LINKS, MY_LEADS_LINK };
}

export function Logo() {
  const { t } = useLanguage();
  return (
    <Link to="/" className="flex items-center gap-2.5">
      <div className="grid size-9 place-items-center rounded-xl bg-primary text-primary-foreground shadow-sm">
        <Home className="size-4" />
      </div>
      <span className="font-display text-xl font-bold tracking-tight">{t("common.brand")}</span>
    </Link>
  );
}

const LANGUAGE_OPTIONS: { code: Language; label: string }[] = [
  { code: "en", label: "English" },
  { code: "ar", label: "العربية" },
];

export function LanguageSwitcher({ className }: { className?: string }) {
  const { lang, setLang, t } = useLanguage();
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handler(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const current = LANGUAGE_OPTIONS.find((o) => o.code === lang) ?? LANGUAGE_OPTIONS[0];

  return (
    <div ref={wrapRef} className={cn("relative", className)}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-label={t("common.language")}
        className="flex items-center gap-1.5 rounded-xl border border-border bg-card px-3 py-2 text-sm font-medium text-foreground transition-colors hover:bg-surface"
      >
        <Globe className="size-4 text-muted-foreground" />
        {current.label}
        <ChevronDown className="size-3.5 text-muted-foreground" />
      </button>

      {open && (
        <div className="absolute end-0 top-full z-50 mt-1 w-36 overflow-hidden rounded-xl border border-border bg-card shadow-elevated">
          {LANGUAGE_OPTIONS.map((opt) => (
            <button
              key={opt.code}
              type="button"
              onClick={() => {
                setLang(opt.code);
                setOpen(false);
              }}
              className="flex w-full items-center justify-between gap-2 px-3 py-2.5 text-sm hover:bg-surface"
            >
              {opt.label}
              {opt.code === lang && <Check className="size-3.5 text-primary" />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function TopNav() {
  const [open, setOpen] = useState(false);
  const { user } = useAuth();
  const { t } = useLanguage();
  const { NAV_LINKS, MY_LEADS_LINK } = useNavLinks();
  const navLinks = user ? [...NAV_LINKS, MY_LEADS_LINK] : NAV_LINKS;
  return (
    <header className="sticky top-0 z-40 border-b border-border/70 bg-background/80 backdrop-blur-xl">
      <div className="container-page flex h-16 items-center justify-between">
        <div className="flex items-center gap-8">
          <Logo />
          <nav className="hidden items-center gap-6 md:flex">
            {navLinks.map((l) => (
              <Link
                key={l.to}
                to={l.to}
                className="text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
                activeProps={{ className: "text-foreground" }}
              >
                {l.label}
              </Link>
            ))}
          </nav>
        </div>
        <div className="flex items-center gap-2">
          <LanguageSwitcher className="hidden sm:block" />
          <NavAuthButton className="hidden md:inline-flex" />
          <Button
            variant="outline"
            size="icon"
            className="md:hidden"
            aria-label={open ? t("common.closeMenu") : t("common.openMenu")}
            onClick={() => setOpen((o) => !o)}
          >
            {open ? <X /> : <Menu />}
          </Button>
        </div>
      </div>

      {/* Mobile slide-down drawer */}
      {open && (
        <div className="absolute inset-x-0 top-full z-50 border-b border-border bg-background shadow-lg md:hidden">
          <nav className="container-page flex flex-col gap-0.5 py-3">
            {navLinks.map((l) => (
              <Link
                key={l.to}
                to={l.to}
                onClick={() => setOpen(false)}
                className="flex items-center rounded-xl px-3 py-3 text-sm font-medium text-muted-foreground hover:bg-surface hover:text-foreground"
                activeProps={{
                  className:
                    "flex items-center rounded-xl px-3 py-3 text-sm font-medium bg-surface text-foreground",
                }}
              >
                {l.label}
              </Link>
            ))}
          </nav>
          <div className="container-page flex flex-col gap-3 border-t border-border py-3">
            <LanguageSwitcher className="sm:hidden" />
            <NavAuthButton className="w-full justify-center" />
          </div>
        </div>
      )}
    </header>
  );
}
