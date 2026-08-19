import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowLeft, Construction } from "lucide-react";
import { TopNav } from "@/components/maskan/TopNav";
import { EmptyState } from "@/components/maskan/EmptyState";
import { Button } from "@/components/ui/button";
import { useLanguage } from "@/lib/i18n/context";

// Placeholder only — brief §10 explicitly allows a "Coming soon" stand-in
// for "Continue Transaction" in this session. No payment/contract/Ejar/
// Nafath logic lives here or anywhere else in this feature (see
// docs/implementation/mymakan-negotiations.md "Known limitations").
export const Route = createFileRoute("/transaction/$id")({
  head: () => ({ meta: [{ title: "Transaction — myMakan" }] }),
  component: TransactionPlaceholderPage,
});

function TransactionPlaceholderPage() {
  const { id } = Route.useParams();
  const { t } = useLanguage();

  return (
    <div className="min-h-screen bg-surface">
      <TopNav />
      <div className="container-page py-10">
        <Link
          to="/negotiations/$id"
          params={{ id }}
          className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-4 rtl:rotate-180" /> {t("transactionPage.backToNegotiation")}
        </Link>
        <div className="mt-6 rounded-2xl border border-border bg-card p-6 shadow-card">
          <EmptyState
            icon={Construction}
            title={t("transactionPage.comingSoon")}
            description={t("transactionPage.desc")}
            action={
              <Link to="/negotiations/$id" params={{ id }}>
                <Button variant="outline">{t("transactionPage.backToNegotiation")}</Button>
              </Link>
            }
          />
        </div>
      </div>
    </div>
  );
}
