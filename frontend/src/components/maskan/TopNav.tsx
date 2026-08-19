import { useEffect, useRef, useState } from "react";
import { Link, useRouterState } from "@tanstack/react-router";
import { Check, ChevronDown, Globe, Home } from "lucide-react";
import { NavAuthButton } from "@/components/maskan/NavAuthButton";
import { useAuth } from "@/lib/auth-context";
import { useLanguage, type Language } from "@/lib/i18n/context";
import { cn } from "@/lib/utils";

// myMakan Phase-1 nav: Home, Rent, Buy, Map, AI Advisor, Area Intelligence,
// Saved, My Leads, Profile (Profile = the account avatar/dropdown in
// NavAuthButton, not a separate link here). Hide-Phase1 items (Projects,
// Partners, Compare — see docs/implementation/mymakan-phase1.md "Navigation
// changed") are dropped from top-nav only; their route files are untouched
// and still reachable directly.
function useNavLinks() {
  const { t } = useLanguage();
  const NAV_LINKS = [
    { label: t("nav.home"), to: "/", search: undefined },
    { label: t("nav.rent"), to: "/search", search: { listingType: "rent" } },
    { label: t("nav.buy"), to: "/search", search: { listingType: "sale" } },
    { label: t("nav.map"), to: "/search", search: undefined },
    { label: t("nav.aiAdvisor"), to: "/advisor", search: undefined },
    { label: t("nav.areaIntelligence"), to: "/areas", search: undefined },
    { label: t("nav.saved"), to: "/saved", search: undefined },
  ] as const;
  // Only relevant once a lead can exist for the account, so it's shown in the
  // persistent nav (not just buried in the account dropdown) when signed in.
  const MY_LEADS_LINK = { label: t("nav.myLeads"), to: "/my-leads", search: undefined } as const;
  // Same rationale, same sibling placement as MY_LEADS_LINK (AI Negotiation &
  // Offer Management, Prompt 9) — reachable from the persistent nav once
  // signed in, not just buried in the account dropdown.
  const MY_NEGOTIATIONS_LINK = { label: t("nav.myNegotiations"), to: "/negotiations", search: undefined } as const;
  return { NAV_LINKS, MY_LEADS_LINK, MY_NEGOTIATIONS_LINK };
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
  const { user } = useAuth();
  const { NAV_LINKS, MY_LEADS_LINK, MY_NEGOTIATIONS_LINK } = useNavLinks();
  const navLinks = user ? [...NAV_LINKS, MY_LEADS_LINK, MY_NEGOTIATIONS_LINK] : NAV_LINKS;
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  return (
    <header className="sticky top-0 z-40 border-b border-border/70 bg-background/80 backdrop-blur-xl">
      <div className="container-page flex h-16 items-center justify-between">
        <div className="flex items-center gap-8">
          <Logo />
          {/* lg, not md — at exactly 768px (a common tablet width, e.g. iPad
              portrait) the full link row + language switcher + auth button
              don't fit in one line and clip ("Compare"/"Sign in" get cut
              off). Tablets get the scrollable strip below instead. */}
          <nav className="hidden items-center gap-6 lg:flex">
            {navLinks.map((l) => (
              <Link
                key={l.label}
                to={l.to}
                search={l.search}
                className="text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
                activeProps={{ className: "text-foreground" }}
              >
                {l.label}
              </Link>
            ))}
          </nav>
        </div>
        <div className="flex items-center gap-2">
          <LanguageSwitcher />
          <NavAuthButton />
        </div>
      </div>

      {/* Mobile nav — a horizontally scrollable strip instead of a hidden
          hamburger drawer, so links stay visible without an extra tap. */}
      <nav
        className="flex gap-2 overflow-x-auto border-t border-border/60 px-4 py-2.5 lg:hidden [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {navLinks.map((l) => {
          // Built manually (not via TanStack Router's activeProps) — that prop
          // merges its className into the base one rather than replacing it,
          // which left conflicting bg-surface/bg-primary utilities fighting
          // for the same element and rendered as a washed-out ghost pill.
          const isActive = pathname === l.to || pathname.startsWith(`${l.to}/`);
          return (
            <Link
              key={l.label}
              to={l.to}
              search={l.search}
              className={cn(
                "shrink-0 rounded-full border px-3.5 py-1.5 text-sm font-medium transition-colors",
                isActive
                  ? "border-primary bg-primary font-semibold text-primary-foreground"
                  : "border-border bg-surface text-foreground hover:bg-surface-2",
              )}
            >
              {l.label}
            </Link>
          );
        })}
      </nav>
    </header>
  );
}
