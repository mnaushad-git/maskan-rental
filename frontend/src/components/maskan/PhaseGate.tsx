import { Link } from "@tanstack/react-router";
import { Construction } from "lucide-react";
import { TopNav } from "@/components/maskan/TopNav";
import { useLanguage } from "@/lib/i18n/context";

// Rendered instead of a route's real content when the feature is Hide-Phase1
// (see docs/implementation/mymakan-phase1.md "Routes changed") — the route
// file itself is never deleted, only its `component` swapped for this at the
// route definition, so restoring the feature later is a one-line change.
export function PhaseGate() {
  const { t } = useLanguage();
  return (
    <div className="min-h-screen bg-background">
      <TopNav />
      <div className="container-page flex min-h-[60vh] flex-col items-center justify-center gap-4 py-16 text-center">
        <div className="grid size-16 place-items-center rounded-2xl bg-surface text-muted-foreground">
          <Construction className="size-8" />
        </div>
        <div>
          <h1 className="font-display text-xl font-bold tracking-tight">{t("phaseGate.heading")}</h1>
          <p className="mt-2 max-w-md text-sm text-muted-foreground">{t("phaseGate.desc")}</p>
        </div>
        <Link to="/" className="text-sm font-semibold text-primary hover:underline">
          {t("phaseGate.backHome")}
        </Link>
      </div>
    </div>
  );
}
