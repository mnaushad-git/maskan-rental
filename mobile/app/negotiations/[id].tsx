import { useEffect, useState } from "react";
import { View, Text, ScrollView, Image, TextInput, Pressable } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useLocalSearchParams, useRouter, Stack, Link } from "expo-router";
import { CheckCircle2, Handshake, MapPin, MessageCircle, Sparkles, TrendingDown, TrendingUp, X, MoveRight, Building2 } from "lucide-react-native";
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
import { useAuth } from "@/lib/auth-context";
import { useLanguage } from "@/lib/i18n/context";
import { formatSAR } from "@/lib/maskan-data";
import { Button } from "@/components/ui/Button";
import { Chip } from "@/components/ui/Chip";
import { Badge } from "@/components/Badges";
import { Skeleton } from "@/components/ui/Skeleton";
import { BottomSheet } from "@/components/ui/BottomSheet";
import { colors } from "@/lib/colors";
import { NEGOTIATION_SIGNAL_TONE, NEGOTIATION_SIGNAL_I18N_KEY, type NegotiationSignalKey } from "@/lib/negotiationSignal";

// AI Negotiation & Offer Management (Prompt 11) — Negotiation Detail.
// Mirrors mobile's own app/viewings/[id].tsx structure and web's
// negotiations.$id.tsx logic (status→tab mapping, canAccept gating, signal
// reading straight off the backend's negotiation_signal field — never
// re-derived client-side). Offer Agreed + Agreement Summary are rendered
// INLINE here rather than as a separate route (see
// docs/implementation/mymakan-negotiations.md "Screens changed" — mobile
// section — for why).

const STATUS_TONE: Record<string, "success" | "warning" | "info" | "neutral"> = {
  submitted: "info",
  countered: "warning",
  accepted: "success",
  rejected: "warning",
  withdrawn: "neutral",
  closed: "neutral",
};

// Tone/i18n-key mapping now lives in @/lib/negotiationSignal (Prompt 12) so
// every surface (web + mobile, customer + partner) shares one mapping.
type SignalKey = NegotiationSignalKey;

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString("en-US", { weekday: "long", month: "long", day: "numeric", hour: "numeric", minute: "2-digit" });
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", { weekday: "long", year: "numeric", month: "long", day: "numeric" });
}

function DetailRow({ label, value, emphasized }: { label: string; value: string; emphasized?: boolean }) {
  return (
    <View className="flex-row items-start justify-between gap-3">
      <Text className="text-sm text-muted-foreground">{label}</Text>
      <Text className={`flex-1 text-end ${emphasized ? "text-base font-bold text-foreground" : "text-sm font-medium text-foreground"}`}>{value}</Text>
    </View>
  );
}

