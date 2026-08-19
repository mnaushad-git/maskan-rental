import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { ArrowLeft, CheckCircle2, Handshake, Mail, MapPin, MessageCircle, Phone, TrendingDown, TrendingUp, X } from "lucide-react";
import { Badge } from "@/components/maskan/Badges";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useAuth } from "@/lib/auth-context";
import { useLanguage } from "@/lib/i18n/context";
import { formatSAR } from "@/lib/maskan-data";
import { NEGOTIATION_SIGNAL_TONE, NEGOTIATION_SIGNAL_I18N_KEY } from "@/lib/negotiationSignal";
import {
  fetchPartnerNegotiation,
  counterNegotiationAsPartner,
  acceptNegotiationAsPartner,
  rejectNegotiationAsPartner,
  NEGOTIATION_MEDIATOR_REJECT_REASONS,
  fetchPropertyIntelligence,
  type ApiPartnerNegotiationDetail,
  type ApiPropertyIntelligence,
} from "@/lib/api/maskan";

export const Route = createFileRoute("/partner/negotiations/$id")({
  // Optional `?action=counter|reject` deep link — used by the Offers &
  // Negotiations list's Counter/Reject card actions (Prompt 10) to land here
  // with the matching modal already open, instead of duplicating the
  // Counter/Reject modal UI on the list page. Same idiom as the customer-side
  // My Negotiations list's `?ask=1` deep link into negotiations.$id.tsx.
  validateSearch: (s: Record<string, unknown>): { action?: "counter" | "reject" } => ({
    action: s.action === "counter" || s.action === "reject" ? s.action : undefined,
  }),
  head: () => ({ meta: [{ title: "Negotiation — myMakan Partner" }] }),
  component: PartnerNegotiationDetailPage,
});

const STATUS_TONE: Record<string, "success" | "warning" | "info" | "neutral" | "destructive"> = {
  submitted: "info",
  countered: "warning",
  accepted: "success",
  rejected: "destructive",
  withdrawn: "neutral",
  closed: "neutral",
};

