import { FileText } from "lucide-react";
import { TopNav } from "@/components/maskan/TopNav";
import { Button } from "@/components/ui/button";
import { useLanguage } from "@/lib/i18n/context";

/**
 * Terms of Use / Privacy Policy page.
 *
 * No approved legal text exists in this codebase, and legal commitments must
 * not be invented here. The published policy is therefore configured per
 * deployment (VITE_TERMS_URL / VITE_PRIVACY_POLICY_URL). Until it is
 * configured, the page says so plainly instead of showing placeholder text.
 */
export function LegalDocumentPage({ kind }: { kind: "terms" | "privacy" }) {
  const { t } = useLanguage();
  const title = t(kind === "terms" ? "legal.termsTitle" : "legal.privacyTitle");
  const url = (
    kind === "terms" ? import.meta.env.VITE_TERMS_URL : import.meta.env.VITE_PRIVACY_POLICY_URL
  ) as string | undefined;

  return (
    <div className="min-h-screen bg-surface">
      <TopNav />
      <main className="container-page max-w-2xl py-12">
        <div className="rounded-2xl border border-border bg-card p-8 shadow-card">
          <div className="mb-4 grid size-12 place-items-center rounded-xl bg-primary/10 text-primary">
            <FileText className="size-6" />
          </div>
          <h1 className="font-display text-3xl font-bold tracking-tight">{title}</h1>
          {url ? (
            <div className="mt-4 space-y-4">
              <p className="text-sm text-muted-foreground">
                {t("legal.externalNote", { document: title })}
              </p>
              <Button asChild>
                <a href={url} target="_blank" rel="noopener noreferrer">
                  {t("legal.openPolicy", { document: title })}
                </a>
              </Button>
            </div>
          ) : (
            <div className="mt-4 rounded-xl border border-warning/30 bg-warning/10 p-4">
              <p className="text-sm font-semibold">{t("legal.notPublishedTitle")}</p>
              <p className="mt-1 text-sm text-muted-foreground">
                {t("legal.notPublishedBody", { document: title })}
              </p>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
