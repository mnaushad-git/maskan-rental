import { useEffect, useState } from "react";
import { View, Text, ScrollView, Image, TextInput, Pressable } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useLocalSearchParams, useRouter, Stack, Link } from "expo-router";
import { Building2, CheckCircle2, FileText, MapPin, MessageCircle, Sparkles, X } from "lucide-react-native";
import {
  fetchTransaction,
  updateTransactionCustomerInformation,
  confirmTransactionInformation,
  cancelTransaction,
  fetchTransactionAssistant,
  TRANSACTION_CUSTOMER_CANCEL_REASONS,
  TRANSACTION_CUSTOMER_QUICK_ACTIONS,
  type ApiPropertyTransactionDetail,
} from "@/lib/api/maskan";
import { useAuth } from "@/lib/auth-context";
import { useLanguage } from "@/lib/i18n/context";
import { formatSAR } from "@/lib/maskan-data";
import { readinessText, nbaText } from "@/lib/transactionWorkspace";
import { Button } from "@/components/ui/Button";
import { Chip } from "@/components/ui/Chip";
import { Badge } from "@/components/Badges";
import { Skeleton } from "@/components/ui/Skeleton";
import { BottomSheet } from "@/components/ui/BottomSheet";
import { TransactionStepper } from "@/components/TransactionStepper";
import { TransactionDocumentCard } from "@/components/TransactionDocumentCard";
import { colors } from "@/lib/colors";

// Transaction Workspace (Prompt 11's mobile counterpart to web's
// transaction.$id.tsx, Prompts 8-9). Mirrors mobile's own
// app/negotiations/[id].tsx structure: a single scrolling stack of
// section cards (not web's tab bar — RN screens in this app are
// consistently single-scroll, see that screen's own Offer Agreed/Market
// Context/Timeline sections), a toggleable Ask myMakan panel, and
// BottomSheet-based modals. The vertical TransactionStepper already shows
// every checklist step's label/status/detail fraction, so there's no
// separate "Checklist" section duplicating that data — same information,
// no redundant tab.
const STATUS_TONE: Record<string, "success" | "warning" | "info" | "neutral"> = {
  initiated: "info",
  information_required: "warning",
  documents_required: "warning",
  under_review: "info",
  ready_for_next_step: "success",
  external_process_pending: "success",
  completed: "success",
  cancelled: "warning",
};

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString("en-US", { month: "long", day: "numeric", hour: "numeric", minute: "2-digit" });
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <View className="flex-row items-start justify-between gap-3">
      <Text className="text-sm text-muted-foreground">{label}</Text>
      <Text className="flex-1 text-end text-sm font-medium text-foreground">{value}</Text>
    </View>
  );
}