export default function NegotiationDetailScreen() {
  const { id, ask } = useLocalSearchParams<{ id: string; ask?: string }>();
  const { user, authLoading } = useAuth();
  const { t, lang } = useLanguage();
  const router = useRouter();
  const [negotiation, setNegotiation] = useState<ApiPropertyNegotiationDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showCounter, setShowCounter] = useState(false);
  const [showWithdraw, setShowWithdraw] = useState(false);
  // Defaults open when arriving from the My Negotiations list's "Ask
  // myMakan" card action (?ask=1) — mirrors web's negotiations.$id.tsx.
  const [showAsk, setShowAsk] = useState(() => ask === "1");
  const [accepting, setAccepting] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const negotiationId = Number(id);

  async function loadNegotiation() {
    const detail = await fetchNegotiation(negotiationId, lang === "ar" ? "ar" : "en");
    setNegotiation(detail);
    return detail;
  }

  useEffect(() => {
    if (authLoading || !user || !id) return;
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
      <SafeAreaView edges={["bottom"]} className="flex-1 gap-4 bg-background p-5">
        <Skeleton height={140} radius={16} />
        <Skeleton height={200} radius={16} />
      </SafeAreaView>
    );
  }

  if (!user) {
    return (
      <SafeAreaView edges={["bottom"]} className="flex-1 items-center justify-center gap-4 bg-background p-6">
        <Text className="text-center text-base font-semibold text-foreground">{t("negotiationDetail.signInToView")}</Text>
        <Button onPress={() => router.push("/auth/login")}>{t("navAuth.signIn")}</Button>
      </SafeAreaView>
    );
  }

  if (error || !negotiation) {
    return (
      <SafeAreaView edges={["bottom"]} className="flex-1 items-center justify-center gap-3 bg-background p-6">
        <Text className="text-sm text-destructive">{error ?? t("negotiationDetail.notFound")}</Text>
        <Button variant="outline" onPress={() => router.push("/negotiations")}>
          {t("negotiationDetail.back")}
        </Button>
      </SafeAreaView>
    );
  }

  const currentOffer = Number(negotiation.current_offer_amount);
  const listingAmount = Number(negotiation.original_listing_amount);
  const diff = currentOffer - listingAmount;
  const diffPct = listingAmount ? (Math.abs(diff) / listingAmount) * 100 : 0;
  const isBelow = diff < 0;
  const signalKey: SignalKey = (negotiation.negotiation_signal?.signal as SignalKey) ?? "limited_comparable_data";
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

  const events: { at: string; label: string; amount: number }[] = negotiation.offers.map((o) => ({
    at: o.created_at,
    amount: Number(o.amount),
    label: t(`negotiationDetail.timeline.${o.offer_type}`),
  }));
  if (negotiation.status === "accepted" && negotiation.accepted_at) {
    const acceptedOffer = negotiation.offers.find((o) => o.status === "accepted");
    events.push({ at: negotiation.accepted_at, amount: Number(acceptedOffer?.amount ?? negotiation.current_offer_amount), label: t("negotiationDetail.timeline.accepted") });
  }
  if (negotiation.status === "rejected" && negotiation.rejected_at) {
    events.push({ at: negotiation.rejected_at, amount: currentOffer, label: t("negotiationDetail.timeline.rejected") });
  }
  if (negotiation.status === "withdrawn") {
    events.push({ at: negotiation.updated_at, amount: currentOffer, label: t("negotiationDetail.timeline.withdrawn") });
  }
  events.sort((a, b) => Date.parse(a.at) - Date.parse(b.at));

  const summary = negotiation.agreement_summary;

  return (
    <SafeAreaView edges={["bottom"]} className="flex-1 bg-background">
      <Stack.Screen options={{ title: `#${negotiation.id}` }} />
      <ScrollView contentContainerStyle={{ padding: 16, gap: 14 }}>
        {/* Property block */}
        <View className="gap-3 rounded-2xl border border-border bg-background p-4">
          <Text className="text-xs font-semibold text-muted-foreground">{t("negotiationDetail.propertyBlock.title")}</Text>
          <View className="flex-row items-center gap-3">
            {negotiation.property_image_url && <Image source={{ uri: negotiation.property_image_url }} className="size-16 rounded-xl" style={{ resizeMode: "cover" }} />}
            <View className="flex-1">
              <Text className="font-semibold text-foreground">{negotiation.property_title ?? `#${negotiation.property_id}`}</Text>
              {negotiation.property_district && (
                <View className="flex-row items-center gap-1">
                  <MapPin size={12} color={colors.mutedForeground} />
                  <Text className="text-xs text-muted-foreground">{negotiation.property_district}</Text>
                </View>
              )}
              <Text className="mt-0.5 text-xs text-muted-foreground">
                {t("negotiationDetail.propertyBlock.listingPrice")}: SAR {formatSAR(Math.round(listingAmount))}
                {negotiation.transaction_type === "rent" ? t("negotiationDetail.offerBlock.perMonth") : ""}
              </Text>
              <Link href={`/property/${negotiation.property_id}`} className="mt-0.5 text-xs font-medium" style={{ color: colors.primary }}>
                {t("negotiationDetail.propertyBlock.viewProperty")}
              </Link>
            </View>
          </View>
        </View>

        {/* Offer Agreed state — brief §10, rendered once accepted. */}
        {negotiation.status === "accepted" && (
          <View className="gap-2 rounded-2xl border border-success/30 bg-success/5 p-4">
            <View className="flex-row items-center gap-2">
              <CheckCircle2 size={18} color={colors.success} />
              <Text className="text-base font-bold text-foreground">{t("negotiationDetail.agreed.title")}</Text>
            </View>
            <View>
              <Text className="text-xs text-muted-foreground">{t("negotiationDetail.agreed.agreedAmount")}</Text>
              <Text className="text-2xl font-bold text-foreground">
                SAR {formatSAR(Math.round(Number(summary?.final_agreed_amount ?? negotiation.current_offer_amount)))}
                {negotiation.transaction_type === "rent" ? t("negotiationDetail.offerBlock.perMonth") : ""}
              </Text>
            </View>
            {/* Disclaimer — verbatim, per brief §10/§22. Same i18n key used
                by the Agreement Summary section below, so the two can never
                say something different. */}
            <View className="rounded-xl border border-border bg-background/60 px-3 py-2.5">
              <Text className="text-xs text-muted-foreground">{t("negotiationDetail.agreed.disclaimer")}</Text>
            </View>

            {/* Agreement Summary (brief §22) — rendered inline, reading the
                backend's agreement_summary field (populated once accepted). */}
            {summary && (
              <View className="mt-2 gap-2 border-t border-border pt-3">
                <View className="flex-row items-center justify-between">
                  <Text className="text-sm font-semibold text-foreground">{t("negotiationDetail.agreementSummary.heading")}</Text>
                  <Text className="text-xs text-muted-foreground">{t("negotiationDetail.agreementSummary.reference", { reference: summary.negotiation_reference })}</Text>
                </View>
                <DetailRow label={t("negotiationDetail.agreementSummary.fields.property")} value={summary.property_title ?? `#${summary.property_id}`} />
                <DetailRow label={t("negotiationDetail.agreementSummary.fields.customer")} value={summary.customer_name ?? "—"} />
                <DetailRow label={t("negotiationDetail.agreementSummary.fields.mediator")} value={summary.mediator_agent_name ?? "—"} />
                <DetailRow
                  label={t("negotiationDetail.agreementSummary.fields.transactionType")}
                  value={t(summary.transaction_type === "sale" ? "negotiationDetail.agreementSummary.transactionSale" : "negotiationDetail.agreementSummary.transactionRent")}
                />
                <DetailRow label={t("negotiationDetail.agreementSummary.fields.originalListing")} value={`SAR ${formatSAR(Math.round(Number(summary.original_listing_amount)))}`} />
                <DetailRow label={t("negotiationDetail.agreementSummary.fields.finalAgreed")} value={`SAR ${formatSAR(Math.round(Number(summary.final_agreed_amount)))}`} emphasized />
                <DetailRow label={t("negotiationDetail.agreementSummary.fields.agreedAt")} value={summary.agreed_at ? formatDate(summary.agreed_at) : "—"} />
              </View>
            )}
          </View>
        )}

        {/* Offer vs. listing comparison + negotiation strength signal */}
        <View className="gap-3 rounded-2xl border border-border bg-background p-4">
          <View className="flex-row items-center justify-between">
            <Text className="text-xs font-semibold text-muted-foreground">{t("negotiationDetail.offerBlock.title")}</Text>
            <Badge tone={STATUS_TONE[negotiation.status] ?? "neutral"}>{t(`negotiationDetail.status.${negotiation.status}`)}</Badge>
          </View>
          <View className="flex-row gap-6">
            <View>
              <Text className="text-xs text-muted-foreground">{t("negotiationDetail.offerBlock.yourOffer")}</Text>
              <Text className="text-xl font-bold text-foreground">SAR {formatSAR(Math.round(currentOffer))}</Text>
            </View>
            <View>
              <Text className="text-xs text-muted-foreground">{t("negotiationDetail.offerBlock.listingPrice")}</Text>
              <Text className="text-xl font-bold text-muted-foreground">SAR {formatSAR(Math.round(listingAmount))}</Text>
            </View>
          </View>
          {listingAmount > 0 && (
            <View className="flex-row items-center gap-1.5">
              {isBelow ? <TrendingDown size={16} color={colors.success} /> : <TrendingUp size={16} color={colors.warning} />}
              <Text className={`text-sm font-medium ${isBelow ? "text-success" : "text-warning"}`}>
                {t(isBelow ? "negotiationDetail.offerBlock.belowListing" : "negotiationDetail.offerBlock.aboveListing", {
                  amount: formatSAR(Math.round(Math.abs(diff))),
                  percent: diffPct.toFixed(1),
                })}
              </Text>
            </View>
          )}
          <View className="gap-1.5 border-t border-border pt-3">
            <Badge tone={NEGOTIATION_SIGNAL_TONE[signalKey]}>{t(`negotiationDetail.signal.tag.${NEGOTIATION_SIGNAL_I18N_KEY[signalKey]}`)}</Badge>
            <Text className="text-xs text-muted-foreground">{t(`negotiationDetail.signal.label.${NEGOTIATION_SIGNAL_I18N_KEY[signalKey]}`, signalVars)}</Text>
          </View>
          {(negotiation.status === "rejected" || negotiation.status === "withdrawn") && negotiation.cancellation_reason && (
            <View className="rounded-xl bg-surface p-3">
              <Text className="text-xs text-muted-foreground">
                {t(negotiation.status === "rejected" ? "negotiationDetail.rejectedBanner.desc" : "negotiationDetail.withdrawnBanner.desc")} — {negotiation.cancellation_reason}
              </Text>
            </View>
          )}
        </View>

        {/* myMakan Summary — deterministic, always populated */}
        <View className="gap-2 rounded-2xl p-4" style={{ backgroundColor: "rgba(124,58,237,0.06)", borderWidth: 1, borderColor: "rgba(124,58,237,0.2)" }}>
          <View className="flex-row items-center gap-1.5">
            <Sparkles size={14} color={colors.ai} />
            <Text className="text-xs font-semibold text-foreground">{t("negotiationDetail.summary.title")}</Text>
          </View>
          <Text className="text-sm leading-5 text-foreground">{negotiation.summary_text}</Text>
        </View>

        {/* Timeline */}
        <View className="gap-3 rounded-2xl border border-border bg-background p-4">
          <Text className="text-xs font-semibold text-muted-foreground">{t("negotiationDetail.timeline.title")}</Text>
          <View className="gap-3">
            {events.map((e, i) => (
              <View key={i} className="flex-row items-start justify-between gap-2.5">
                <View className="flex-row items-start gap-2.5">
                  <View className="mt-1.5 size-2 rounded-full" style={{ backgroundColor: colors.primary }} />
                  <View>
                    <Text className="text-sm font-medium text-foreground">{e.label}</Text>
                    <Text className="text-xs text-muted-foreground">{formatDateTime(e.at)}</Text>
                  </View>
                </View>
                <Text className="text-sm font-semibold text-foreground">SAR {formatSAR(Math.round(e.amount))}</Text>
              </View>
            ))}
          </View>
        </View>

        {/* Ask myMakan panel */}
        {showAsk && <AskMyMakanPanel negotiationId={negotiation.id} signalKey={signalKey} />}

        {/* Actions */}
        <View className="gap-2.5 rounded-2xl border border-border bg-background p-4">
          <Text className="mb-1 text-xs font-semibold text-muted-foreground">{t("negotiationDetail.actions.title")}</Text>
          {canAccept && (
            <Button icon={<CheckCircle2 size={16} color="#FFFFFF" />} onPress={() => void handleAccept()} loading={accepting}>
              {t("negotiationDetail.actions.accept")}
            </Button>
          )}
          {isActive && (
            <Button variant="outline" icon={<Handshake size={16} color={colors.foreground} />} onPress={() => setShowCounter(true)}>
              {t("negotiationDetail.actions.counterAgain")}
            </Button>
          )}
          {isActive && !canAccept && <Text className="px-1 text-xs text-muted-foreground">{t("negotiationDetail.actions.waitingOnMediator")}</Text>}
          {isActive && (
            <Button variant="outline" icon={<X size={16} color={colors.foreground} />} onPress={() => setShowWithdraw(true)}>
              {t("negotiationDetail.actions.withdraw")}
            </Button>
          )}
          {negotiation.status === "accepted" && (
            <>
              {negotiation.lead_id != null && (
                <Link href={`/lead/${negotiation.lead_id}`} asChild>
                  <Button variant="outline" icon={<MessageCircle size={16} color={colors.foreground} />}>
                    {t("negotiationDetail.agreed.messageMediator")}
                  </Button>
                </Link>
              )}
              <Link href={`/transaction/${negotiation.id}`} asChild>
                <Button variant="outline" icon={<MoveRight size={16} color={colors.foreground} />}>
                  {t("negotiationDetail.agreed.continueTransaction")}
                </Button>
              </Link>
            </>
          )}
          <Pressable
            onPress={() => setShowAsk((v) => !v)}
            className="flex-row items-center justify-center gap-2 rounded-xl px-4 py-3"
            style={{ backgroundColor: colors.ai }}
          >
            <Sparkles size={16} color="#FFFFFF" />
            <Text className="text-base font-semibold text-white">{t("negotiationDetail.actions.askMyMakan")}</Text>
          </Pressable>
          <Link href={`/property/${negotiation.property_id}`} asChild>
            <Button variant="outline" icon={<Building2 size={16} color={colors.foreground} />}>
              {t("negotiationDetail.actions.viewProperty")}
            </Button>
          </Link>
          {actionError && <Text className="text-sm text-destructive">{actionError}</Text>}
        </View>
      </ScrollView>

      {showCounter && (
        <CounterSheet
          negotiation={negotiation}
          onClose={() => setShowCounter(false)}
          onSuccess={async () => {
            await loadNegotiation();
            setShowCounter(false);
          }}
        />
      )}
      {showWithdraw && (
        <WithdrawSheet
          negotiation={negotiation}
          onClose={() => setShowWithdraw(false)}
          onSuccess={async () => {
            await loadNegotiation();
            setShowWithdraw(false);
          }}
        />
      )}
    </SafeAreaView>
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
    <View className="gap-3 rounded-2xl p-4" style={{ backgroundColor: "rgba(124,58,237,0.06)", borderWidth: 1, borderColor: "rgba(124,58,237,0.2)" }}>
      <View className="flex-row items-center gap-1.5">
        <Sparkles size={16} color={colors.ai} />
        <Text className="text-sm font-bold text-foreground">{t("negotiationDetail.askPanel.title")}</Text>
      </View>
      <Text className="text-xs text-muted-foreground">{t("negotiationDetail.askPanel.subtitle")}</Text>
      <TextInput
        value={question}
        onChangeText={setQuestion}
        placeholder={t("negotiationDetail.askPanel.placeholder")}
        placeholderTextColor={colors.mutedForeground}
        className="rounded-xl border border-border bg-background px-3 py-2.5 text-sm text-foreground"
      />
      <Pressable
        onPress={() => !loading && void handleAsk()}
        className="flex-row items-center justify-center gap-2 self-start rounded-full px-4 py-2"
        style={{ backgroundColor: colors.ai }}
      >
        <Sparkles size={14} color="#FFFFFF" />
        <Text className="text-xs font-semibold text-white">{loading ? t("negotiationDetail.askPanel.asking") : t("negotiationDetail.askPanel.ask")}</Text>
      </Pressable>

      {error && <Text className="text-xs text-destructive">{error}</Text>}

      {result && (
        <View className="gap-2">
          <Text className="text-sm leading-5 text-foreground">{result.guidance}</Text>
          {/* Brief §13: never let a low-confidence answer read as a
              mathematically optimal offer. */}
          {signalKey === "limited_comparable_data" && (
            <View className="rounded-xl border border-warning/30 bg-warning/10 px-3 py-2">
              <Text className="text-xs" style={{ color: colors.warning }}>{t("negotiationDetail.askPanel.lowConfidenceNote")}</Text>
            </View>
          )}
          <View className="rounded-xl border border-border bg-background/60 px-3 py-2">
            <Text className="text-xs text-muted-foreground">{t("negotiationDetail.askPanel.disclaimer")}</Text>
          </View>
        </View>
      )}
    </View>
  );
}

