import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import {
  Activity,
  ArrowLeft,
  Building2,
  CheckCircle2,
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
  XCircle,
} from "lucide-react";
import { TopNav } from "@/components/maskan/TopNav";
import { EmptyState } from "@/components/maskan/EmptyState";
import { Badge } from "@/components/maskan/Badges";
import { TransactionStepper } from "@/components/maskan/TransactionStepper";
import { TransactionDocumentCard } from "@/components/maskan/TransactionDocumentCard";
import { TransactionActivityTimeline } from "@/components/maskan/TransactionActivityTimeline";
import { TransactionAskMyMakanPanel } from "@/components/maskan/TransactionAskMyMakanPanel";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useAuth } from "@/lib/auth-context";
import { useLanguage } from "@/lib/i18n/context";
import { formatSAR } from "@/lib/maskan-data";
import { statusTone, readinessText, nbaText } from "@/lib/transactionWorkspace";
import {
  fetchTransaction,
  updateTransactionCustomerInformation,
  confirmTransactionInformation,
  cancelTransaction,
  TRANSACTION_CUSTOMER_CANCEL_REASONS,
  type ApiPropertyTransactionDetail,
} from "@/lib/api/maskan";

export const Route = createFileRoute("/transaction/$id")({
  head: () => ({ meta: [{ title: "Transaction — myMakan" }] }),
  component: TransactionWorkspacePage,
});

type TabKey = "overview" | "myInformation" | "documents" | "checklist" | "activity" | "aiAssistant";
const TABS: { key: TabKey; icon: typeof Info }[] = [
  { key: "overview", icon: Info },
  { key: "myInformation", icon: UserRound },
  { key: "documents", icon: FileText },
  { key: "checklist", icon: ListChecks },
  { key: "activity", icon: Activity },
  { key: "aiAssistant", icon: Sparkles },
];