export default function TransactionDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { user, authLoading } = useAuth();
  const { t, lang } = useLanguage();
  const router = useRouter();
  const [transaction, setTransaction] = useState<ApiPropertyTransactionDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showAsk, setShowAsk] = useState(false);
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
    if (authLoading || !user || !id) return;
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
      <SafeAreaView edges={["bottom"]} className="flex-1 gap-4 bg-background p-5">
        <Skeleton height={140} radius={16} />
        <Skeleton height={200} radius={16} />
      </SafeAreaView>
    );
  }

  if (!user) {
    return (
      <SafeAreaView edges={["bottom"]} className="flex-1 items-center justify-center gap-4 bg-background p-6">
        <Text className="text-center text-base font-semibold text-foreground">{t("transactionPage.signInToView")}</Text>
        <Button onPress={() => router.push("/auth/login")}>{t("navAuth.signIn")}</Button>
      </SafeAreaView>
    );
  }

  if (error || !transaction) {
    return (
      <SafeAreaView edges={["bottom"]} className="flex-1 items-center justify-center gap-3 bg-background p-6">
        <Text className="text-sm text-destructive">{error ?? t("transactionPage.notFound")}</Text>
        <Button variant="outline" onPress={() => router.push("/my-transactions")}>
          {t("transactionPage.backToTransactions")}
        </Button>
      </SafeAreaView>
    );
  }

  const readiness = readinessText(t, transaction.readiness_label);
  const nbaMessage = nbaText(t, transaction.next_best_action, readiness);
  const perMonth = transaction.transaction_type === "rent" ? t("negotiationDetail.offerBlock.perMonth") : "";
  const terms = transaction.terms_snapshot;
  // Status badge label — mirrors web's transaction.$id.tsx exactly (see
  // docs/testing/mymakan-e2e-test-report.md P9-003, same class as the
  // already-fixed web P7-001): once the transaction reaches
  // ready_for_next_step, the non-negotiable wording rule (docs/
  // implementation/mymakan-transaction-workspace.md) requires showing the
  // real rent/sale readiness string on the most prominent header badge too,
  // never the generic "Ready for Next Step" humanization of the raw status
  // enum — the checklist's own last step below already gets this right.
  const statusLabel =
    transaction.status === "ready_for_next_step"
      ? readinessText(
          t,
          transaction.transaction_type === "sale" ? "Ready for Sale Process" : "Ready for Rental Contract Process",
        )
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
  const isTerminal = transaction.status === "completed" || transaction.status === "cancelled";

  return (
    <SafeAreaView edges={["bottom"]} className="flex-1 bg-background">
      <Stack.Screen options={{ title: transaction.reference }} />
      <ScrollView contentContainerStyle={{ padding: 16, gap: 14 }}>
        {transaction.status === "cancelled" && (
          <View className="gap-1 rounded-2xl border border-destructive/30 bg-destructive/5 p-4">
            <Text className="text-sm text-destructive">
              {t("transactionPage.cancelledBanner")}
              {transaction.cancellation_reason ? ` — ${transaction.cancellation_reason}` : ""}
            </Text>
          </View>
        )}

        {/* Header — property/type/reference/status/agreed amount/mediator + vertical stepper */}
        <View className="gap-3 rounded-2xl border border-border bg-background p-4">
          <View className="flex-row items-center gap-3">
            {transaction.property_image_url && (
              <Image source={{ uri: transaction.property_image_url }} className="size-16 rounded-xl" style={{ resizeMode: "cover" }} />
            )}
            <View className="flex-1">
              <View className="flex-row flex-wrap items-center gap-2">
                <Text className="flex-1 font-semibold text-foreground">{transaction.property_title ?? `#${transaction.property_id}`}</Text>
                <Badge tone="secondary">{t(transaction.transaction_type === "rent" ? "transactionPage.typeRent" : "transactionPage.typeSale")}</Badge>
              </View>
              {transaction.property_area && (
                <View className="mt-0.5 flex-row items-center gap-1">
                  <MapPin size={12} color={colors.mutedForeground} />
                  <Text className="text-xs text-muted-foreground">{transaction.property_area}</Text>
                </View>
              )}
              <Text className="mt-0.5 text-xs text-muted-foreground">{t("transactionPage.reference", { reference: transaction.reference })}</Text>
            </View>
          </View>
          <View className="flex-row items-center justify-between border-t border-border pt-3">
            <View>
              <Text className="text-xs text-muted-foreground">{t("transactionPage.agreedAmount")}</Text>
              <Text className="text-xl font-bold text-foreground">
                SAR {formatSAR(Math.round(Number(transaction.agreed_amount)))}
                {perMonth}
              </Text>
            </View>
            <Badge tone={STATUS_TONE[transaction.status] ?? "neutral"}>{statusLabel}</Badge>
          </View>
          {transaction.mediator_agent_name && (
            <View>
              <Text className="text-xs text-muted-foreground">{t("transactionPage.mediator")}</Text>
              <Text className="text-sm font-semibold text-foreground">{transaction.mediator_agent_name}</Text>
            </View>
          )}
          <View className="border-t border-border pt-3">
            <TransactionStepper steps={steps} progressPercentage={transaction.progress_percentage} progressLabel={t("transactionPage.progress")} />
          </View>
        </View>

        {/* Next Best Action */}
        <View className="gap-2 rounded-2xl p-4" style={{ backgroundColor: "rgba(124,58,237,0.06)", borderWidth: 1, borderColor: "rgba(124,58,237,0.2)" }}>
          <View className="flex-row items-center gap-1.5">
            <Sparkles size={14} color={colors.ai} />
            <Text className="text-xs font-semibold text-foreground">{t("transactionPage.nba.title")}</Text>
          </View>
          <Text className="text-sm leading-5 text-foreground">{nbaMessage}</Text>
        </View>

        {/* Overview — Agreed Commercial Terms (read-only, never a free-form edit path) */}
        <View className="gap-2.5 rounded-2xl border border-border bg-background p-4">
          <Text className="text-xs font-semibold text-muted-foreground">{t("transactionPage.sections.overview")}</Text>
          <DetailRow label={t("transactionPage.overview.property")} value={terms?.property_title ?? transaction.property_title ?? `#${transaction.property_id}`} />
          <DetailRow
            label={t("transactionPage.overview.transactionType")}
            value={t(transaction.transaction_type === "rent" ? "transactionPage.typeRent" : "transactionPage.typeSale")}
          />
          {terms?.original_listing_amount != null && (
            <DetailRow label={t("transactionPage.overview.originalListing")} value={`SAR ${formatSAR(Math.round(Number(terms.original_listing_amount)))}${perMonth}`} />
          )}
          <DetailRow
            label={t("transactionPage.overview.finalAgreed")}
            value={`SAR ${formatSAR(Math.round(Number(terms?.final_agreed_amount ?? transaction.agreed_amount)))}${perMonth}`}
          />
          {terms?.agreed_at && <DetailRow label={t("transactionPage.overview.agreedAt")} value={new Date(terms.agreed_at).toLocaleDateString()} />}
          {terms?.negotiation_reference && <DetailRow label={t("transactionPage.overview.negotiationReference")} value={terms.negotiation_reference} />}
        </View>

        {/* My Information */}
        <MyInformationSection transaction={transaction} onUpdated={setTransaction} isTerminal={isTerminal} />

        {/* Documents */}
        <View className="gap-3">
          <View className="flex-row items-center gap-1.5 px-1">
            <FileText size={14} color={colors.mutedForeground} />
            <Text className="text-xs font-semibold text-muted-foreground">{t("transactionPage.sections.documents")}</Text>
          </View>
          {transaction.documents.map((doc) => (
            <TransactionDocumentCard key={doc.id} transactionId={transaction.id} document={doc} onUpdated={setTransaction} />
          ))}
        </View>

        {/* Activity — client-derived timeline, same timestamps-only approach as web's TransactionActivityTimeline.tsx */}
        <ActivitySection transaction={transaction} />

        {/* Ask myMakan panel */}
        {showAsk && <AskMyMakanPanel transactionId={transaction.id} />}

        {/* Actions */}
        <View className="gap-2.5 rounded-2xl border border-border bg-background p-4">
          <Text className="mb-1 text-xs font-semibold text-muted-foreground">{t("transactionPage.actions.title")}</Text>
          {transaction.lead_id != null && (
            <Link href={`/lead/${transaction.lead_id}`} asChild>
              <Button variant="outline" icon={<MessageCircle size={16} color={colors.foreground} />}>
                {t("transactionPage.actions.messageMediator")}
              </Button>
            </Link>
          )}
          <Link href={`/property/${transaction.property_id}`} asChild>
            <Button variant="outline" icon={<Building2 size={16} color={colors.foreground} />}>
              {t("transactionPage.actions.viewProperty")}
            </Button>
          </Link>
          <Link href={`/negotiations/${transaction.negotiation_id}`} asChild>
            <Button variant="outline" icon={<CheckCircle2 size={16} color={colors.foreground} />}>
              {t("transactionPage.viewNegotiation")}
            </Button>
          </Link>
          <Pressable
            onPress={() => setShowAsk((v) => !v)}
            className="flex-row items-center justify-center gap-2 rounded-xl px-4 py-3"
            style={{ backgroundColor: colors.ai }}
          >
            <Sparkles size={16} color="#FFFFFF" />
            <Text className="text-base font-semibold text-white">{t("transactionPage.actions.askMyMakan")}</Text>
          </Pressable>
          {!isTerminal && (
            <Button variant="outline" icon={<X size={16} color={colors.destructive} />} onPress={() => setShowCancel(true)}>
              {t("transactionPage.actions.cancelTransaction")}
            </Button>
          )}
        </View>
      </ScrollView>

      {showCancel && (
        <CancelSheet
          transaction={transaction}
          onClose={() => setShowCancel(false)}
          onSuccess={(updated) => {
            setTransaction(updated);
            setShowCancel(false);
          }}
        />
      )}
    </SafeAreaView>
  );
}

