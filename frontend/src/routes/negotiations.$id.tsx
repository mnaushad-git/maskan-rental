import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import {
  ArrowLeft,
  Building2,
  CheckCircle2,
  Handshake,
  MapPin,
  MessageCircle,
  MoveRight,
  Sparkles,
  TrendingDown,
  TrendingUp,
  X,
} from "lucide-react";
import { TopNav } from "@/components/maskan/TopNav";
import { Badge } from "@/components/maskan/Badges";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useAuth } from "@/lib/auth-context";
import { useLanguage } from "@/lib/i18n/context";
import { formatSAR } from "@/lib/maskan-data";
import { NEGOTIATION_SIGNAL_TONE, NEGOTIATION_SIGNAL_I18N_KEY, type NegotiationSignalKey } from "@/lib/negotiationSignal";
import {
  fetchNegotiation,
  submitCounterOffer,
  acceptNegotiation,
  withdrawNegotiation,
  fetchNegotiationGuidance,
  fetchPropertyAiSummary,
  NEGOTIATION_CUSTOMER_WITHDRAW_REASONS,
  type ApiPropertyNegotiationDetail,
} from "@/lib/api/maskan";

export const Route = createFileRoute("/negotiations/$id")({
  // Optional `?ask=1` deep link — used by the My Negotiations list's "Ask
  // myMakan" card action (Prompt 9) to land here with the Ask myMakan panel
  // already open, instead of duplicating that panel's UI on the list page.
  validateSearch: (s: Record<string, unknown>): { ask?: boolean } => ({
    ask: s.ask === true || s.ask === "true" ? true : undefined,
  }),
  head: () => ({ meta: [{ title: "Negotiation — myMakan" }] }),
  component: NegotiationDetailPage,
});

const STATUS_TONE: Record<string, "success" | "warning" | "info" | "neutral" | "destructive"> = {
  submitted: "info",
  countered: "warning",
  accepted: "success",
  rejected: "destructive",
  withdrawn: "neutral",
  closed: "neutral",
};

// Negotiation strength signal (brief §14) — read directly off the backend's
// `negotiation_signal` field (backend/app/services/negotiation_signals.py::
// compute_negotiation_signal(), embedded in GET /negotiations/{id} as of
// the Prompt 8 follow-up), not re-derived client-side. Tone/i18n-key mapping
// now lives in @/lib/negotiationSignal (Prompt 12) so every surface that
// renders this badge shares one mapping.
type SignalKey = NegotiationSignalKey;