function TransactionWorkspacePage() {
  const { id } = Route.useParams();
  const { user, authLoading } = useAuth();
  const { t } = useLanguage();
  const [transaction, setTransaction] = useState<ApiPropertyTransactionDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<TabKey>("overview");
  const [showCancel, setShowCancel] = useState(false);

  const transactionId = Number(id);

  function load() {
    setLoading(true);
    setError(null);
    fetchTransaction(transactionId)
      .then(setTransaction)
      .catch(() => setError(t("transactionPage.unableToLoad")))
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    if (authLoading || !user) return;
    if (Number.isNaN(transactionId)) {
      setError(t("transactionPage.notFound"));
      setLoading(false);
      return;
    }
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, user, authLoading]);

  if (authLoading || loading) {
    return (
      <div className="min-h-screen bg-surface">
        <TopNav />
        <div className="container-page py-10">
          <Skeleton className="h-8 w-48" />
          <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-[1fr_360px]">
            <div className="space-y-6">
              <Skeleton className="h-48 rounded-2xl" />
              <Skeleton className="h-64 rounded-2xl" />
            </div>
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
          <h1 className="text-xl font-bold">{t("transactionPage.signInToView")}</h1>
          <Button asChild>
            <Link to="/auth">{t("navAuth.signIn")}</Link>
          </Button>
        </div>
      </div>
    );
  }

  if (error || !transaction) {
    return (
      <div className="min-h-screen bg-surface">
        <TopNav />
        <div className="container-page py-12">
          <EmptyState
            icon={Building2}
            title={error ?? t("transactionPage.notFound")}
            action={
              <Button variant="outline" onClick={load}>
                <RefreshCw className="size-4" /> {t("transactionPage.retry")}
              </Button>
            }
          />
        </div>
      </div>
    );
  }

  const readiness = readinessText(t, transaction.readiness_label);
  const nbaMessage = nbaText(t, transaction.next_best_action, readiness);
  const perMonth =
    transaction.transaction_type === "rent" ? t("negotiationDetail.offerBlock.perMonth") : "";
  // Status badge label — special-cases the final "ready" status the same
  // way the checklist's own last step already does below: once the
  // transaction reaches ready_for_next_step, the non-negotiable wording
  // rule (docs/implementation/mymakan-transaction-workspace.md) requires
  // showing the real rent/sale readiness string, never the generic
  // "Ready for Next Step" humanization of the raw status enum value.
  const statusLabel =
    transaction.status === "ready_for_next_step"
      ? readinessText(
          t,
          transaction.transaction_type === "sale"
            ? "Ready for Sale Process"
            : "Ready for Rental Contract Process",
        )
      : t(`transactionPage.status.${transaction.status}`);
  const steps = transaction.checklist.map((step) => ({
    key: step.key,
    status: step.status,
    detail: step.detail,
    label:
      step.key === "ready_for_next_step"
        ? readinessText(
            t,
            transaction.transaction_type === "sale"
              ? "Ready for Sale Process"
              : "Ready for Rental Contract Process",
          )
        : t(`transactionPage.checklist.${step.key}`),
  }));

  return (
    <div className="min-h-screen bg-surface">
      <TopNav />
      <div className="container-page py-8">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <Link
            to="/my-transactions"
            className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="size-4 rtl:rotate-180" />{" "}
            {t("transactionPage.backToTransactions")}
          </Link>
          <Link
            to="/negotiations/$id"
            params={{ id: String(transaction.negotiation_id) }}
            className="text-xs text-muted-foreground hover:text-foreground hover:underline"
          >
            {t("transactionPage.viewNegotiation")}
          </Link>
        </div>

        <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-[1fr_360px]">
          <div className="space-y-6">
            {transaction.status === "cancelled" && (
              <section className="rounded-2xl border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
                {t("transactionPage.cancelledBanner")}
                {transaction.cancellation_reason ? ` — ${transaction.cancellation_reason}` : ""}
              </section>
            )}

            {/* Header — property, type, reference, status, agreed amount, mediator, progress stepper (brief §20) */}
            <section className="rounded-2xl border border-border bg-card p-6 shadow-card">
              <div className="flex items-start gap-4">
                {transaction.property_image_url && (
                  <img
                    src={transaction.property_image_url}
                    alt=""
                    className="size-20 shrink-0 rounded-xl object-cover"
                  />
                )}
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <h1 dir="auto" className="truncate font-display text-lg font-bold tracking-tight">
                      {transaction.property_title ?? `#${transaction.property_id}`}
                    </h1>
                    <Badge tone="secondary">
                      {t(
                        transaction.transaction_type === "rent"
                          ? "transactionPage.typeRent"
                          : "transactionPage.typeSale",
                      )}
                    </Badge>
                    <Badge tone={statusTone(transaction.status)}>{statusLabel}</Badge>
                  </div>
                  {transaction.property_area && (
                    <div className="mt-1 flex items-center gap-1 text-xs text-muted-foreground">
                      <MapPin className="size-3.5" /> {transaction.property_area}
                    </div>
                  )}
                  <div className="mt-1 text-xs text-muted-foreground">
                    {t("transactionPage.reference", { reference: transaction.reference })}
                  </div>
                </div>
              </div>

              <div className="mt-5 grid grid-cols-2 gap-4 border-t border-border pt-5">
                <div>
                  <div className="text-xs text-muted-foreground">
                    {t("transactionPage.agreedAmount")}
                  </div>
                  <div className="font-display text-2xl font-bold tracking-tight">
                    SAR {formatSAR(Math.round(Number(transaction.agreed_amount)))}
                    {perMonth}
                  </div>
                </div>
                {transaction.mediator_agent_name && (
                  <div>
                    <div className="text-xs text-muted-foreground">
                      {t("transactionPage.mediator")}
                    </div>
                    <div className="text-sm font-semibold">{transaction.mediator_agent_name}</div>
                  </div>
                )}
              </div>

              <div className="mt-5 border-t border-border pt-5">
                <TransactionStepper
                  steps={steps}
                  progressPercentage={transaction.progress_percentage}
                  progressLabel={t("transactionPage.progress")}
                />
              </div>
            </section>

            {/* Next Best Action */}
            <section className="rounded-2xl border border-ai/20 bg-ai-soft/40 p-6 shadow-card">
              <div className="flex items-center gap-2">
                <Sparkles className="size-4 text-ai" />
                <h2 className="text-sm font-semibold">{t("transactionPage.nba.title")}</h2>
              </div>
              <p className="mt-2 text-sm leading-relaxed">{nbaMessage}</p>
            </section>

            {/* Tab bar + bodies (Prompt 9) */}
            <section className="rounded-2xl border border-border bg-card shadow-card">
              <div className="flex flex-wrap gap-1 border-b border-border p-2">
                {TABS.map(({ key, icon: Icon }) => (
                  <button
                    key={key}
                    type="button"
                    onClick={() => setTab(key)}
                    className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-medium transition-colors ${
                      tab === key
                        ? "bg-primary text-primary-foreground"
                        : "text-muted-foreground hover:bg-surface-2"
                    }`}
                  >
                    <Icon className="size-3.5" /> {t(`transactionPage.tabs.${key}`)}
                  </button>
                ))}
              </div>
              <div className="p-6">
                {tab === "overview" && <OverviewTab transaction={transaction} />}
                {tab === "myInformation" && (
                  <MyInformationTab transaction={transaction} onUpdated={setTransaction} />
                )}
                {tab === "documents" && (
                  <DocumentsTab transaction={transaction} onUpdated={setTransaction} />
                )}
                {tab === "checklist" && <ChecklistDetailTab steps={steps} />}
                {tab === "activity" && <TransactionActivityTimeline transaction={transaction} />}
                {tab === "aiAssistant" && (
                  <TransactionAskMyMakanPanel transactionId={transaction.id} />
                )}
              </div>
            </section>
          </div>

          {/* Actions block */}
          <aside className="space-y-4 lg:sticky lg:top-24 lg:self-start">
            <div className="rounded-2xl border border-border bg-card p-5 shadow-card">
              <h2 className="mb-3 text-sm font-semibold text-muted-foreground">
                {t("transactionPage.actions.title")}
              </h2>
              <div className="space-y-2.5">
                {transaction.lead_id != null && (
                  <Button variant="outline" className="w-full" asChild>
                    <Link to="/lead/$leadId" params={{ leadId: String(transaction.lead_id) }}>
                      <MessageCircle className="size-4" />{" "}
                      {t("transactionPage.actions.messageMediator")}
                    </Link>
                  </Button>
                )}
                <Button variant="outline" className="w-full" asChild>
                  <Link to="/property/$id" params={{ id: String(transaction.property_id) }}>
                    <Building2 className="size-4" /> {t("transactionPage.actions.viewProperty")}
                  </Link>
                </Button>
                <Button variant="outline" className="w-full" asChild>
                  <Link
                    to="/negotiations/$id/agreement"
                    params={{ id: String(transaction.negotiation_id) }}
                  >
                    <CheckCircle2 className="size-4" /> {t("transactionPage.actions.viewAgreement")}
                  </Link>
                </Button>
                <Button variant="ai" className="w-full" onClick={() => setTab("aiAssistant")}>
                  <Sparkles className="size-4" /> {t("transactionPage.actions.askMyMakan")}
                </Button>
                {transaction.status !== "completed" && transaction.status !== "cancelled" && (
                  <Button
                    variant="outline"
                    className="w-full text-destructive hover:text-destructive"
                    onClick={() => setShowCancel(true)}
                  >
                    <XCircle className="size-4" /> {t("transactionPage.actions.cancelTransaction")}
                  </Button>
                )}
              </div>
            </div>
          </aside>
        </div>
      </div>

      {showCancel && (
        <CancelTransactionModal
          transaction={transaction}
          onClose={() => setShowCancel(false)}
          onSuccess={(updated) => {
            setTransaction(updated);
            setShowCancel(false);
          }}
        />
      )}
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

// Agreed Commercial Terms (brief §13) — read-only, no free-form edit path.
// Reuses `terms_snapshot` verbatim (Prompt 4's own reuse of
// property_negotiation.build_agreement_summary()) rather than re-deriving
// any of these figures a second way.
function OverviewTab({ transaction }: { transaction: ApiPropertyTransactionDetail }) {
  const { t } = useLanguage();
  const terms = transaction.terms_snapshot;
  const perMonth =
    transaction.transaction_type === "rent" ? t("negotiationDetail.offerBlock.perMonth") : "";
  return (
    <div className="space-y-4">
      <h3 className="text-sm font-semibold text-muted-foreground">
        {t("transactionPage.overview.termsTitle")}
      </h3>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <InfoRow
          label={t("transactionPage.overview.property")}
          value={
            terms?.property_title ?? transaction.property_title ?? `#${transaction.property_id}`
          }
        />
        <InfoRow
          label={t("transactionPage.overview.transactionType")}
          value={t(
            transaction.transaction_type === "rent"
              ? "transactionPage.typeRent"
              : "transactionPage.typeSale",
          )}
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
        {terms?.agreed_at && (
          <InfoRow
            label={t("transactionPage.overview.agreedAt")}
            value={new Date(terms.agreed_at).toLocaleDateString()}
          />
        )}
        {terms?.negotiation_reference && (
          <InfoRow
            label={t("transactionPage.overview.negotiationReference")}
            value={terms.negotiation_reference}
          />
        )}
      </div>
    </div>
  );
}

// My Information (brief §8) — edit + save via Prompt 4's PATCH endpoint,
// plus Information Confirmation (brief §11's exact-wording action, never
// "Sign Contract").
function MyInformationTab({
  transaction,
  onUpdated,
}: {
  transaction: ApiPropertyTransactionDetail;
  onUpdated: (updated: ApiPropertyTransactionDetail) => void;
}) {
  const { t, lang } = useLanguage();
  const [fullName, setFullName] = useState(transaction.customer_info.full_name ?? "");
  const [phone, setPhone] = useState(transaction.customer_info.phone ?? "");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [confirmError, setConfirmError] = useState<string | null>(null);

  useEffect(() => {
    setFullName(transaction.customer_info.full_name ?? "");
    setPhone(transaction.customer_info.phone ?? "");
  }, [transaction.customer_info.full_name, transaction.customer_info.phone]);

  const isTerminal = transaction.status === "completed" || transaction.status === "cancelled";

  async function handleSave() {
    setSaving(true);
    setSaveError(null);
    setSaveSuccess(false);
    try {
      const updated = await updateTransactionCustomerInformation(transaction.id, {
        full_name: fullName.trim() || undefined,
        phone: phone.trim() || undefined,
      });
      onUpdated(updated);
      setSaveSuccess(true);
    } catch (err) {
      setSaveError(
        err instanceof Error ? err.message : t("transactionPage.myInformation.saveFailed"),
      );
    } finally {
      setSaving(false);
    }
  }

  async function handleConfirm() {
    setConfirming(true);
    setConfirmError(null);
    try {
      const updated = await confirmTransactionInformation(transaction.id);
      onUpdated(updated);
    } catch (err) {
      setConfirmError(
        err instanceof Error ? err.message : t("transactionPage.myInformation.confirmFailed"),
      );
    } finally {
      setConfirming(false);
    }
  }

  return (
    <div className="space-y-8">
      <div className="space-y-4">
        <p className="text-sm text-muted-foreground">
          {t("transactionPage.myInformation.subtitle")}
        </p>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label className="mb-1 block text-sm font-medium">
              {t("transactionPage.myInformation.emailLabel")}
            </label>
            <input
              value={transaction.customer_info.email}
              disabled
              className="h-10 w-full rounded-xl border border-border bg-surface px-3 text-sm text-muted-foreground outline-none"
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium">
              {t("transactionPage.myInformation.fullNameLabel")}
            </label>
            <input
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              placeholder={t("transactionPage.myInformation.fullNamePlaceholder")}
              disabled={isTerminal}
              className="h-10 w-full rounded-xl border border-border bg-background px-3 text-sm outline-none focus:border-primary disabled:opacity-50"
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium">
              {t("transactionPage.myInformation.phoneLabel")}
            </label>
            <input
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder={t("transactionPage.myInformation.phonePlaceholder")}
              disabled={isTerminal}
              className="h-10 w-full rounded-xl border border-border bg-background px-3 text-sm outline-none focus:border-primary disabled:opacity-50"
            />
          </div>
        </div>
        {saveError && <p className="text-xs text-destructive">{saveError}</p>}
        {saveSuccess && !saveError && (
          <p className="text-xs text-success">{t("transactionPage.myInformation.saveSuccess")}</p>
        )}
        <Button onClick={() => void handleSave()} disabled={saving || isTerminal}>
          {saving && <Loader2 className="size-4 animate-spin" />}
          {saving
            ? t("transactionPage.myInformation.saving")
            : t("transactionPage.myInformation.save")}
        </Button>
      </div>

      <div className="rounded-xl border border-border bg-surface p-5">
        <h3 className="text-sm font-semibold">{t("transactionPage.myInformation.confirmTitle")}</h3>
        <p className="mt-1 text-sm text-muted-foreground">
          {t("transactionPage.myInformation.confirmDesc")}
        </p>
        {confirmError && <p className="mt-2 text-xs text-destructive">{confirmError}</p>}
        {transaction.customer_info_confirmed_at ? (
          <div className="mt-3 inline-flex items-center gap-2 text-sm font-medium text-success">
            <CheckCircle2 className="size-4" />
            {t("transactionPage.myInformation.confirmedAt", {
              datetime: new Date(transaction.customer_info_confirmed_at).toLocaleString(
                lang === "ar" ? "ar-SA-u-nu-latn" : "en-US",
              ),
            })}
          </div>
        ) : (
          <Button
            className="mt-3"
            onClick={() => void handleConfirm()}
            disabled={confirming || isTerminal}
          >
            {confirming && <Loader2 className="size-4 animate-spin" />}
            {confirming
              ? t("transactionPage.myInformation.confirming")
              : t("transactionPage.myInformation.confirmButton")}
          </Button>
        )}
      </div>
    </div>
  );
}

// Documents (brief §9) — one TransactionDocumentCard per seeded document
// row; all upload/delete/download logic lives in that shared component.
function DocumentsTab({
  transaction,
  onUpdated,
}: {
  transaction: ApiPropertyTransactionDetail;
  onUpdated: (updated: ApiPropertyTransactionDetail) => void;
}) {
  const { t } = useLanguage();
  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">{t("transactionPage.documents.subtitle")}</p>
      <div className="space-y-3">
        {transaction.documents.map((doc) => (
          <TransactionDocumentCard
            key={doc.id}
            transactionId={transaction.id}
            document={doc}
            onUpdated={onUpdated}
          />
        ))}
      </div>
    </div>
  );
}