// My Information — edit + save, plus Information Confirmation ("My
// information is correct" — never "Sign Contract", per the feature's
// non-negotiable wording rule).
function MyInformationSection({
  transaction,
  onUpdated,
  isTerminal,
}: {
  transaction: ApiPropertyTransactionDetail;
  onUpdated: (updated: ApiPropertyTransactionDetail) => void;
  isTerminal: boolean;
}) {
  const { t } = useLanguage();
  const [fullName, setFullName] = useState(transaction.customer_info.full_name ?? "");
  const [phone, setPhone] = useState(transaction.customer_info.phone ?? "");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [confirmError, setConfirmError] = useState<string | null>(null);

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
      setSaveError(err instanceof Error ? err.message : t("transactionPage.myInformation.saveFailed"));
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
      setConfirmError(err instanceof Error ? err.message : t("transactionPage.myInformation.confirmFailed"));
    } finally {
      setConfirming(false);
    }
  }

  return (
    <View className="gap-4 rounded-2xl border border-border bg-background p-4">
      <Text className="text-xs font-semibold text-muted-foreground">{t("transactionPage.sections.myInformation")}</Text>
      <Text className="text-xs text-muted-foreground">{t("transactionPage.myInformation.subtitle")}</Text>

      <View className="gap-3">
        <View>
          <Text className="mb-1 text-sm font-medium text-foreground">{t("transactionPage.myInformation.emailLabel")}</Text>
          <TextInput value={transaction.customer_info.email} editable={false} className="rounded-xl border border-border bg-surface px-3 py-2.5 text-sm text-muted-foreground" />
        </View>
        <View>
          <Text className="mb-1 text-sm font-medium text-foreground">{t("transactionPage.myInformation.fullNameLabel")}</Text>
          <TextInput
            value={fullName}
            onChangeText={setFullName}
            placeholder={t("transactionPage.myInformation.fullNamePlaceholder")}
            placeholderTextColor={colors.mutedForeground}
            editable={!isTerminal}
            className="rounded-xl border border-border bg-background px-3 py-2.5 text-sm text-foreground"
          />
        </View>
        <View>
          <Text className="mb-1 text-sm font-medium text-foreground">{t("transactionPage.myInformation.phoneLabel")}</Text>
          <TextInput
            value={phone}
            onChangeText={setPhone}
            placeholder={t("transactionPage.myInformation.phonePlaceholder")}
            placeholderTextColor={colors.mutedForeground}
            editable={!isTerminal}
            keyboardType="phone-pad"
            className="rounded-xl border border-border bg-background px-3 py-2.5 text-sm text-foreground"
          />
        </View>
      </View>
      {saveError && <Text className="text-xs text-destructive">{saveError}</Text>}
      {saveSuccess && !saveError && <Text className="text-xs text-success">{t("transactionPage.myInformation.saveSuccess")}</Text>}
      <Button size="sm" onPress={() => void handleSave()} loading={saving} disabled={isTerminal}>
        {saving ? t("transactionPage.myInformation.saving") : t("transactionPage.myInformation.save")}
      </Button>

      <View className="gap-2 rounded-xl bg-surface p-3">
        <Text className="text-sm font-semibold text-foreground">{t("transactionPage.myInformation.confirmTitle")}</Text>
        <Text className="text-xs text-muted-foreground">{t("transactionPage.myInformation.confirmDesc")}</Text>
        {confirmError && <Text className="text-xs text-destructive">{confirmError}</Text>}
        {transaction.customer_info_confirmed_at ? (
          <View className="flex-row items-center gap-1.5">
            <CheckCircle2 size={14} color={colors.success} />
            <Text className="text-xs font-medium text-success">
              {t("transactionPage.myInformation.confirmedAt", { datetime: formatDateTime(transaction.customer_info_confirmed_at) })}
            </Text>
          </View>
        ) : (
          <Button size="sm" onPress={() => void handleConfirm()} loading={confirming} disabled={isTerminal}>
            {confirming ? t("transactionPage.myInformation.confirming") : t("transactionPage.myInformation.confirmButton")}
          </Button>
        )}
      </View>
    </View>
  );
}