function CounterSheet({
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
      const resp = await fetchPropertyAiSummary(negotiation.property_id, lang === "ar" ? "ar" : "en", "negotiation_message", negotiation.id);
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
    <BottomSheet visible onClose={onClose}>
      <View className="gap-3 p-4">
        <Text className="text-base font-bold text-foreground">{t("negotiationDetail.counterModal.title")}</Text>
        <View>
          <Text className="mb-1 text-sm font-medium text-foreground">{t("negotiationDetail.counterModal.amountLabel")}</Text>
          <TextInput
            value={amount}
            onChangeText={setAmount}
            keyboardType="numeric"
            className="rounded-xl border border-border bg-background px-3 py-2.5 text-sm text-foreground"
          />
        </View>
        <View>
          <View className="mb-1 flex-row items-center justify-between gap-2">
            <Text className="text-sm font-medium text-foreground">{t("negotiationDetail.counterModal.messageLabel")}</Text>
            <Button variant="ghost" size="sm" icon={<Sparkles size={14} color={colors.primary} />} onPress={() => void handleDraft()} loading={drafting}>
              {drafting ? t("negotiationDetail.counterModal.drafting") : t("negotiationDetail.counterModal.draftWithAI")}
            </Button>
          </View>
          <TextInput
            value={message}
            onChangeText={setMessage}
            multiline
            numberOfLines={3}
            className="rounded-xl border border-border bg-background px-3 py-2.5 text-sm text-foreground"
            style={{ textAlignVertical: "top", minHeight: 80 }}
          />
        </View>
        {error && <Text className="text-sm text-destructive">{error}</Text>}
        <View className="flex-row gap-2.5 pt-1">
          <Button variant="outline" className="flex-1" onPress={onClose} disabled={submitting}>
            {t("negotiationDetail.counterModal.cancel")}
          </Button>
          <Button className="flex-1" onPress={() => void handleSubmit()} loading={submitting} disabled={!amountNumber || amountNumber <= 0}>
            {t("negotiationDetail.counterModal.submit")}
          </Button>
        </View>
      </View>
    </BottomSheet>
  );
}

function WithdrawSheet({
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
    <BottomSheet visible onClose={onClose}>
      <View className="gap-3 p-4">
        <Text className="text-base font-bold text-foreground">{t("negotiationDetail.withdrawModal.title")}</Text>
        <Text className="text-sm font-medium text-foreground">{t("negotiationDetail.withdrawModal.reasonLabel")}</Text>
        <View className="flex-row flex-wrap gap-2">
          {NEGOTIATION_CUSTOMER_WITHDRAW_REASONS.map((r) => (
            <Chip key={r} selected={reason === r} onPress={() => setReason(r)}>
              {t(`negotiationDetail.withdrawModal.reasons.${r}`)}
            </Chip>
          ))}
        </View>
        <View>
          <Text className="mb-1 text-sm font-medium text-foreground">{t("negotiationDetail.withdrawModal.noteLabel")}</Text>
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
            {t("negotiationDetail.withdrawModal.cancel")}
          </Button>
          <Button variant="destructive" className="flex-1" onPress={() => void handleConfirm()} loading={submitting}>
            {t("negotiationDetail.withdrawModal.confirm")}
          </Button>
        </View>
      </View>
    </BottomSheet>
  );
}
