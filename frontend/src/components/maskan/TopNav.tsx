import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { Home, Menu, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { NavAuthButton } from "@/components/maskan/NavAuthButton";

const NAV_LINKS = [
  { label: "Search", to: "/search" },
  { label: "Explore Areas", to: "/areas" },
  { label: "Partners", to: "/partners" },
  { label: "AI Advisor", to: "/advisor" },
  { label: "Saved", to: "/saved" },
  { label: "Compare", to: "/compare" },
] as const;

export function Logo() {
  return (
    <Link to="/" className="flex items-center gap-2.5">
      <div className="grid size-9 place-items-center rounded-xl bg-primary text-primary-foreground shadow-sm">
        <Home className="size-4" />
      </div>
      <span className="font-display text-xl font-bold tracking-tight">Maskan</span>
    </Link>
  );
}

export function TopNav() {
  const [open, setOpen] = useState(false);
  return (
    <header className="sticky top-0 z-40 border-b border-border/70 bg-background/80 backdrop-blur-xl">
      <div className="container-page flex h-16 items-center justify-between">
        <div className="flex items-center gap-8">
          <Logo />
          <nav className="hidden items-center gap-6 md:flex">
            {NAV_LINKS.map((l) => (
              <Link
                key={l.label}
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
          <NavAuthButton className="hidden md:inline-flex" />
          <Button
            variant="outline"
            size="icon"
            className="md:hidden"
            aria-label={open ? "Close menu" : "Open menu"}
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
            {NAV_LINKS.map((l) => (
              <Link
                key={l.label}
                to={l.to}
                onClick={() => setOpen(false)}
                className="flex items-center rounded-xl px-3 py-3 text-sm font-medium text-muted-foreground hover:bg-surface hover:text-foreground"
                activeProps={{ className: "flex items-center rounded-xl px-3 py-3 text-sm font-medium bg-surface text-foreground" }}
              >
                {l.label}
              </Link>
            ))}
          </nav>
          <div className="container-page border-t border-border py-3">
            <NavAuthButton className="w-full justify-center" />
          </div>
        </div>
      )}
    </header>
  );
}
