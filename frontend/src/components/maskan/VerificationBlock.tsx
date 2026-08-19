// Generic, reusable "Verification" block (Property Verification & Trust
// Center spec section 21): myMakan ✓ vs. future external providers
// ("Not connected"). Built generically now — a caller passes a list of
// providers — but per Prompt 7's scope, only the myMakan row is ever
// rendered today; no other provider (REGA/Ejar/Nafath/etc.) is wired up or
// even named anywhere in this codebase. Reused as-is by the property Trust
// Center (Prompt 7). Prompt 9's mediator profile page reuses this same
// component and turns on `showExplainer`, which renders a small info
// popover with the "What does myMakan Verified mean?" copy — explicit that
// this is NOT a government/REGA/Ejar/Nafath verification (global wording
// constraint). Kept as an opt-in prop rather than always-on so Prompt 7's
// property Trust Center sheet (which doesn't ask for an explainer) renders
// unchanged.
import { Info, ShieldCheck } from "lucide-react";
import { cn } from "@/lib/utils";
import { useLanguage } from "@/lib/i18n/context";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

export type VerificationProvider = {
  key: string;
  name: string;
  status: "verified" | "not_connected";
  label: string;
};

export function VerificationBlock({
  providers,
  showExplainer = false,
}: {
  providers: VerificationProvider[];
  showExplainer?: boolean;
}) {
  const { t } = useLanguage();
  return (
    <div>
      <div className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        <ShieldCheck className="size-3.5" /> {t("verification.title")}
        {showExplainer && (
          <Popover>
            <PopoverTrigger asChild>
              <button
                type="button"
                aria-label={t("verification.explainerTitle")}
                className="grid size-4 shrink-0 place-items-center rounded-full text-muted-foreground/70 normal-case hover:text-foreground"
              >
                <Info className="size-3.5" />
              </button>
            </PopoverTrigger>
            <PopoverContent className="w-72 text-start" align="start">
              <p className="text-xs font-semibold text-foreground">
                {t("verification.explainerTitle")}
              </p>
              <p className="mt-1.5 text-xs font-normal normal-case leading-relaxed text-muted-foreground">
                {t("verification.explainer")}
              </p>
            </PopoverContent>
          </Popover>
        )}
      </div>
      <ul className="mt-2 space-y-1.5">
        {providers.map((p) => (
          <li key={p.key} className="flex items-center justify-between gap-3 text-sm">
            <span className="text-muted-foreground">{p.name}</span>
            <span
              className={cn(
                "font-semibold",
                p.status === "verified" ? "text-success" : "text-muted-foreground",
              )}
            >
              {p.label}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