function formatDateTime(iso: string, lang: string): string {
  return new Date(iso).toLocaleString(lang === "ar" ? "ar-SA" : "en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function NegotiationDetailPage() {
  const { id } = Route.useParams();
  const { ask } = Route.useSearch();
  const { user, authLoading } = useAuth();
  const { t, lang } = useLanguage();
  const [negotiation, setNegotiation] = useState<ApiPropertyNegotiationDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showCounter, setShowCounter] = useState(false);
  const [showWithdraw, setShowWithdraw] = useState(false);
  // Defaults open when landing here from the My Negotiations list's "Ask
  // myMakan" card action (?ask=1) — see the Route's validateSearch above.
  const [showAsk, setShowAsk] = useState(() => ask === true);
  const [accepting, setAccepting] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const negotiationId = Number(id);

  async function loadNegotiation() {
    const detail = await fetchNegotiation(negotiationId, lang === "ar" ? "ar" : "en");
    setNegotiation(detail);
    return detail;
  }

  useEffect(() => {
    if (authLoading || !user) return;
    if (Number.isNaN(negotiationId)) {
      setError(t("negotiationDetail.notFound"));
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    loadNegotiation()
      .catch(() => setError(t("negotiationDetail.unableToLoad")))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, user, authLoading, lang]);

  async function handleAccept() {
    if (!negotiation) return;
    setAccepting(true);
    setActionError(null);
    try {
      await acceptNegotiation(negotiation.id);
      await loadNegotiation();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : t("negotiationDetail.actions.acceptFailed"));
    } finally {
      setAccepting(false);
    }
  }

  if (authLoading || loading) {
    return (
      <div className="min-h-screen bg-surface">
        <TopNav />
        <div className="container-page py-10">
          <Skeleton className="h-8 w-48" />
          <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-[1fr_360px]">
            <Skeleton className="h-64 rounded-2xl" />
            <Skeleton className="h-64 rounded-2xl" />
          </div>
        </div>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="min-h-screen bg-surface">
        <TopNav />
        <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4 px-4">
          <h1 className="text-xl font-bold">{t("negotiationDetail.signInToView")}</h1>
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
        <p className="mt-6 text-sm text-destructive">{error ?? t("negotiationDetail.notFound")}</p>
      </div>
    );
  }

  const currentOffer = Number(negotiation.current_offer_amount);
  const listingAmount = Number(negotiation.original_listing_amount);
  const diff = currentOffer - listingAmount;
  const diffPct = listingAmount ? (Math.abs(diff) / listingAmount) * 100 : 0;
  const isBelow = diff < 0;
  const signalKey: SignalKey = negotiation.negotiation_signal?.signal ?? "limited_comparable_data";
  const insight = negotiation.negotiation_insight;
  const signalVars = {
    amount: formatSAR(Math.round(currentOffer)),
    low: insight ? formatSAR(Math.round(insight.discussion_range_low)) : "",
    high: insight ? formatSAR(Math.round(insight.discussion_range_high)) : "",
    asking: insight ? formatSAR(Math.round(insight.asking_price)) : "",
  };

  const isActive = negotiation.status === "submitted" || negotiation.status === "countered";
  const latestOffer = negotiation.offers[negotiation.offers.length - 1];
  const canAccept = isActive && latestOffer?.offer_type === "mediator_counter" && latestOffer.status === "pending";

  return (
    <div className="min-h-screen bg-surface">
      <TopNav />
      <div className="container-page py-8">
        <Link
          to="/property/$id"
          params={{ id: String(negotiation.property_id) }}
          className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-4 rtl:rotate-180" /> {t("negotiationDetail.back")}
        </Link>

        <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-[1fr_360px]">
          <div className="space-y-6">
            {/* Property block */}
            <section className="rounded-2xl border border-border bg-card p-6 shadow-card">
              <h2 className="text-sm font-semibold text-muted-foreground">{t("negotiationDetail.propertyBlock.title")}</h2>
              <div className="mt-3 flex items-center gap-4">
                {negotiation.property_image_url && (
                  <img src={negotiation.property_image_url} alt="" className="size-20 shrink-0 rounded-xl object-cover" />
                )}
                <div className="min-w-0">
                  <div className="truncate font-semibold">{negotiation.property_title ?? `#${negotiation.property_id}`}</div>
                  {negotiation.property_district && (
                    <div className="flex items-center gap-1 text-xs text-muted-foreground">
                      <MapPin className="size-3.5" /> {negotiation.property_district}
                    </div>
                  )}
                  <div className="mt-0.5 text-xs text-muted-foreground">
                    {t("negotiationDetail.propertyBlock.listingPrice")}: SAR {formatSAR(Math.round(listingAmount))}
                    {negotiation.transaction_type === "rent" ? t("negotiationDetail.offerBlock.perMonth") : ""}
                  </div>
                  <Link
                    to="/property/$id"
                    params={{ id: String(negotiation.property_id) }}
                    className="mt-1 inline-block text-xs text-primary hover:underline"
                  >
                    {t("negotiationDetail.propertyBlock.viewProperty")}
                  </Link>
                </div>
              </div>
            </section>

            {/* Offer Agreed state — brief §10. Shown once EITHER side has
                accepted (negotiation.status === "accepted", the same field
                the sticky aside's "View Agreement Summary" button already
                gates on). Amount comes from the deterministic
                agreement_summary (final_agreed_amount, read off the actually
                accepted offer row) with a defensive fallback to
                current_offer_amount for the rare case agreement_summary
                hasn't loaded yet. */}
            {negotiation.status === "accepted" && (
              <section className="rounded-2xl border border-success/30 bg-success/5 p-6 shadow-card">
                <div className="flex items-center gap-2 text-success">
                  <CheckCircle2 className="size-5" />
                  <h2 className="font-display text-lg font-bold tracking-tight">{t("negotiationDetail.agreed.title")}</h2>
                </div>
                <div className="mt-3">
                  <div className="text-xs text-muted-foreground">{t("negotiationDetail.agreed.agreedAmount")}</div>
                  <div className="font-display text-3xl font-bold tracking-tight">
                    SAR{" "}
                    {formatSAR(
                      Math.round(Number(negotiation.agreement_summary?.final_agreed_amount ?? negotiation.current_offer_amount)),
                    )}
                    {negotiation.transaction_type === "rent" ? t("negotiationDetail.offerBlock.perMonth") : ""}
                  </div>
                </div>
                {/* Disclaimer — verbatim, per brief §10/§22. Reused as-is by
                    negotiations.$id_.agreement.tsx's Agreement Summary page
                    (same i18n key) so the two screens can never drift. */}
                <p className="mt-4 rounded-xl border border-border bg-background/60 px-3 py-2.5 text-xs text-muted-foreground">
                  {t("negotiationDetail.agreed.disclaimer")}
                </p>
              </section>
            )}

            {/* Offer vs. listing comparison + negotiation strength signal */}
            <section className="rounded-2xl border border-border bg-card p-6 shadow-card">
              <div className="flex items-center justify-between gap-3">
                <h2 className="text-sm font-semibold text-muted-foreground">{t("negotiationDetail.offerBlock.title")}</h2>
                <Badge tone={STATUS_TONE[negotiation.status] ?? "neutral"}>
                  {t(`negotiationDetail.status.${negotiation.status}`)}
                </Badge>
              </div>
              <div className="mt-4 grid grid-cols-2 gap-4">
                <div>
                  <div className="text-xs text-muted-foreground">{t("negotiationDetail.offerBlock.yourOffer")}</div>
                  <div className="font-display text-2xl font-bold tracking-tight">SAR {formatSAR(Math.round(currentOffer))}</div>
                </div>
                <div>
                  <div className="text-xs text-muted-foreground">{t("negotiationDetail.offerBlock.listingPrice")}</div>
                  <div className="font-display text-2xl font-bold tracking-tight text-muted-foreground">
                    SAR {formatSAR(Math.round(listingAmount))}
                  </div>
                </div>
              </div>
              {listingAmount > 0 && (
                <div className={`mt-3 inline-flex items-center gap-1.5 text-sm font-medium ${isBelow ? "text-success" : "text-warning"}`}>
                  {isBelow ? <TrendingDown className="size-4" /> : <TrendingUp className="size-4" />}
                  {t(isBelow ? "negotiationDetail.offerBlock.belowListing" : "negotiationDetail.offerBlock.aboveListing", {
                    amount: formatSAR(Math.round(Math.abs(diff))),
                    percent: diffPct.toFixed(1),
                  })}
                </div>
              )}
              <div className="mt-4 border-t border-border pt-4">
                <Badge tone={NEGOTIATION_SIGNAL_TONE[signalKey]}>{t(`negotiationDetail.signal.tag.${NEGOTIATION_SIGNAL_I18N_KEY[signalKey]}`)}</Badge>
                <p className="mt-2 text-xs text-muted-foreground">
                  {t(`negotiationDetail.signal.label.${NEGOTIATION_SIGNAL_I18N_KEY[signalKey]}`, signalVars)}
                </p>
              </div>
              {(negotiation.status === "rejected" || negotiation.status === "withdrawn") && negotiation.cancellation_reason && (
                <p className="mt-4 rounded-xl bg-surface p-3 text-xs text-muted-foreground">
                  {t(negotiation.status === "rejected" ? "negotiationDetail.rejectedBanner.desc" : "negotiationDetail.withdrawnBanner.desc")}
                  {" — "}
                  {negotiation.cancellation_reason}
                </p>
              )}
            </section>

            {/* myMakan Summary — deterministic, always populated */}
            <section className="rounded-2xl border border-ai/20 bg-ai-soft/40 p-6 shadow-card">
              <div className="flex items-center gap-2">
                <Sparkles className="size-4 text-ai" />
                <h2 className="text-sm font-semibold">{t("negotiationDetail.summary.title")}</h2>
              </div>
              <p className="mt-2 text-sm leading-relaxed">{negotiation.summary_text}</p>
            </section>

            {/* Timeline — derived from the offer list + status timestamps */}
            <NegotiationTimeline negotiation={negotiation} lang={lang} t={t} />

            {/* Ask myMakan panel */}
            {showAsk && <AskMyMakanPanel negotiationId={negotiation.id} signalKey={signalKey} />}
          </div>

          {/* Actions block */}
          <aside className="space-y-4 lg:sticky lg:top-24 lg:self-start">
            <div className="rounded-2xl border border-border bg-card p-5 shadow-card">
              <h2 className="mb-3 text-sm font-semibold text-muted-foreground">{t("negotiationDetail.actions.title")}</h2>
              <div className="space-y-2.5">
                {canAccept && (
                  <Button variant="hero" className="w-full" onClick={() => void handleAccept()} disabled={accepting}>
                    <CheckCircle2 className="size-4" /> {accepting ? t("negotiationDetail.actions.accepting") : t("negotiationDetail.actions.accept")}
                  </Button>
                )}
                {isActive && (
                  <Button variant="outline" className="w-full" onClick={() => setShowCounter(true)}>
                    <Handshake className="size-4" /> {t("negotiationDetail.actions.counterAgain")}
                  </Button>
                )}
                {isActive && !canAccept && (
                  <p className="px-1 text-xs text-muted-foreground">{t("negotiationDetail.actions.waitingOnMediator")}</p>
                )}
                {isActive && (
                  <Button variant="outline" className="w-full" onClick={() => setShowWithdraw(true)}>
                    <X className="size-4" /> {t("negotiationDetail.actions.withdraw")}
                  </Button>
                )}
                {negotiation.status === "accepted" && (
                  <>
                    {/* Now a typed Link — negotiations.$id_.agreement.tsx
                        (Prompt 9) makes /negotiations/$id/agreement a real
                        route, closing the "plain <a> until the route file
                        exists" placeholder Prompt 8 left here. */}
                    <Button variant="hero" className="w-full" asChild>
                      <Link to="/negotiations/$id/agreement" params={{ id: String(negotiation.id) }}>
                        <CheckCircle2 className="size-4" /> {t("negotiationDetail.actions.viewAgreement")}
                      </Link>
                    </Button>
                    {negotiation.lead_id != null && (
                      <Button variant="outline" className="w-full" asChild>
                        <Link to="/lead/$leadId" params={{ leadId: String(negotiation.lead_id) }}>
                          <MessageCircle className="size-4" /> {t("negotiationDetail.agreed.messageMediator")}
                        </Link>
                      </Button>
                    )}
                    <Button variant="outline" className="w-full" asChild>
                      <Link to="/transaction/$id" params={{ id: String(negotiation.id) }}>
                        <MoveRight className="size-4" /> {t("negotiationDetail.agreed.continueTransaction")}
                      </Link>
                    </Button>
                  </>
                )}
                <Button variant="ai" className="w-full" onClick={() => setShowAsk((v) => !v)}>
                  <Sparkles className="size-4" /> {t("negotiationDetail.actions.askMyMakan")}
                </Button>
                <Button variant="outline" className="w-full" asChild>
                  <Link to="/property/$id" params={{ id: String(negotiation.property_id) }}>
                    <Building2 className="size-4" /> {t("negotiationDetail.actions.viewProperty")}
                  </Link>
                </Button>
                {actionError && <p className="text-xs text-destructive">{actionError}</p>}
              </div>
            </div>
          </aside>
        </div>
      </div>

      {showCounter && (
        <CounterModal
          negotiation={negotiation}
          onClose={() => setShowCounter(false)}
          onSuccess={async () => {
            await loadNegotiation();
            setShowCounter(false);
          }}
        />
      )}
      {showWithdraw && (
        <WithdrawModal
          negotiation={negotiation}
          onClose={() => setShowWithdraw(false)}
          onSuccess={async () => {
            await loadNegotiation();
            setShowWithdraw(false);
          }}
        />
      )}
    </div>
  );
}

