import { useEffect, useState } from "react";
import { View, Text, ScrollView, TextInput, Image } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useLocalSearchParams, useRouter, Stack } from "expo-router";
import { CheckCircle2, Sparkles, Wallet, Building2, MessageCircle, TrendingDown, TrendingUp } from "lucide-react-native";
import {
  fetchProperty,
  mapApiProperty,
  fetchPropertyIntelligence,
  fetchPropertyAiSummary,
  createNegotiation,
  type ApiPropertyIntelligence,
  type ApiPropertyNegotiation,
} from "@/lib/api/maskan";
import { formatSAR, type Property } from "@/lib/maskan-data";
import { useLanguage } from "@/lib/i18n/context";
import { Button } from "@/components/ui/Button";
import { Skeleton } from "@/components/ui/Skeleton";
import { colors } from "@/lib/colors";

// AI Negotiation & Offer Management (Prompt 11) — "Make an Offer" flow.
// Mirrors frontend's property.$id.tsx MakeOfferModal step-for-step, but
// built as a standalone screen rather than a modal: mobile's existing
// multi-step flows (app/viewing/new.tsx) are already full screens, not
// modals, so this stays consistent with that convention rather than
// introducing a one-off BottomSheet wizard. Reached either from
// property/[id].tsx's "Make an Offer" CTA (propertyId only) or from a
// completed viewing's "Ask myMakan about negotiation" hook
// (app/viewings/[id].tsx, propertyId + viewingId) — see that file's
// retargeted suggestedActions.askNegotiation button.
type Step = "intelligence" | "amount" | "message" | "review";
const STEPS: Step[] = ["intelligence", "amount", "message", "review"];

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <View>
      <Text className="text-xs text-muted-foreground">{label}</Text>
      <Text className="text-sm font-semibold text-foreground">{value}</Text>
    </View>
  );
}