function formatDateTime(iso: string, lang: string): string {
  return new Date(iso).toLocaleString(lang === "ar" ? "ar-SA" : "en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function PartnerNegotiationDetailPage() {
  const { id } = Route.useParams();
  const { action } = Route.useSearch();
  const { user, authLoading } = useAuth();
  const { t, lang } = useLanguage();
  const [negotiation, setNegotiation] = useState<ApiPartnerNegotiationDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [intelligence, setIntelligence] = useState<ApiPropertyIntelligence | null>(null);
  const [intelligenceError, setIntelligenceError] = useState(false);
  const [showCounter, setShowCounter] = useState(() => action === "counter");
  const [showReject, setShowReject] = useState(() => action === "reject");
  const [accepting, setAccepting] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const negotiationId = Number(id);

  async function loadNegotiation() {
    const detail = await fetchPartnerNegotiation(negotiationId);
    setNegotiation(detail);
    // Market Context (brief §8) — reuses the same GET /properties/{id}/
    // intelligence endpoint Property Detail already calls, rather than a new
    // route. Soft-failed the same way fetchAreaIntelligence/fetchMyViewings
    // already are elsewhere — this card is supplementary, never blocks the
    // rest of the page.
    fetchPropertyIntelligence(detail.property_id)
      .then(setIntelligence)
      .catch(() => setIntelligenceError(true));
    return detail;
  }

  useEffect(() => {
    if (authLoading || !user) return;
    if (Number.isNaN(negotiationId)) {
      setError(t("partnerNegotiations.detail.notFound"));
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    loadNegotiation()
      .catch(() => setError(t("partnerNegotiations.detail.unableToLoad")))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, user, authLoading]);

  async function handleAccept() {
    if (!negotiation) return;
    setAccepting(true);
    setActionError(null);
    try {
      await acceptNegotiationAsPartner(negotiation.id);
      await loadNegotiation();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : t("partnerNegotiations.detail.actions.acceptFailed"));
    } finally {
      setAccepting(false);
    }
  }

  if (authLoading || loading) {
    return (
      <div className="min-h-screen bg-surface p-8">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="mt-6 h-64 rounded-2xl" />
      </div>
    );
  }

  if (error || !negotiation) {
    return (
      <div className="min-h-screen bg-surface px-6 py-12">
        <p className="text-sm text-destructive">{error ?? t("partnerNegotiations.detail.notFound")}</p>
        <Link to="/partner/negotiations" className="mt-4 inline-block text-sm text-primary">
          {t("partnerNegotiations.detail.back")}
        </Link>
      </div>
    );
  }

  const currentOffer = Number(negotiation.current_offer_amount);
  const listingAmount = Number(negotiation.original_listing_amount);
  const diff = currentOffer - listingAmount;
  const diffPct = listingAmount ? (Math.abs(diff) / listingAmount) * 100 : 0;
  const isBelow = diff < 0;
  const perMonth = negotiation.transaction_type === "rent" ? t("negotiationDetail.offerBlock.perMonth") : "";

  const isActive = negotiation.status === "submitted" || negotiation.status === "countered";
  const latestOffer = negotiation.offers[negotiation.offers.length - 1];
  // Mirrors the customer detail page's canAccept, inverted: a mediator can
  // never accept their own mediator_counter row (self-accept-blocked rule),
  // so Accept is only offered when the latest pending offer is one of the
  // customer's own (customer_offer / customer_counter).
  const canAccept = isActive && !!latestOffer && latestOffer.offer_type !== "mediator_counter" && latestOffer.status === "pending";

  const priceIntel = intelligence?.price_intelligence;
  const estimatedLow = priceIntel?.fair_range_low ?? priceIntel?.estimated_value_low ?? null;
  const estimatedHigh = priceIntel?.fair_range_high ?? priceIntel?.estimated_value_high ?? null;

  return (
    <div className="min-h-screen bg-surface">
      <header className="border-b border-border bg-background px-6 py-4">
        <div className="mx-auto flex max-w-4xl items-center gap-3">
          <Link to="/partner/negotiations" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
            <ArrowLeft className="size-4 rtl:rotate-180" /> {t("partnerNegotiations.detail.back")}
          </Link>
          <span className="text-muted-foreground">/</span>
          <Badge tone={STATUS_TONE[negotiation.status] ?? "neutral"}>{t(`negotiationDetail.status.${negotiation.status}`)}</Badge>
        </div>
      </header>

      <main className="mx-auto max-w-4xl px-6 py-8">
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-5">
          <div className="lg:col-span-3 space-y-4">
            {/* Property block */}
            <div className="rounded-2xl border border-border bg-card p-5 shadow-card space-y-3">
              <h2 className="font-semibold">{t("partnerNegotiations.detail.propertyBlock")}</h2>
              <div className="flex items-center gap-3">
                {negotiation.property_image_url && (
                  <img src={negotiation.property_image_url} alt="" className="size-16 shrink-0 rounded-xl object-cover" />
                )}
                <div className="min-w-0">
                  <div className="truncate font-semibold">{negotiation.property_title ?? `#${negotiation.property_id}`}</div>
                  {negotiation.property_district && (
                    <div className="flex items-center gap-1 text-xs text-muted-foreground">
                      <MapPin className="size-3.5" /> {negotiation.property_district}
                    </div>
                  )}
                </div>
              </div>
              <div className="text-sm">
                <span className="text-muted-foreground">{t("partnerNegotiations.detail.listingPrice")}: </span>
                <span className="font-medium">
                  SAR {formatSAR(Math.round(listingAmount))}
                  {perMonth}
                </span>
              </div>
              <Link
                to="/property/$id"
                params={{ id: String(negotiation.property_id) }}
                className="inline-block text-xs text-primary hover:underline"
              >
                {t("partnerNegotiations.detail.viewProperty")}
              </Link>
            </div>

            {/* Customer block — only what the existing partner lead view
                already exposes (name/phone/email), no more. */}
            <div className="rounded-2xl border border-border bg-card p-5 shadow-card space-y-2">
              <h2 className="font-semibold">{t("partnerNegotiations.detail.customerBlock")}</h2>
              <div className="text-sm font-medium">{negotiation.customer_name ?? t("partnerLeadDetail.name")}</div>
              {negotiation.customer_phone && (
                <a href={`tel:${negotiation.customer_phone}`} className="flex items-center gap-1.5 text-sm text-primary hover:underline">
                  <Phone className="size-3.5" /> {negotiation.customer_phone}
                </a>
              )}
              {negotiation.customer_email && (
                <a href={`mailto:${negotiation.customer_email}`} className="flex items-center gap-1.5 text-sm text-primary hover:underline">
                  <Mail className="size-3.5" /> {negotiation.customer_email}
                </a>
              )}
            </div>

            {/* Offer block */}
            <div className="rounded-2xl border border-border bg-card p-5 shadow-card space-y-3">
              <h2 className="font-semibold">{t("partnerNegotiations.detail.offerBlock.title")}</h2>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <div className="text-xs text-muted-foreground">{t("partnerNegotiations.detail.offerBlock.currentAmount")}</div>
                  <div className="font-display text-xl font-bold tracking-tight">
                    SAR {formatSAR(Math.round(currentOffer))}
                    {perMonth}
                  </div>
                </div>
                <div>
                  <div className="text-xs text-muted-foreground">{t("partnerNegotiations.detail.offerBlock.listingPrice")}</div>
                  <div className="font-display text-xl font-bold tracking-tight text-muted-foreground">
                    SAR {formatSAR(Math.round(listingAmount))}
                  </div>
                </div>
              </div>
              {listingAmount > 0 && (
                <div className={`inline-flex items-center gap-1.5 text-sm font-medium ${isBelow ? "text-success" : "text-warning"}`}>
                  {isBelow ? <TrendingDown className="size-4" /> : <TrendingUp className="size-4" />}
                  {t(isBelow ? "negotiationDetail.offerBlock.belowListing" : "negotiationDetail.offerBlock.aboveListing", {
                    amount: formatSAR(Math.round(Math.abs(diff))),
                    percent: diffPct.toFixed(1),
                  })}
                </div>
              )}
              {/* Negotiation strength signal (brief §14) — was previously
                  only rendered on the customer-side detail screen even
                  though the backend already embeds it on
                  PartnerNegotiationDetailOut too; closed in the Prompt 12
                  polish pass (@/lib/negotiationSignal — same badge/coloring
                  every other surface uses). */}
              {negotiation.negotiation_signal && (
                <div className="border-t border-border pt-3">
                  <Badge tone={NEGOTIATION_SIGNAL_TONE[negotiation.negotiation_signal.signal]}>
                    {t(`negotiationDetail.signal.tag.${NEGOTIATION_SIGNAL_I18N_KEY[negotiation.negotiation_signal.signal]}`)}
                  </Badge>
                </div>
              )}
              <div className="border-t border-border pt-3 text-sm">
                <div className="text-xs text-muted-foreground">{t("partnerNegotiations.detail.offerBlock.message")}</div>
                <p className="mt-1">{latestOffer?.message?.trim() || t("partnerNegotiations.detail.offerBlock.noMessage")}</p>
              </div>
              {latestOffer && (
                <p className="text-xs text-muted-foreground">
                  {t("partnerNegotiations.detail.offerBlock.submittedTime")}: {formatDateTime(latestOffer.created_at, lang)}
                </p>
              )}
            </div>

            {/* Market Context — reuses GET /properties/{id}/intelligence.
                Deliberately omits anything from the customer's own viewing
                (personalized_fit / smart_questions / private notes) — only
                the estimated range, comparable summary, and data confidence
                per this prompt's explicit scope. */}
            <div className="rounded-2xl border border-border bg-card p-5 shadow-card space-y-2">
              <h2 className="font-semibold">{t("partnerNegotiations.detail.marketContext.title")}</h2>
              {intelligenceError ? (
                <p className="text-sm text-muted-foreground">{t("partnerNegotiations.detail.marketContext.unableToLoad")}</p>
              ) : !intelligence ? (
                <Skeleton className="h-16 rounded-xl" />
              ) : !priceIntel?.sufficient_data || estimatedLow == null || estimatedHigh == null ? (
                <p className="text-sm text-muted-foreground">{t("partnerNegotiations.detail.marketContext.insufficientData")}</p>
              ) : (
                <div className="space-y-1.5 text-sm">
                  <div>
                    <span className="text-muted-foreground">{t("partnerNegotiations.detail.marketContext.estimatedRange")}: </span>
                    <span className="font-medium">
                      SAR {formatSAR(Math.round(estimatedLow))}–{formatSAR(Math.round(estimatedHigh))}
                    </span>
                  </div>
                  <div className="text-muted-foreground">
                    {t("partnerNegotiations.detail.marketContext.comparableCount", { count: intelligence.comparable_summary.count })}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {t("partnerNegotiations.detail.marketContext.confidence")}: {intelligence.data_confidence.level}
                    {" — "}
                    {intelligence.data_confidence.reason}
                  </div>
                </div>
              )}
            </div>
          </div>

          <div className="lg:col-span-2 space-y-3">
            <div className="rounded-2xl border border-border bg-card p-5 shadow-card space-y-2.5">
              <h2 className="mb-1 text-sm font-semibold text-muted-foreground">{t("partnerNegotiations.detail.actions.title")}</h2>
              {canAccept && (
                <Button variant="hero" className="w-full" onClick={() => void handleAccept()} disabled={accepting}>
                  <CheckCircle2 className="size-4" /> {accepting ? t("partnerNegotiations.detail.actions.accepting") : t("partnerNegotiations.detail.actions.accept")}
                </Button>
              )}
              {isActive && (
                <Button variant="outline" className="w-full" onClick={() => setShowCounter(true)}>
                  <Handshake className="size-4" /> {t("partnerNegotiations.detail.actions.counter")}
                </Button>
              )}
              {isActive && !canAccept && (
                <p className="px-1 text-xs text-muted-foreground">{t("partnerNegotiations.detail.actions.waitingOnCustomer")}</p>
              )}
              {isActive && (
                <Button variant="outline" className="w-full" onClick={() => setShowReject(true)}>
                  <X className="size-4" /> {t("partnerNegotiations.detail.actions.reject")}
                </Button>
              )}
              {negotiation.lead_id != null && (
                <Button variant="outline" className="w-full" asChild>
                  <Link to="/partner/leads/$leadId" params={{ leadId: String(negotiation.lead_id) }}>
                    <MessageCircle className="size-4" /> {t("partnerNegotiations.detail.actions.messageCustomer")}
                  </Link>
                </Button>
              )}
              <Button variant="outline" className="w-full" asChild>
                <Link to="/property/$id" params={{ id: String(negotiation.property_id) }}>
                  {t("partnerNegotiations.detail.actions.viewProperty")}
                </Link>
              </Button>
              {actionError && <p className="text-xs text-destructive">{actionError}</p>}
            </div>
          </div>
        </div>
      </main>

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
      {showReject && (
        <RejectModal
          negotiation={negotiation}
          onClose={() => setShowReject(false)}
          onSuccess={async () => {
            await loadNegotiation();
            setShowReject(false);
          }}
        />
      )}
    </div>
  );
}

function CounterModal({
  negotiation,
  onClose,
  onSuccess,
}: {
  negotiation: ApiPartnerNegotiationDetail;
  onClose: () => void;
  onSuccess: () => Promise<void>;
}) {
  const { t } = useLanguage();
  const [amount, setAmount] = useState(String(Math.round(Number(negotiation.current_offer_amount))));
  const [message, setMessage] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const amountNumber = Number(amount);

  async function handleSubmit() {
    if (!amountNumber || amountNumber <= 0) return;
    setSubmitting(true);
    setError(null);
    try {
      await counterNegotiationAsPartner(negotiation.id, { amount: amountNumber, message: message.trim() || undefined });
      await onSuccess();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("partnerNegotiations.detail.counterModal.failed"));
      setSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-foreground/50 backdrop-blur-sm px-4" onClick={onClose}>
      <div className="w-full max-w-sm rounded-2xl border border-border bg-background p-6 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-start justify-between gap-3">
          <h2 className="text-lg font-bold">{t("partnerNegotiations.detail.counterModal.title")}</h2>
          <Button variant="ghost" size="icon" onClick={onClose}>
            <X className="size-4" />
          </Button>
        </div>
        <div className="space-y-3">
          <div>
            <label className="mb-1 block text-sm font-medium">{t("partnerNegotiations.detail.counterModal.amountLabel")}</label>
            <input
              type="number"
              min={1}
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              className="h-10 w-full rounded-xl border border-border bg-background px-3 text-sm outline-none focus:border-primary"
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium">{t("partnerNegotiations.detail.counterModal.messageLabel")}</label>
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
              {t("partnerNegotiations.detail.counterModal.cancel")}
            </Button>
            <Button
              variant="hero"
              className="flex-1"
              onClick={() => void handleSubmit()}
              disabled={submitting || !amountNumber || amountNumber <= 0}
            >
              {submitting ? t("partnerNegotiations.detail.counterModal.submitting") : t("partnerNegotiations.detail.counterModal.submit")}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

function RejectModal({
  negotiation,
  onClose,
  onSuccess,
}: {
  negotiation: ApiPartnerNegotiationDetail;
  onClose: () => void;
  onSuccess: () => Promise<void>;
}) {
  const { t } = useLanguage();
  const [reason, setReason] = useState<string>(NEGOTIATION_MEDIATOR_REJECT_REASONS[0]);
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleConfirm() {
    setSubmitting(true);
    setError(null);
    try {
      // Backend accepts a single free-text reason (no separate note field) —
      // same fold-note-into-reason idiom the customer-side WithdrawModal uses.
      const finalReason = note.trim() ? `${reason}: ${note.trim()}` : reason;
      await rejectNegotiationAsPartner(negotiation.id, finalReason);
      await onSuccess();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("partnerNegotiations.detail.rejectModal.failed"));
      setSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-foreground/50 backdrop-blur-sm px-4" onClick={onClose}>
      <div className="w-full max-w-sm rounded-2xl border border-border bg-background p-6 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-start justify-between gap-3">
          <h2 className="text-lg font-bold">{t("partnerNegotiations.detail.rejectModal.title")}</h2>
          <Button variant="ghost" size="icon" onClick={onClose}>
            <X className="size-4" />
          </Button>
        </div>
        <div className="space-y-3">
          <div>
            <label className="mb-1 block text-sm font-medium">{t("partnerNegotiations.detail.rejectModal.reasonLabel")}</label>
            <select
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              className="h-10 w-full rounded-xl border border-border bg-background px-3 text-sm outline-none focus:border-primary"
            >
              {NEGOTIATION_MEDIATOR_REJECT_REASONS.map((r) => (
                <option key={r} value={r}>
                  {t(`partnerNegotiations.detail.rejectModal.reasons.${r}`)}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium">{t("partnerNegotiations.detail.rejectModal.noteLabel")}</label>
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
              {t("partnerNegotiations.detail.rejectModal.cancel")}
            </Button>
            <Button variant="destructive" className="flex-1" onClick={() => void handleConfirm()} disabled={submitting}>
              {submitting ? t("partnerNegotiations.detail.rejectModal.submitting") : t("partnerNegotiations.detail.rejectModal.confirm")}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
