import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import {
  Activity,
  AlertTriangle,
  ArrowLeft,
  Building2,
  CheckCircle2,
  Download,
  FileText,
  Info,
  ListChecks,
  Loader2,
  MapPin,
  MessageCircle,
  RefreshCw,
  Sparkles,
  UserRound,
  X,
} from "lucide-react";
import { Badge } from "@/components/maskan/Badges";
import { EmptyState } from "@/components/maskan/EmptyState";
import { TransactionStepper } from "@/components/maskan/TransactionStepper";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useAuth } from "@/lib/auth-context";
import { useLanguage } from "@/lib/i18n/context";
import { formatSAR } from "@/lib/maskan-data";
import { statusTone, readinessText, nbaText } from "@/lib/transactionWorkspace";
import {
  fetchPartnerTransaction,
  acceptTransactionDocumentAsPartner,
  requestTransactionDocumentUpdateAsPartner,
  downloadTransactionDocumentAsPartner,
  confirmPartnerTransactionInformation,
  fetchPartnerTransactionAssistant,
  TRANSACTION_MEDIATOR_QUICK_ACTIONS,
  type ApiPartnerPropertyTransactionDetail,
  type ApiTransactionDocument,
} from "@/lib/api/maskan";

export const Route = createFileRoute("/partner/transactions/$id")({
  head: () => ({ meta: [{ title: "Transaction — myMakan Partner" }] }),
  component: PartnerTransactionDetailPage,
});

type TabKey = "overview" | "customer" | "documents" | "checklist" | "activity" | "aiAssistant";
const TABS: { key: TabKey; icon: typeof Info }[] = [
  { key: "overview", icon: Info },
  { key: "customer", icon: UserRound },
  { key: "documents", icon: FileText },
  { key: "checklist", icon: ListChecks },
  { key: "activity", icon: Activity },
  { key: "aiAssistant", icon: Sparkles },
];