export default function MakeOfferScreen() {
  const { propertyId, viewingId } = useLocalSearchParams<{ propertyId: string; viewingId?: string }>();
  const { t, lang } = useLanguage();
  const router = useRouter();

  const [property, setProperty] = useState<Property | null>(null);
  const [intelligence, setIntelligence] = useState<ApiPropertyIntelligence | null>(null);
  const [loading, setLoading] = useState(true);
  const [stepIndex, setStepIndex] = useState(0);
  const [amount, setAmount] = useState("");
  const [message, setMessage] = useState("");
  const [drafting, setDrafting] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState<ApiPropertyNegotiation | null>(null);

  useEffect(() => {
    if (!propertyId || Number.isNaN(Number(propertyId))) {
      setLoading(false);
      return;
    }
    const id = Number(propertyId);
    fetchProperty(id)
      .then((raw) => setProperty(mapApiProperty(raw)))
      .catch(() => {})
      .finally(() => setLoading(false));
    fetchPropertyIntelligence(id)
      .then(setIntelligence)
      .catch(() => setIntelligence(null));
  }, [propertyId]);

  const step = STEPS[stepIndex];
  const negotiationInsight = intelligence?.negotiation_intelligence ?? null;
  // Brief §4: never fabricate a market range from insufficient data — show
  // the "make an offer based on your own preference" copy instead.
  const hasSufficientData = intelligence?.price_intelligence?.sufficient_data ?? false;
  // Fallback listing-price hint (negotiation_intelligence unavailable): the
  // backend's original_listing_amount snapshot is Property.monthly_rent for
  // rent listings, NOT the annualized figure property.price holds — same /12
  // conversion the sticky bottom bar's "~SAR X/month" hint already uses, so
  // this stays unit-consistent with what create_negotiation() actually
  // compares the offer against.
  const listingPrice = property
    ? (negotiationInsight?.asking_price ?? (property.listingType === "rent" ? Math.round(property.price / 12) : property.price))
    : 0;
  const amountNumber = Number(amount);
  // Review step's offer-vs-listing comparison (brief §23/§27 money
  // typography) — mirrors web's identical upgrade in property.$id.tsx's
  // MakeOfferModal and app/negotiations/[id].tsx's offerBlock delta line.
  const reviewDiff = amountNumber - listingPrice;
  const reviewDiffPct = listingPrice ? (Math.abs(reviewDiff) / listingPrice) * 100 : 0;
  const reviewIsBelow = reviewDiff < 0;

  async function handleDraft() {
    if (!property) return;
    setDrafting(true);
    try {
      const resp = await fetchPropertyAiSummary(Number(property.id), lang === "ar" ? "ar" : "en", "negotiation_message");
      setMessage(resp.summary);
    } catch {
      // Draft with AI is best-effort — leave the field as-is on failure,
      // never blocks the customer from typing/submitting their own message.
    } finally {
      setDrafting(false);
    }
  }

  async function handleSubmit() {
    if (!property || !amountNumber || amountNumber <= 0) return;
    setSubmitting(true);
    setError(null);
    try {
      const created = await createNegotiation(Number(property.id), {
        amount: amountNumber,
        message: message.trim() || undefined,
        viewing_id: viewingId && !Number.isNaN(Number(viewingId)) ? Number(viewingId) : undefined,
      });
      setSubmitted(created);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("property.negotiation.modal.submitFailed"));
    } finally {
      setSubmitting(false);
    }
  }

  if (loading || !property) {
    return (
      <SafeAreaView edges={["bottom"]} className="flex-1 bg-background p-5">
        <Stack.Screen options={{ title: t("property.negotiation.modal.title") }} />
        <Skeleton height={200} radius={16} />
      </SafeAreaView>
    );
  }

  if (submitted) {
    return (
      <SafeAreaView edges={["bottom"]} className="flex-1 items-center justify-center gap-3 bg-background p-6">
        <Stack.Screen options={{ title: t("property.negotiation.modal.title") }} />
        <CheckCircle2 size={40} color={colors.success} />
        <Text className="text-center text-lg font-bold text-foreground">{t("property.negotiation.modal.submittedTitle")}</Text>
        <Text className="text-center text-sm text-muted-foreground">
          {t("property.negotiation.modal.submittedDesc", { amount: formatSAR(Math.round(Number(submitted.current_offer_amount))) })}
        </Text>
        <Button className="mt-3" onPress={() => router.replace(`/negotiations/${submitted.id}`)}>
          {t("property.negotiation.modal.viewNegotiation")}
        </Button>
        <Button variant="outline" onPress={() => router.replace(`/property/${property.id}`)}>
          {t("property.negotiation.modal.done")}
        </Button>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView edges={["bottom"]} className="flex-1 bg-background">
      <Stack.Screen options={{ title: t("property.negotiation.modal.title") }} />
      <ScrollView contentContainerStyle={{ padding: 20, gap: 16 }}>
        {step === "intelligence" && (
          <View className="gap-3">
            <Text className="text-sm font-semibold text-foreground">{t("property.negotiation.modal.stepIntelligence")}</Text>
            <MiniStat label={t("property.negotiation.modal.listingPrice")} value={`SAR ${formatSAR(Math.round(listingPrice))}`} />
            {negotiationInsight && hasSufficientData ? (
              <>
                <View className="flex-row flex-wrap gap-5">
                  <MiniStat label={t("property.intelligence.negotiation.marketMidpoint")} value={`SAR ${formatSAR(Math.round(negotiationInsight.market_midpoint))}`} />
                  <MiniStat
                    label={t("property.intelligence.negotiation.discussionRange")}
                    value={`SAR ${formatSAR(Math.round(negotiationInsight.discussion_range_low))} – ${formatSAR(Math.round(negotiationInsight.discussion_range_high))}`}
                  />
                </View>
                <Text className="text-xs text-muted-foreground">{negotiationInsight.approach}</Text>
              </>
            ) : (
              <View className="rounded-xl border border-primary/20 bg-primary/5 p-3">
                <Text className="text-xs text-muted-foreground">{t("property.negotiation.modal.limitedData")}</Text>
              </View>
            )}
          </View>
        )}

        {step === "amount" && (
          <View className="gap-2">
            <Text className="text-sm font-semibold text-foreground">{t("property.negotiation.modal.amountLabel")}</Text>
            <TextInput
              value={amount}
              onChangeText={setAmount}
              keyboardType="numeric"
              placeholder={String(Math.round(listingPrice))}
              placeholderTextColor={colors.mutedForeground}
              className="rounded-xl border border-border bg-background px-3 py-3 text-base text-foreground"
            />
            <Text className="text-xs text-muted-foreground">
              {t("property.negotiation.modal.amountHint", { amount: formatSAR(Math.round(listingPrice)) })}
            </Text>
          </View>
        )}

        {step === "message" && (
          <View className="gap-2">
            <View className="flex-row items-center justify-between gap-2">
              <Text className="text-sm font-semibold text-foreground">{t("property.negotiation.modal.messageLabel")}</Text>
              <Button variant="ghost" size="sm" icon={<Sparkles size={14} color={colors.primary} />} onPress={() => void handleDraft()} loading={drafting}>
                {drafting ? t("property.intelligence.negotiation.drafting") : t("property.negotiation.modal.draftWithAI")}
              </Button>
            </View>
            <TextInput
              value={message}
              onChangeText={setMessage}
              multiline
              numberOfLines={4}
              placeholder={t("property.negotiation.modal.messagePlaceholder")}
              placeholderTextColor={colors.mutedForeground}
              className="rounded-xl border border-border bg-background p-3 text-sm text-foreground"
              style={{ textAlignVertical: "top", minHeight: 100 }}
            />
            <Text className="text-xs text-muted-foreground">{t("property.negotiation.modal.messageOptionalHint")}</Text>
          </View>
        )}

        {step === "review" && (
          <View className="gap-3">
            <Text className="text-sm font-semibold text-foreground">{t("property.negotiation.modal.stepReview")}</Text>
            <View className="flex-row items-center gap-3 rounded-xl bg-surface p-3">
              {property.image && <Image source={{ uri: property.image }} className="size-12 rounded-lg" style={{ resizeMode: "cover" }} />}
              <View className="flex-1">
                <Text className="font-semibold text-foreground">{property.title}</Text>
                <Text className="text-xs text-muted-foreground">{property.district}, {property.city}</Text>
              </View>
            </View>
            {/* Offer vs. listing comparison — large money typography + a
                below/above-listing delta line, not just two plain rows
                (brief §23/§27 — Prompt 12 polish pass). */}
            <View className="gap-2.5 rounded-xl bg-surface p-3.5">
              <View className="flex-row gap-6">
                <View>
                  <View className="flex-row items-center gap-1.5">
                    <Wallet size={14} color={colors.mutedForeground} />
                    <Text className="text-xs text-muted-foreground">{t("property.negotiation.modal.reviewOffer")}</Text>
                  </View>
                  <Text className="text-lg font-bold text-foreground">SAR {formatSAR(amountNumber || 0)}</Text>
                </View>
                <View>
                  <View className="flex-row items-center gap-1.5">
                    <Building2 size={14} color={colors.mutedForeground} />
                    <Text className="text-xs text-muted-foreground">{t("property.negotiation.modal.reviewListingPrice")}</Text>
                  </View>
                  <Text className="text-lg font-bold text-muted-foreground">SAR {formatSAR(Math.round(listingPrice))}</Text>
                </View>
              </View>
              {listingPrice > 0 && amountNumber > 0 && (
                <View className="flex-row items-center gap-1.5">
                  {reviewIsBelow ? <TrendingDown size={14} color={colors.success} /> : <TrendingUp size={14} color={colors.warning} />}
                  <Text className={`text-xs font-medium ${reviewIsBelow ? "text-success" : "text-warning"}`}>
                    {t(reviewIsBelow ? "negotiationDetail.offerBlock.belowListing" : "negotiationDetail.offerBlock.aboveListing", {
                      amount: formatSAR(Math.round(Math.abs(reviewDiff))),
                      percent: reviewDiffPct.toFixed(1),
                    })}
                  </Text>
                </View>
              )}
            </View>
            <View className="gap-1 rounded-xl bg-surface p-3">
              <View className="flex-row items-center gap-2">
                <MessageCircle size={16} color={colors.mutedForeground} />
                <Text className="text-sm text-muted-foreground">{t("property.negotiation.modal.reviewMessage")}</Text>
              </View>
              <Text className="text-sm text-foreground">{message.trim() || t("property.negotiation.modal.noMessage")}</Text>
            </View>
          </View>
        )}

        {error && <Text className="text-sm text-destructive">{error}</Text>}

        <View className="mt-2 flex-row gap-3">
          {stepIndex > 0 && (
            <Button variant="outline" className="flex-1" onPress={() => setStepIndex((i) => i - 1)} disabled={submitting}>
              {t("property.negotiation.modal.back")}
            </Button>
          )}
          {step !== "review" ? (
            <Button className="flex-1" onPress={() => setStepIndex((i) => i + 1)} disabled={step === "amount" && (!amountNumber || amountNumber <= 0)}>
              {t("property.negotiation.modal.next")}
            </Button>
          ) : (
            <Button className="flex-1" onPress={() => void handleSubmit()} loading={submitting}>
              {t("property.negotiation.modal.submit")}
            </Button>
          )}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