const CHECKLIST_STATUS_TONE: Record<string, "success" | "warning" | "neutral"> = {
  done: "success",
  in_progress: "warning",
  pending: "neutral",
};

// Checklist detail — the header TransactionStepper already renders this
// same data compactly; this tab adds the full per-step description so the
// investor-facing workspace has somewhere to explain *why* each step
// matters, without recomputing any status/detail values itself.
function ChecklistDetailTab({
  steps,
}: {
  steps: { key: string; label: string; status: string; detail?: string | null }[];
}) {
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
              <Badge tone={CHECKLIST_STATUS_TONE[step.status] ?? "neutral"}>
                {t(`transactionPage.checklistStatus.${step.status}`)}
              </Badge>
              {step.detail && <span className="text-xs text-muted-foreground">{step.detail}</span>}
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              {t(`transactionPage.checklistDetail.description.${step.key}`)}
            </p>
          </div>
        </li>
      ))}
    </ol>
  );
}

// Cancellation (brief §23) — reason picker + confirm, mirrors
// negotiations.$id.tsx's WithdrawModal pattern exactly. Only rendered by
// the parent while the transaction is non-terminal (mirrors the backend's
// own PROPERTY_TRANSACTION_TRANSITIONS gate — "cancelled" is reachable
// from every non-terminal status).
function CancelTransactionModal({
  transaction,
  onClose,
  onSuccess,
}: {
  transaction: ApiPropertyTransactionDetail;
  onClose: () => void;
  onSuccess: (updated: ApiPropertyTransactionDetail) => void;
}) {
  const { t } = useLanguage();
  const [reason, setReason] = useState<string>(TRANSACTION_CUSTOMER_CANCEL_REASONS[0]);
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleConfirm() {
    setSubmitting(true);
    setError(null);
    try {
      // Backend accepts a single free-text reason (no separate note field) —
      // fold the optional note into it, same convention WithdrawModal uses.
      const finalReason = note.trim() ? `${reason}: ${note.trim()}` : reason;
      const updated = await cancelTransaction(transaction.id, finalReason);
      onSuccess(updated);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("transactionPage.cancelModal.failed"));
      setSubmitting(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-foreground/50 backdrop-blur-sm px-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-sm rounded-2xl border border-border bg-background p-6 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-start justify-between gap-3">
          <h2 className="text-lg font-bold">{t("transactionPage.cancelModal.title")}</h2>
          <Button variant="ghost" size="icon" onClick={onClose}>
            <X className="size-4" />
          </Button>
        </div>
        <div className="space-y-3">
          <div>
            <label className="mb-1 block text-sm font-medium">
              {t("transactionPage.cancelModal.reasonLabel")}
            </label>
            <select
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              className="h-10 w-full rounded-xl border border-border bg-background px-3 text-sm outline-none focus:border-primary"
            >
              {TRANSACTION_CUSTOMER_CANCEL_REASONS.map((r) => (
                <option key={r} value={r}>
                  {t(`transactionPage.cancelModal.reasons.${r}`)}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium">
              {t("transactionPage.cancelModal.noteLabel")}
            </label>
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
              {t("transactionPage.cancelModal.cancel")}
            </Button>
            <Button
              variant="destructive"
              className="flex-1"
              onClick={() => void handleConfirm()}
              disabled={submitting}
            >
              {submitting
                ? t("transactionPage.cancelModal.cancelling")
                : t("transactionPage.cancelModal.confirm")}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