function ActivitySection({ transaction }: { transaction: ApiPropertyTransactionDetail }) {
  const { t } = useLanguage();
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
  if (transaction.customer_info_confirmed_at) events.push({ at: transaction.customer_info_confirmed_at, label: t("transactionPage.activity.events.informationConfirmed") });
  if (transaction.mediator_info_confirmed_at)
    events.push({ at: transaction.mediator_info_confirmed_at, label: t("transactionPage.activity.events.mediatorInformationConfirmed") });
  if (transaction.ready_at)
    events.push({ at: transaction.ready_at, label: t("transactionPage.activity.events.ready", { state: readinessText(t, transaction.readiness_label) }) });
  if (transaction.completed_at) events.push({ at: transaction.completed_at, label: t("transactionPage.activity.events.completed") });
  if (transaction.cancelled_at)
    events.push({ at: transaction.cancelled_at, label: t("transactionPage.activity.events.cancelled"), detail: transaction.cancellation_reason ?? undefined });
  events.sort((a, b) => Date.parse(a.at) - Date.parse(b.at));

  return (
    <View className="gap-3 rounded-2xl border border-border bg-background p-4">
      <Text className="text-xs font-semibold text-muted-foreground">{t("transactionPage.sections.activity")}</Text>
      {events.length === 0 ? (
        <Text className="text-sm text-muted-foreground">{t("transactionPage.activity.empty")}</Text>
      ) : (
        <View className="gap-3">
          {events.map((e, i) => (
            <View key={i} className="flex-row items-start gap-2.5">
              <View className="mt-1.5 size-2 rounded-full" style={{ backgroundColor: colors.primary }} />
              <View className="flex-1">
                <Text className="text-sm font-medium text-foreground">{e.label}</Text>
                {e.detail && <Text className="text-xs text-muted-foreground">{e.detail}</Text>}
                <Text className="text-xs text-muted-foreground">{formatDateTime(e.at)}</Text>
              </View>
            </View>
          ))}
        </View>
      )}
    </View>
  );
}