function NegotiationTimeline({
  negotiation,
  lang,
  t,
}: {
  negotiation: ApiPropertyNegotiationDetail;
  lang: string;
  t: (key: string, vars?: Record<string, string | number>) => string;
}) {
  // Per brief §12's exact example shape: Customer Offer / Mediator Counter /
  // Customer Counter / Accepted, each with amount + time. Derived purely
  // client-side from the offer list + status timestamps — no dedicated
  // backend timeline endpoint (same decision the viewings feature made, see
  // tracking doc "Models").
  const events: { at: string; label: string; amount: number }[] = negotiation.offers.map((o) => ({
    at: o.created_at,
    amount: Number(o.amount),
    label: t(`negotiationDetail.timeline.${o.offer_type}`),
  }));
  if (negotiation.status === "accepted" && negotiation.accepted_at) {
    const acceptedOffer = negotiation.offers.find((o) => o.status === "accepted");
    events.push({
      at: negotiation.accepted_at,
      amount: Number(acceptedOffer?.amount ?? negotiation.current_offer_amount),
      label: t("negotiationDetail.timeline.accepted"),
    });
  }
  if (negotiation.status === "rejected" && negotiation.rejected_at) {
    events.push({
      at: negotiation.rejected_at,
      amount: Number(negotiation.current_offer_amount),
      label: t("negotiationDetail.timeline.rejected"),
    });
  }
  // No dedicated withdrawn_at column (see tracking doc "Known limitations")
  // — updated_at is the best available timestamp for this event.
  if (negotiation.status === "withdrawn") {
    events.push({
      at: negotiation.updated_at,
      amount: Number(negotiation.current_offer_amount),
      label: t("negotiationDetail.timeline.withdrawn"),
    });
  }
  events.sort((a, b) => Date.parse(a.at) - Date.parse(b.at));

  return (
    <section className="rounded-2xl border border-border bg-card p-6 shadow-card">
      <h2 className="mb-3 text-sm font-semibold text-muted-foreground">{t("negotiationDetail.timeline.title")}</h2>
      <ol className="space-y-3">
        {events.map((e, i) => (
          <li key={i} className="flex items-start gap-3 text-sm">
            <div className="mt-1.5 size-2 shrink-0 rounded-full bg-primary" />
            <div className="min-w-0 flex-1">
              <div className="flex items-center justify-between gap-3">
                <span className="font-medium">{e.label}</span>
                <span className="font-semibold">SAR {formatSAR(Math.round(e.amount))}</span>
              </div>
              <div className="text-xs text-muted-foreground">{formatDateTime(e.at, lang)}</div>
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}

function AskMyMakanPanel({ negotiationId, signalKey }: { negotiationId: number; signalKey: SignalKey }) {
  const { t, lang } = useLanguage();
  const [question, setQuestion] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ guidance: string; generated_by: "ai" | "fallback" } | null>(null);

  async function handleAsk() {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchNegotiationGuidance(negotiationId, question.trim() || undefined, lang === "ar" ? "ar" : "en");
      setResult(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("negotiationDetail.askPanel.failed"));
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className="rounded-2xl border border-ai/20 bg-ai-soft/40 p-6 shadow-card md:p-8">
      <div className="flex items-start gap-4">
        <div className="grid size-11 shrink-0 place-items-center rounded-xl bg-ai text-ai-foreground shadow-card">
          <Sparkles className="size-5" />
        </div>
        <div className="min-w-0 flex-1">
          <h2 className="font-display text-xl font-bold tracking-tight">{t("negotiationDetail.askPanel.title")}</h2>
          <p className="mt-1 text-sm text-muted-foreground">{t("negotiationDetail.askPanel.subtitle")}</p>

          <div className="mt-4 flex flex-col gap-2.5 sm:flex-row">
            <input
              type="text"
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              placeholder={t("negotiationDetail.askPanel.placeholder")}
              className="h-10 w-full rounded-xl border border-border bg-background px-3 text-sm outline-none focus:border-primary"
            />
            <Button variant="ai" onClick={() => void handleAsk()} disabled={loading}>
              <Sparkles className="size-4" /> {loading ? t("negotiationDetail.askPanel.asking") : t("negotiationDetail.askPanel.ask")}
            </Button>
          </div>

          {error && <p className="mt-3 text-xs text-destructive">{error}</p>}

          {result && (
            <div className="mt-4 space-y-3">
              <p className="text-sm leading-relaxed">{result.guidance}</p>
              {/* Brief §13: never let a low-confidence answer read as a
                  mathematically optimal offer. */}
              {signalKey === "limited_comparable_data" && (
                <p className="rounded-xl border border-warning/30 bg-warning/10 px-3 py-2 text-xs text-warning">
                  {t("negotiationDetail.askPanel.lowConfidenceNote")}
                </p>
              )}
              <p className="rounded-xl border border-border bg-background/60 px-3 py-2 text-xs text-muted-foreground">
                {t("negotiationDetail.askPanel.disclaimer")}
              </p>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

function CounterModal({
  negotiation,
  onClose,
  onSuccess,
}: {
  negotiation: ApiPropertyNegotiationDetail;
  onClose: () => void;
  onSuccess: () => Promise<void>;
}) {
  const { t, lang } = useLanguage();
  const [amount, setAmount] = useState(String(Math.round(Number(negotiation.current_offer_amount))));
  const [message, setMessage] = useState("");
  const [drafting, setDrafting] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const amountNumber = Number(amount);

  async function handleDraft() {
    setDrafting(true);
    try {
      // Reuses the extended POST /properties/{id}/ai-summary?
      // variant=negotiation_message call with negotiation_id (Prompt 6) —
      // grounds the draft in THIS negotiation's real offer history, not the
      // generic pre-negotiation discussion range.
      const resp = await fetchPropertyAiSummary(
        negotiation.property_id,
        lang === "ar" ? "ar" : "en",
        "negotiation_message",
        negotiation.id,
      );
      setMessage(resp.summary);
    } catch {
      // Best-effort — leave the field as-is on failure.
    } finally {
      setDrafting(false);
    }
  }

  async function handleSubmit() {
    if (!amountNumber || amountNumber <= 0) return;
    setSubmitting(true);
    setError(null);
    try {
      await submitCounterOffer(negotiation.id, { amount: amountNumber, message: message.trim() || undefined });
      await onSuccess();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("negotiationDetail.counterModal.failed"));
      setSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-foreground/50 backdrop-blur-sm px-4" onClick={onClose}>
      <div className="w-full max-w-sm rounded-2xl border border-border bg-background p-6 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-start justify-between gap-3">
          <h2 className="text-lg font-bold">{t("negotiationDetail.counterModal.title")}</h2>
          <Button variant="ghost" size="icon" onClick={onClose}>
            <X className="size-4" />
          </Button>
        </div>
        <div className="space-y-3">
          <div>
            <label className="mb-1 block text-sm font-medium">{t("negotiationDetail.counterModal.amountLabel")}</label>
            <input
              type="number"
              min={1}
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              className="h-10 w-full rounded-xl border border-border bg-background px-3 text-sm outline-none focus:border-primary"
            />
          </div>
          <div>
            <div className="mb-1 flex items-center justify-between gap-2">
              <label className="block text-sm font-medium">{t("negotiationDetail.counterModal.messageLabel")}</label>
              <Button variant="ghost" size="sm" onClick={() => void handleDraft()} disabled={drafting}>
                <Sparkles className="size-3.5" />
                {drafting ? t("negotiationDetail.counterModal.drafting") : t("negotiationDetail.counterModal.draftWithAI")}
              </Button>
            </div>
            <textarea
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              rows={3}
              className="w-full rounded-xl border border-border bg-background px-3 py-2.5 text-sm outline-none focus:border-primary resize-none"
            />
          </div>
          {error && <p className="text-xs text-destructive">{error}</p>}
          <div className="flex gap-2.5 pt-1">
            <Button variant="outline" className="flex-1" onClick={onClose} disabled={submitting}>
              {t("negotiationDetail.counterModal.cancel")}
            </Button>
            <Button
              variant="hero"
              className="flex-1"
              onClick={() => void handleSubmit()}
              disabled={submitting || !amountNumber || amountNumber <= 0}
            >
              {submitting ? t("negotiationDetail.counterModal.submitting") : t("negotiationDetail.counterModal.submit")}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

function WithdrawModal({
  negotiation,
  onClose,
  onSuccess,
}: {
  negotiation: ApiPropertyNegotiationDetail;
  onClose: () => void;
  onSuccess: () => Promise<void>;
}) {
  const { t } = useLanguage();
  const [reason, setReason] = useState<string>(NEGOTIATION_CUSTOMER_WITHDRAW_REASONS[0]);
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleConfirm() {
    setSubmitting(true);
    setError(null);
    try {
      // Backend accepts a single free-text reason (no separate note field) —
      // fold the optional note into it so the closed-list choice + any extra
      // detail both reach the mediator.
      const finalReason = note.trim() ? `${reason}: ${note.trim()}` : reason;
      await withdrawNegotiation(negotiation.id, finalReason);
      await onSuccess();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("negotiationDetail.withdrawModal.failed"));
      setSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-foreground/50 backdrop-blur-sm px-4" onClick={onClose}>
      <div className="w-full max-w-sm rounded-2xl border border-border bg-background p-6 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-start justify-between gap-3">
          <h2 className="text-lg font-bold">{t("negotiationDetail.withdrawModal.title")}</h2>
          <Button variant="ghost" size="icon" onClick={onClose}>
            <X className="size-4" />
          </Button>
        </div>
        <div className="space-y-3">
          <div>
            <label className="mb-1 block text-sm font-medium">{t("negotiationDetail.withdrawModal.reasonLabel")}</label>
            <select
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              className="h-10 w-full rounded-xl border border-border bg-background px-3 text-sm outline-none focus:border-primary"
            >
              {NEGOTIATION_CUSTOMER_WITHDRAW_REASONS.map((r) => (
                <option key={r} value={r}>
                  {t(`negotiationDetail.withdrawModal.reasons.${r}`)}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium">{t("negotiationDetail.withdrawModal.noteLabel")}</label>
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={3}
              className="w-full rounded-xl border border-border bg-background px-3 py-2.5 text-sm outline-none focus:border-primary resize-none"
            />
          </div>
          {error && <p className="text-xs text-destructive">{error}</p>}
          <div className="flex gap-2.5 pt-1">
            <Button variant="outline" className="flex-1" onClick={onClose} disabled={submitting}>
              {t("negotiationDetail.withdrawModal.cancel")}
            </Button>
            <Button variant="destructive" className="flex-1" onClick={() => void handleConfirm()} disabled={submitting}>
              {submitting ? t("negotiationDetail.withdrawModal.submitting") : t("negotiationDetail.withdrawModal.confirm")}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
