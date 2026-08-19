import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { ArrowLeft, CheckCircle2, MessageCircle, MoveRight } from "lucide-react";
import { TopNav } from "@/components/maskan/TopNav";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useAuth } from "@/lib/auth-context";
import { useLanguage } from "@/lib/i18n/context";
import { formatSAR } from "@/lib/maskan-data";
import { fetchNegotiation, type ApiPropertyNegotiationDetail } from "@/lib/api/maskan";

// Filename note: `negotiations.$id_.agreement.tsx` — the trailing underscore
// after `$id` is TanStack Router's flat-routes "escape nesting" marker
// (same convention this codebase already uses for `admin_.notifications.tsx`
// etc.). It keeps the resulting URL at /negotiations/$id/agreement while
// NOT treating negotiations.$id.tsx as this route's layout — so the
// already-verified negotiations.$id.tsx (Prompt 8) needs zero changes to
// gain this child route. It still nests under negotiations.tsx (Prompt 9's
// new list route), whose Outlet guard already lets any /negotiations/*
// path through unmodified. Documented in
// docs/implementation/mymakan-negotiations.md "Screens changed".
export const Route = createFileRoute("/negotiations/$id_/agreement")({
  head: () => ({ meta: [{ title: "Agreement Summary — myMakan" }] }),
  component: AgreementSummaryPage,
});

function formatDate(iso: string, lang: string): string {
  return new Date(iso).toLocaleDateString(lang === "ar" ? "ar-SA" : "en-US", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

function AgreementSummaryPage() {
  const { id } = Route.useParams();
  const { user, authLoading } = useAuth();
  const { t, lang } = useLanguage();
  const [negotiation, setNegotiation] = useState<ApiPropertyNegotiationDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const negotiationId = Number(id);

  useEffect(() => {
    if (authLoading || !user) return;
    if (Number.isNaN(negotiationId)) {
      setError(t("negotiationAgreement.notFound"));
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    fetchNegotiation(negotiationId)
      .then(setNegotiation)
      .catch(() => setError(t("negotiationAgreement.unableToLoad")))
      .finally(() => setLoading(false));
  }, [id, user, authLoading, negotiationId, t]);

  if (authLoading || loading) {
    return (
      <div className="min-h-screen bg-surface">
        <TopNav />
        <div className="container-page py-10">
          <Skeleton className="h-8 w-48" />
          <Skeleton className="mt-6 h-96 max-w-xl rounded-2xl" />
        </div>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="min-h-screen bg-surface">
        <TopNav />
        <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4 px-4">
          <h1 className="text-xl font-bold">{t("negotiationAgreement.signInToView")}</h1>
          <Button asChild>
            <Link to="/auth">{t("navAuth.signIn")}</Link>
          </Button>
        </div>
      </div>
    );
  }

  if (error || !negotiation) {
    return (
      <div className="container-page py-12">
        <TopNav />
        <p className="mt-6 text-sm text-destructive">{error ?? t("negotiationAgreement.notFound")}</p>
      </div>
    );
  }

  // Backend only populates agreement_summary once negotiation.status ===
  // "accepted" (see build_agreement_summary()'s docstring) — never
  // fabricated client-side. A customer navigating here directly for a
  // not-yet-accepted negotiation sees this explanatory state instead of a
  // broken/blank page.
  const summary = negotiation.agreement_summary;
  if (!summary) {
    return (
      <div className="min-h-screen bg-surface">
        <TopNav />
        <div className="container-page py-10">
          <Link
            to="/negotiations/$id"
            params={{ id: String(negotiation.id) }}
            className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="size-4 rtl:rotate-180" /> {t("negotiationAgreement.back")}
          </Link>
          <p className="mt-6 text-sm text-muted-foreground">{t("negotiationAgreement.notYetAgreed")}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-surface">
      <TopNav />
      <div className="container-page py-10">
        <Link
          to="/negotiations/$id"
          params={{ id: String(negotiation.id) }}
          className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-4 rtl:rotate-180" /> {t("negotiationAgreement.back")}
        </Link>

        <div className="mx-auto mt-6 max-w-xl">
          <div className="rounded-2xl border border-success/30 bg-success/5 p-6 shadow-card">
            <div className="flex items-center gap-2 text-success">
              <CheckCircle2 className="size-5" />
              <h1 className="font-display text-xl font-bold tracking-tight">{t("negotiationAgreement.heading")}</h1>
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              {t("negotiationAgreement.reference", { reference: summary.negotiation_reference })}
            </p>

            <dl className="mt-5 divide-y divide-border border-y border-border text-sm">
              <Row label={t("negotiationAgreement.fields.property")} value={summary.property_title ?? `#${summary.property_id}`} />
              <Row label={t("negotiationAgreement.fields.customer")} value={summary.customer_name ?? "—"} />
              <Row label={t("negotiationAgreement.fields.mediator")} value={summary.mediator_agent_name ?? "—"} />
              <Row
                label={t("negotiationAgreement.fields.transactionType")}
                value={t(summary.transaction_type === "sale" ? "negotiationAgreement.transactionSale" : "negotiationAgreement.transactionRent")}
              />
              <Row
                label={t("negotiationAgreement.fields.originalListing")}
                value={`SAR ${formatSAR(Math.round(Number(summary.original_listing_amount)))}`}
              />
              <Row
                label={t("negotiationAgreement.fields.finalAgreed")}
                value={`SAR ${formatSAR(Math.round(Number(summary.final_agreed_amount)))}`}
                emphasized
              />
              <Row
                label={t("negotiationAgreement.fields.agreedAt")}
                value={summary.agreed_at ? formatDate(summary.agreed_at, lang) : "—"}
              />
            </dl>

            {/* Disclaimer — verbatim, per brief §22. Sourced from the same
                i18n key negotiations.$id.tsx's Offer Agreed state uses, so
                the two screens can never say something different. */}
            <p className="mt-5 rounded-xl border border-border bg-background/60 px-3 py-2.5 text-xs text-muted-foreground">
              {t("negotiationDetail.agreed.disclaimer")}
            </p>

            <div className="mt-5 space-y-2.5">
              {negotiation.lead_id != null && (
                <Link to="/lead/$leadId" params={{ leadId: String(negotiation.lead_id) }} className="block">
                  <Button variant="outline" className="w-full">
                    <MessageCircle className="size-4" /> {t("negotiationDetail.agreed.messageMediator")}
                  </Button>
                </Link>
              )}
              <Link to="/transaction/$id" params={{ id: String(negotiation.id) }} className="block">
                <Button variant="hero" className="w-full">
                  <MoveRight className="size-4" /> {t("negotiationDetail.agreed.continueTransaction")}
                </Button>
              </Link>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function Row({ label, value, emphasized }: { label: string; value: string; emphasized?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3 py-2.5">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className={emphasized ? "font-display text-lg font-bold tracking-tight" : "font-medium"}>{value}</dd>
    </div>
  );
}