// Ask myMakan — customer quick-action vocabulary from Prompt 6
// (whats_next/whats_missing/explain_step/what_to_prepare/summarize/
// what_to_ask_mediator), mirrors negotiations/[id].tsx's own
// AskMyMakanPanel shape (quick chips instead of a free-text box, unlike the
// negotiation panel's question input — this endpoint takes a fixed action
// key, not free text).
function AskMyMakanPanel({ transactionId }: { transactionId: number }) {
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
      const data = await fetchTransactionAssistant(transactionId, action, lang === "ar" ? "ar" : "en");
      setResult(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("transactionPage.askPanel.failed"));
    } finally {
      setLoading(false);
    }
  }

  return (
    <View className="gap-3 rounded-2xl p-4" style={{ backgroundColor: "rgba(124,58,237,0.06)", borderWidth: 1, borderColor: "rgba(124,58,237,0.2)" }}>
      <View className="flex-row items-center gap-1.5">
        <Sparkles size={16} color={colors.ai} />
        <Text className="text-sm font-bold text-foreground">{t("transactionPage.sections.aiAssistant")}</Text>
      </View>
      <Text className="text-xs text-muted-foreground">{t("transactionPage.askPanel.subtitle")}</Text>
      <View className="flex-row flex-wrap gap-2">
        {TRANSACTION_CUSTOMER_QUICK_ACTIONS.map((action) => (
          <Chip key={action} selected={activeAction === action} onPress={() => !loading && void handleQuickAction(action)}>
            {t(`transactionPage.askPanel.quickActions.${action}`)}
          </Chip>
        ))}
      </View>

      {loading && <Text className="text-xs text-muted-foreground">{t("transactionPage.askPanel.asking")}</Text>}
      {error && <Text className="text-xs text-destructive">{error}</Text>}

      {result && (
        <View className="gap-2">
          <Text className="text-sm leading-5 text-foreground">{result.reply}</Text>
          {result.generated_by === "fallback" && <Text className="text-xs text-muted-foreground">{t("transactionPage.askPanel.fallbackNote")}</Text>}
        </View>
      )}
    </View>
  );
}

function CancelSheet({
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
      const finalReason = note.trim() ? `${reason}: ${note.trim()}` : reason;
      const updated = await cancelTransaction(transaction.id, finalReason);
      onSuccess(updated);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("transactionPage.cancelModal.failed"));
      setSubmitting(false);
    }
  }

  return (
    <BottomSheet visible onClose={onClose}>
      <View className="gap-3 p-4">
        <Text className="text-base font-bold text-foreground">{t("transactionPage.cancelModal.title")}</Text>
        <Text className="text-sm font-medium text-foreground">{t("transactionPage.cancelModal.reasonLabel")}</Text>
        <View className="flex-row flex-wrap gap-2">
          {TRANSACTION_CUSTOMER_CANCEL_REASONS.map((r) => (
            <Chip key={r} selected={reason === r} onPress={() => setReason(r)}>
              {t(`transactionPage.cancelModal.reasons.${r}`)}
            </Chip>
          ))}
        </View>
        <View>
          <Text className="mb-1 text-sm font-medium text-foreground">{t("transactionPage.cancelModal.noteLabel")}</Text>
          <TextInput
            value={note}
            onChangeText={setNote}
            multiline
            numberOfLines={3}
            className="rounded-xl border border-border bg-background px-3 py-2.5 text-sm text-foreground"
            style={{ textAlignVertical: "top", minHeight: 80 }}
          />
        </View>
        {error && <Text className="text-sm text-destructive">{error}</Text>}
        <View className="flex-row gap-2.5 pt-1">
          <Button variant="outline" className="flex-1" onPress={onClose} disabled={submitting}>
            {t("transactionPage.cancelModal.cancel")}
          </Button>
          <Button variant="destructive" className="flex-1" onPress={() => void handleConfirm()} loading={submitting}>
            {t("transactionPage.cancelModal.confirm")}
          </Button>
        </View>
      </View>
    </BottomSheet>
  );
}