function formatDateTime(iso: string, lang: string): string {
  return new Date(iso).toLocaleString(lang === "ar" ? "ar-SA-u-nu-latn" : "en-US", {
    month: "long",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function PartnerTransactionDetailPage() {
  const { id } = Route.useParams();
  const { user, authLoading } = useAuth();
  const { t } = useLanguage();
  const [transaction, setTransaction] = useState<ApiPartnerPropertyTransactionDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<TabKey>("overview");

  const transactionId = Number(id);

  function load() {
    setLoading(true);
    setError(null);
    fetchPartnerTransaction(transactionId)
      .then(setTransaction)
      .catch(() => setError(t("partnerTransactions.detail.unableToLoad")))
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    if (authLoading || !user) return;
    if (Number.isNaN(transactionId)) {
      setError(t("partnerTransactions.detail.notFound"));
      setLoading(false);
      return;
    }
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, user, authLoading]);

  if (authLoading || loading) {
    return (
      <div className="min-h-screen bg-surface p-8">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="mt-6 h-64 rounded-2xl" />
      </div>
    );
  }

  if (error || !transaction) {
    return (
      <div className="min-h-screen bg-surface px-6 py-12">
        <EmptyState
          icon={Building2}
          title={error ?? t("partnerTransactions.detail.notFound")}
          action={
            <Button variant="outline" onClick={load}>
              <RefreshCw className="size-4" /> {t("partnerTransactions.retry")}
            </Button>
          }
        />
        <Link to="/partner/transactions" className="mt-4 inline-block text-sm text-primary">
          {t("partnerTransactions.detail.back")}
        </Link>
      </div>
    );
  }

  const readiness = readinessText(t, transaction.readiness_label);
  const nbaMessage = nbaText(t, transaction.next_best_action, readiness);
  const perMonth = transaction.transaction_type === "rent" ? t("negotiationDetail.offerBlock.perMonth") : "";
  const terms = transaction.terms_snapshot;
  // Same wording-rule special case as the customer workspace
  // (transaction.$id.tsx) — once ready_for_next_step is reached, show the
  // real rent/sale readiness string, never the generic "Ready for Next
  // Step" humanization of the raw status enum.
  const statusLabel =
    transaction.status === "ready_for_next_step"
      ? readinessText(t, transaction.transaction_type === "sale" ? "Ready for Sale Process" : "Ready for Rental Contract Process")
      : t(`transactionPage.status.${transaction.status}`);
  const steps = transaction.checklist.map((step) => ({
    key: step.key,
    status: step.status,
    detail: step.detail,
    label:
      step.key === "ready_for_next_step"
        ? readinessText(t, transaction.transaction_type === "sale" ? "Ready for Sale Process" : "Ready for Rental Contract Process")
        : t(`transactionPage.checklist.${step.key}`),
  }));

  return (
    <div className="min-h-screen bg-surface">
      <header className="border-b border-border bg-background px-6 py-4">
        <div className="mx-auto flex max-w-4xl items-center gap-3">
          <Link to="/partner/transactions" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
            <ArrowLeft className="size-4 rtl:rotate-180" /> {t("partnerTransactions.detail.back")}
          </Link>
          <span className="text-muted-foreground">/</span>
          <Badge tone={statusTone(transaction.status)}>{statusLabel}</Badge>
        </div>
      </header>

      <main className="mx-auto max-w-4xl px-6 py-8">
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-5">
          <div className="lg:col-span-3 space-y-4">
            {/* Header — property/type/reference/agreed amount + stepper */}
            <section className="rounded-2xl border border-border bg-card p-5 shadow-card">
              <div className="flex items-start gap-4">
                {transaction.property_image_url && (
                  <img src={transaction.property_image_url} alt="" className="size-16 shrink-0 rounded-xl object-cover" />
                )}
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <h1 dir="auto" className="truncate font-display text-lg font-bold tracking-tight">
                      {transaction.property_title ?? `#${transaction.property_id}`}
                    </h1>
                    <Badge tone="secondary">{t(transaction.transaction_type === "rent" ? "transactionPage.typeRent" : "transactionPage.typeSale")}</Badge>
                  </div>
                  {transaction.property_area && (
                    <div className="mt-1 flex items-center gap-1 text-xs text-muted-foreground">
                      <MapPin className="size-3.5" /> {transaction.property_area}
                    </div>
                  )}
                  <div className="mt-1 text-xs text-muted-foreground">{t("myTransactions.card.reference", { reference: transaction.reference })}</div>
                </div>
              </div>
              <div className="mt-4 border-t border-border pt-4">
                <TransactionStepper steps={steps} progressPercentage={transaction.progress_percentage} progressLabel={t("transactionPage.progress")} />
              </div>
            </section>

            {/* Next Best Action */}
            <section className="rounded-2xl border border-ai/20 bg-ai-soft/40 p-5 shadow-card">
              <div className="flex items-center gap-2">
                <Sparkles className="size-4 text-ai" />
                <h2 className="text-sm font-semibold">{t("transactionPage.nba.title")}</h2>
              </div>
              <p className="mt-2 text-sm leading-relaxed">{nbaMessage}</p>
            </section>

            {/* Tab bar + bodies */}
            <section className="rounded-2xl border border-border bg-card shadow-card">
              <div className="flex flex-wrap gap-1 border-b border-border p-2">
                {TABS.map(({ key, icon: Icon }) => (
                  <button
                    key={key}
                    type="button"
                    onClick={() => setTab(key)}
                    className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-medium transition-colors ${
                      tab === key ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-surface-2"
                    }`}
                  >
                    <Icon className="size-3.5" /> {t(`transactionPage.tabs.${key === "customer" ? "myInformation" : key}`)}
                  </button>
                ))}
              </div>
              <div className="p-6">
                {tab === "overview" && (
                  <div className="space-y-4">
                    <h3 className="text-sm font-semibold text-muted-foreground">{t("transactionPage.overview.termsTitle")}</h3>
                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                      <InfoRow label={t("transactionPage.overview.property")} value={terms?.property_title ?? transaction.property_title ?? `#${transaction.property_id}`} />
                      <InfoRow
                        label={t("transactionPage.overview.transactionType")}
                        value={t(transaction.transaction_type === "rent" ? "transactionPage.typeRent" : "transactionPage.typeSale")}
                      />
                      {terms?.original_listing_amount != null && (
                        <InfoRow
                          label={t("transactionPage.overview.originalListing")}
                          value={`SAR ${formatSAR(Math.round(Number(terms.original_listing_amount)))}${perMonth}`}
                        />
                      )}
                      <InfoRow
                        label={t("transactionPage.overview.finalAgreed")}
                        value={`SAR ${formatSAR(Math.round(Number(terms?.final_agreed_amount ?? transaction.agreed_amount)))}${perMonth}`}
                      />
                      {terms?.agreed_at && <InfoRow label={t("transactionPage.overview.agreedAt")} value={new Date(terms.agreed_at).toLocaleDateString()} />}
                      {terms?.negotiation_reference && (
                        <InfoRow label={t("transactionPage.overview.negotiationReference")} value={terms.negotiation_reference} />
                      )}
                    </div>
                  </div>
                )}
                {tab === "customer" && <CustomerTab transaction={transaction} onUpdated={setTransaction} />}
                {tab === "documents" && <DocumentsTab transaction={transaction} onUpdated={setTransaction} />}
                {tab === "checklist" && <ChecklistDetailTab steps={steps} />}
                {tab === "activity" && <ActivityTab transaction={transaction} />}
                {tab === "aiAssistant" && <AiAssistantPanel transactionId={transaction.id} />}
              </div>
            </section>
          </div>

          <div className="lg:col-span-2 space-y-3">
            <div className="rounded-2xl border border-border bg-card p-5 shadow-card space-y-2.5">
              <h2 className="mb-1 text-sm font-semibold text-muted-foreground">{t("partnerTransactions.detail.actions.title")}</h2>
              {transaction.lead_id != null && (
                <Button variant="outline" className="w-full" asChild>
                  <Link to="/partner/leads/$leadId" params={{ leadId: String(transaction.lead_id) }}>
                    <MessageCircle className="size-4" /> {t("partnerTransactions.detail.actions.messageCustomer")}
                  </Link>
                </Button>
              )}
              <Button variant="outline" className="w-full" asChild>
                <Link to="/property/$id" params={{ id: String(transaction.property_id) }}>
                  <Building2 className="size-4" /> {t("partnerTransactions.detail.actions.viewProperty")}
                </Link>
              </Button>
              <Button variant="outline" className="w-full" asChild>
                <Link to="/partner/negotiations/$id" params={{ id: String(transaction.negotiation_id) }}>
                  <CheckCircle2 className="size-4" /> {t("transactionPage.viewNegotiation")}
                </Link>
              </Button>
              <Button variant="ai" className="w-full" onClick={() => setTab("aiAssistant")}>
                <Sparkles className="size-4" /> {t("partnerTransactions.detail.aiAssistant.title")}
              </Button>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-0.5 text-sm font-semibold">{value}</div>
    </div>
  );
}

// Customer tab — restricted `customer` snapshot (name only, matches
// PartnerTransactionCustomerOut's privacy bar — never phone/email) +
// Information Confirmation (mediator's own confirm-information action,
// independent of the customer's own confirmation).
function CustomerTab({
  transaction,
  onUpdated,
}: {
  transaction: ApiPartnerPropertyTransactionDetail;
  onUpdated: (updated: ApiPartnerPropertyTransactionDetail) => void;
}) {
  const { t, lang } = useLanguage();
  const [confirming, setConfirming] = useState(false);
  const [confirmError, setConfirmError] = useState<string | null>(null);
  const isTerminal = transaction.status === "completed" || transaction.status === "cancelled";

  async function handleConfirm() {
    setConfirming(true);
    setConfirmError(null);
    try {
      const updated = await confirmPartnerTransactionInformation(transaction.id);
      onUpdated(updated);
    } catch (err) {
      setConfirmError(err instanceof Error ? err.message : t("partnerTransactions.detail.confirmInformation.failed"));
    } finally {
      setConfirming(false);
    }
  }

  return (
    <div className="space-y-8">
      <div>
        <h3 className="text-sm font-semibold text-muted-foreground">{t("partnerTransactions.detail.summary.customer")}</h3>
        <p className="mt-2 text-sm font-semibold">{transaction.customer.full_name ?? t("partnerLeadDetail.name")}</p>
      </div>

      <div className="rounded-xl border border-border bg-surface p-5">
        <h3 className="text-sm font-semibold">{t("partnerTransactions.detail.confirmInformation.title")}</h3>
        <p className="mt-1 text-sm text-muted-foreground">{t("partnerTransactions.detail.confirmInformation.desc")}</p>
        {confirmError && <p className="mt-2 text-xs text-destructive">{confirmError}</p>}
        {transaction.mediator_info_confirmed_at ? (
          <div className="mt-3 inline-flex items-center gap-2 text-sm font-medium text-success">
            <CheckCircle2 className="size-4" />
            {t("partnerTransactions.detail.confirmInformation.confirmedAt", {
              datetime: new Date(transaction.mediator_info_confirmed_at).toLocaleString(lang === "ar" ? "ar-SA-u-nu-latn" : "en-US"),
            })}
          </div>
        ) : (
          <Button className="mt-3" onClick={() => void handleConfirm()} disabled={confirming || isTerminal}>
            {confirming && <Loader2 className="size-4 animate-spin" />}
            {confirming ? t("partnerTransactions.detail.confirmInformation.confirming") : t("partnerTransactions.detail.confirmInformation.button")}
          </Button>
        )}
      </div>
    </div>
  );
}

const DOC_STATUS_TONE: Record<string, "neutral" | "info" | "success" | "warning"> = {
  not_uploaded: "neutral",
  uploaded: "info",
  accepted: "success",
  needs_update: "warning",
};

// Documents tab — View (authenticated download) / Accept / Request Update
// per document, per brief §11. Only "uploaded" documents can be
// accepted/flagged (mirrors the backend's own 409 gate).
function DocumentsTab({
  transaction,
  onUpdated,
}: {
  transaction: ApiPartnerPropertyTransactionDetail;
  onUpdated: (updated: ApiPartnerPropertyTransactionDetail) => void;
}) {
  const { t } = useLanguage();
  const [requestUpdateFor, setRequestUpdateFor] = useState<ApiTransactionDocument | null>(null);

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">{t("partnerTransactions.detail.documents.subtitle")}</p>
      <div className="space-y-3">
        {transaction.documents.map((doc) => (
          <PartnerDocumentCard
            key={doc.id}
            transactionId={transaction.id}
            document={doc}
            onUpdated={onUpdated}
            onRequestUpdate={() => setRequestUpdateFor(doc)}
          />
        ))}
      </div>
      {requestUpdateFor && (
        <RequestUpdateModal
          transactionId={transaction.id}
          document={requestUpdateFor}
          onClose={() => setRequestUpdateFor(null)}
          onSuccess={(updated) => {
            onUpdated(updated);
            setRequestUpdateFor(null);
          }}
        />
      )}
    </div>
  );
}

function PartnerDocumentCard({
  transactionId,
  document,
  onUpdated,
  onRequestUpdate,
}: {
  transactionId: number;
  document: ApiTransactionDocument;
  onUpdated: (updated: ApiPartnerPropertyTransactionDetail) => void;
  onRequestUpdate: () => void;
}) {
  const { t } = useLanguage();
  const [downloading, setDownloading] = useState(false);
  const [accepting, setAccepting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canReview = document.status === "uploaded";
  const canView = document.file_reference != null;

  async function handleView() {
    setDownloading(true);
    setError(null);
    try {
      const blob = await downloadTransactionDocumentAsPartner(transactionId, document.id);
      const url = URL.createObjectURL(blob);
      window.open(url, "_blank", "noopener,noreferrer");
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("partnerTransactions.detail.documents.downloadFailed"));
    } finally {
      setDownloading(false);
    }
  }

  async function handleAccept() {
    setAccepting(true);
    setError(null);
    try {
      const updated = await acceptTransactionDocumentAsPartner(transactionId, document.id);
      onUpdated(updated);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("partnerTransactions.detail.documents.acceptFailed"));
    } finally {
      setAccepting(false);
    }
  }

  return (
    <div className="rounded-xl border border-border bg-background p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-medium">{document.label}</span>
            {document.required ? (
              <Badge tone="secondary">{t("transactionPage.documents.requiredBadge")}</Badge>
            ) : (
              <Badge tone="neutral">{t("transactionPage.documents.optionalBadge")}</Badge>
            )}
          </div>
        </div>
        <Badge tone={DOC_STATUS_TONE[document.status] ?? "neutral"}>{t(`partnerTransactions.detail.documents.statusChip.${document.status}`)}</Badge>
      </div>

      {document.status === "needs_update" && document.review_note && (
        <div className="mt-3 flex items-start gap-2 rounded-lg border border-warning/30 bg-warning/10 px-3 py-2 text-xs text-warning">
          <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
          <div>{document.review_note}</div>
        </div>
      )}

      {error && <p className="mt-2 text-xs text-destructive">{error}</p>}

      <div className="mt-3 flex flex-wrap gap-2">
        {canView && (
          <Button variant="ghost" size="sm" onClick={() => void handleView()} disabled={downloading}>
            {downloading ? <Loader2 className="size-3.5 animate-spin" /> : <Download className="size-3.5" />}
            {downloading ? t("partnerTransactions.detail.documents.downloading") : t("partnerTransactions.detail.documents.viewButton")}
          </Button>
        )}
        {canReview && (
          <Button variant="outline" size="sm" onClick={() => void handleAccept()} disabled={accepting}>
            {accepting ? <Loader2 className="size-3.5 animate-spin" /> : <CheckCircle2 className="size-3.5" />}
            {accepting ? t("partnerTransactions.detail.documents.accepting") : t("partnerTransactions.detail.documents.accept")}
          </Button>
        )}
        {canReview && (
          <Button variant="outline" size="sm" onClick={onRequestUpdate}>
            <AlertTriangle className="size-3.5" /> {t("partnerTransactions.detail.documents.requestUpdate")}
          </Button>
        )}
      </div>
    </div>
  );
}

// Reason-required modal for "Request Update" — placeholder text mirrors the
// brief's own example ("Please upload a clearer copy.") shown as an input
// placeholder, not a preset value, since the backend rejects an
// empty/whitespace-only reason.
function RequestUpdateModal({
  transactionId,
  document,
  onClose,
  onSuccess,
}: {
  transactionId: number;
  document: ApiTransactionDocument;
  onClose: () => void;
  onSuccess: (updated: ApiPartnerPropertyTransactionDetail) => void;
}) {
  const { t } = useLanguage();
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit() {
    if (!reason.trim()) {
      setError(t("partnerTransactions.detail.documents.requestUpdateModal.reasonRequired"));
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const updated = await requestTransactionDocumentUpdateAsPartner(transactionId, document.id, reason.trim());
      onSuccess(updated);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("partnerTransactions.detail.documents.requestUpdateFailed"));
      setSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-foreground/50 backdrop-blur-sm px-4" onClick={onClose}>
      <div className="w-full max-w-sm rounded-2xl border border-border bg-background p-6 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-start justify-between gap-3">
          <h2 className="text-lg font-bold">{t("partnerTransactions.detail.documents.requestUpdateModal.title")}</h2>
          <Button variant="ghost" size="icon" onClick={onClose}>
            <X className="size-4" />
          </Button>
        </div>
        <div className="space-y-3">
          <p className="text-sm font-medium">{document.label}</p>
          <div>
            <label className="mb-1 block text-sm font-medium">{t("partnerTransactions.detail.documents.requestUpdateModal.reasonLabel")}</label>
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={3}
              placeholder={t("partnerTransactions.detail.documents.requestUpdateModal.reasonPlaceholder")}
              className="w-full rounded-xl border border-border bg-background px-3 py-2.5 text-sm outline-none focus:border-primary resize-none"
            />
          </div>
          {error && <p className="text-xs text-destructive">{error}</p>}
          <div className="flex gap-2.5 pt-1">
            <Button variant="outline" className="flex-1" onClick={onClose} disabled={submitting}>
              {t("partnerTransactions.detail.documents.requestUpdateModal.cancel")}
            </Button>
            <Button variant="hero" className="flex-1" onClick={() => void handleSubmit()} disabled={submitting || !reason.trim()}>
              {submitting ? t("partnerTransactions.detail.documents.requestUpdateModal.submitting") : t("partnerTransactions.detail.documents.requestUpdateModal.submit")}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

const CHECKLIST_STATUS_TONE: Record<string, "success" | "warning" | "neutral"> = {
  done: "success",
  in_progress: "warning",
  pending: "neutral",
};

function ChecklistDetailTab({ steps }: { steps: { key: string; label: string; status: string; detail?: string | null }[] }) {
  const { t } = useLanguage();
  return (
    <ol className="space-y-4">
      {steps.map((step, i) => (
        <li key={step.key} className="flex items-start gap-3">
          <span className="mt-0.5 grid size-6 shrink-0 place-items-center rounded-full border-2 border-border text-[11px] font-bold text-muted-foreground">
            {i + 1}
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm font-semibold">{step.label}</span>
              <Badge tone={CHECKLIST_STATUS_TONE[step.status] ?? "neutral"}>{t(`transactionPage.checklistStatus.${step.status}`)}</Badge>
              {step.detail && <span className="text-xs text-muted-foreground">{step.detail}</span>}
            </div>
          </div>
        </li>
      ))}
    </ol>
  );
}

// Activity — same client-side-derived timeline convention as
// TransactionActivityTimeline.tsx (customer web), built inline here since
// the partner detail response shape (`customer` instead of `customer_info`)
// isn't structurally assignable to that component's prop type.
function ActivityTab({ transaction }: { transaction: ApiPartnerPropertyTransactionDetail }) {
  const { t, lang } = useLanguage();
  type Ev = { at: string; label: string; detail?: string };
  const events: Ev[] = [{ at: transaction.created_at, label: t("transactionPage.activity.events.created") }];
  for (const doc of transaction.documents) {
    if (doc.uploaded_at) events.push({ at: doc.uploaded_at, label: t("transactionPage.activity.events.documentUploaded", { document: doc.label }) });
    if (doc.reviewed_at && doc.status === "accepted")
      events.push({ at: doc.reviewed_at, label: t("transactionPage.activity.events.documentAccepted", { document: doc.label }) });
    if (doc.reviewed_at && doc.status === "needs_update")
      events.push({
        at: doc.reviewed_at,
        label: t("transactionPage.activity.events.documentNeedsUpdate", { document: doc.label }),
        detail: doc.review_note ?? undefined,
      });
  }
  if (transaction.customer_info_confirmed_at)
    events.push({ at: transaction.customer_info_confirmed_at, label: t("transactionPage.activity.events.informationConfirmed") });
  if (transaction.mediator_info_confirmed_at)
    events.push({ at: transaction.mediator_info_confirmed_at, label: t("transactionPage.activity.events.mediatorInformationConfirmed") });
  if (transaction.ready_at)
    events.push({ at: transaction.ready_at, label: t("transactionPage.activity.events.ready", { state: readinessText(t, transaction.readiness_label) }) });
  if (transaction.completed_at) events.push({ at: transaction.completed_at, label: t("transactionPage.activity.events.completed") });
  if (transaction.cancelled_at)
    events.push({ at: transaction.cancelled_at, label: t("transactionPage.activity.events.cancelled"), detail: transaction.cancellation_reason ?? undefined });

  events.sort((a, b) => Date.parse(a.at) - Date.parse(b.at));

  if (events.length === 0) return <p className="text-sm text-muted-foreground">{t("transactionPage.activity.empty")}</p>;

  return (
    <ol className="space-y-3">
      {events.map((e, i) => (
        <li key={i} className="flex items-start gap-3 text-sm">
          <div className="mt-0.5 grid size-7 shrink-0 place-items-center rounded-full bg-surface-2 text-muted-foreground">
            <CheckCircle2 className="size-3.5" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="font-medium">{e.label}</div>
            {e.detail && <div className="mt-0.5 text-xs text-muted-foreground">{e.detail}</div>}
            <div className="mt-0.5 text-xs text-muted-foreground">{formatDateTime(e.at, lang)}</div>
          </div>
        </li>
      ))}
    </ol>
  );
}

// AI Assistant — mediator quick-action vocabulary (Prompt 6:
// summarize_outstanding / whats_blocking / draft_update_request /
// summarize_customer_progress), same reply/fallback rendering convention as
// TransactionAskMyMakanPanel.tsx (customer web).
function AiAssistantPanel({ transactionId }: { transactionId: number }) {
  const { t, lang } = useLanguage();
  const [activeAction, setActiveAction] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ reply: string; generated_by: "ai" | "fallback" } | null>(null);

  async function handleQuickAction(action: string) {
    setActiveAction(action);
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const data = await fetchPartnerTransactionAssistant(transactionId, action, lang === "ar" ? "ar" : "en");
      setResult(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("partnerTransactions.detail.aiAssistant.failed"));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">{t("partnerTransactions.detail.aiAssistant.subtitle")}</p>
      <div className="flex flex-wrap gap-2">
        {TRANSACTION_MEDIATOR_QUICK_ACTIONS.map((action) => (
          <Button key={action} variant={activeAction === action ? "ai" : "outline"} size="sm" onClick={() => void handleQuickAction(action)} disabled={loading}>
            {t(`partnerTransactions.detail.aiAssistant.quickActions.${action}`)}
          </Button>
        ))}
      </div>

      {loading && <p className="text-sm text-muted-foreground">{t("partnerTransactions.detail.aiAssistant.asking")}</p>}
      {error && <p className="text-sm text-destructive">{error}</p>}

      {result && (
        <div className="rounded-2xl border border-ai/20 bg-ai-soft/40 p-5">
          <Badge tone="ai">
            <Sparkles className="size-3.5" /> {t("partnerTransactions.detail.aiAssistant.aiLabel")}
          </Badge>
          <p className="mt-3 text-sm leading-relaxed">{result.reply}</p>
          {result.generated_by === "fallback" && <p className="mt-3 text-xs text-muted-foreground">{t("partnerTransactions.detail.aiAssistant.fallbackNote")}</p>}
        </div>
      )}
    </div>
  );
}
