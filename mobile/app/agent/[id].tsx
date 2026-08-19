import { useEffect, useState } from "react";
import { View, Text, FlatList, ActivityIndicator, Pressable, Linking, Image } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useLocalSearchParams, useRouter, Stack } from "expo-router";
import { BadgeCheck, Phone, MessageCircle, MapPin, Star, Home, ShieldCheck, CheckCircle2, AlertTriangle, Sparkles } from "lucide-react-native";
import {
  fetchPublicPartner,
  fetchMediatorReviews,
  fetchMediatorReviewSummary,
  fetchMediatorAiReviewSummary,
  fetchPropertiesByMediator,
  mapApiProperty,
  type ApiPartnerPublic,
  type ApiReview,
  type ApiReviewSummary,
  type ApiMediatorAiReviewSummary,
  type ApiProperty,
} from "@/lib/api/maskan";
import { formatSAR } from "@/lib/maskan-data";
import { useLanguage } from "@/lib/i18n/context";
import { colors } from "@/lib/colors";
import { whatsappLink as waLink } from "@/lib/whatsapp";
import { Badge } from "@/components/Badges";
import { ListingVerificationBlock } from "@/components/ListingVerificationBlock";

export default function AgentProfileScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t, lang } = useLanguage();
  const router = useRouter();
  const mediatorId = Number(id);

  const [partner, setPartner] = useState<ApiPartnerPublic | null>(null);
  const [summary, setSummary] = useState<ApiReviewSummary | null>(null);
  const [reviews, setReviews] = useState<ApiReview[]>([]);
  const [listings, setListings] = useState<ApiProperty[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  // AI Review Summary (Property Verification & Trust Center, Prompt 10) —
  // its own loading state, fetched independently of the Promise.all above,
  // so a slow/failed AI call never blocks the rest of the profile screen
  // (mirrors PropertyTrustBadge's trust/trust-summary split on Property
  // Detail).
  const [aiReviewSummary, setAiReviewSummary] = useState<ApiMediatorAiReviewSummary | null>(null);
  const [aiReviewSummaryLoading, setAiReviewSummaryLoading] = useState(true);

  useEffect(() => {
    if (Number.isNaN(mediatorId)) {
      setError(true);
      setLoading(false);
      return;
    }
    Promise.all([
      fetchPublicPartner(mediatorId),
      fetchMediatorReviewSummary(mediatorId).catch(() => null),
      fetchMediatorReviews(mediatorId).catch(() => []),
      fetchPropertiesByMediator(mediatorId).catch(() => []),
    ])
      .then(([p, s, r, l]) => {
        setPartner(p);
        setSummary(s);
        setReviews(r.filter((rv) => rv.status === "approved"));
        setListings(l);
      })
      .catch(() => setError(true))
      .finally(() => setLoading(false));
  }, [mediatorId]);

  useEffect(() => {
    if (Number.isNaN(mediatorId)) return;
    let cancelled = false;
    setAiReviewSummaryLoading(true);
    fetchMediatorAiReviewSummary(mediatorId, lang === "ar" ? "ar" : "en")
      .then((data) => {
        if (!cancelled) setAiReviewSummary(data);
      })
      .catch(() => {
        if (!cancelled) setAiReviewSummary(null);
      })
      .finally(() => {
        if (!cancelled) setAiReviewSummaryLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [mediatorId, lang]);

  if (loading) {
    return (
      <SafeAreaView edges={["bottom"]} className="flex-1 items-center justify-center bg-background">
        <Stack.Screen options={{ title: t("agent.loadingProfile") }} />
        <ActivityIndicator color={colors.primary} />
      </SafeAreaView>
    );
  }

  if (error || !partner) {
    return (
      <SafeAreaView edges={["bottom"]} className="flex-1 items-center justify-center gap-2 bg-background p-6">
        <Text className="text-center text-lg font-semibold text-foreground">{t("agent.partnerNotFound")}</Text>
        <Text className="text-center text-sm text-muted-foreground">{t("agent.partnerNotFoundDesc")}</Text>
      </SafeAreaView>
    );
  }

  const name = partner.agency_name ?? t("agent.defaultAgentName");
  const memberSince = new Date(partner.created_at).toLocaleDateString(undefined, { year: "numeric", month: "short" });

  return (
    <SafeAreaView edges={["bottom"]} className="flex-1 bg-background">
      <Stack.Screen options={{ title: name }} />
      <FlatList
        data={listings}
        keyExtractor={(raw) => String(raw.id)}
        contentContainerClassName="gap-4 p-4"
        ListHeaderComponentStyle={{ gap: 16 }}
        ListHeaderComponent={
          <>
            {/* Header */}
            <View className="items-center gap-2 rounded-2xl border border-border bg-card p-5">
              {partner.profile_image_url ? (
                <Image source={{ uri: partner.profile_image_url }} className="size-20 rounded-full" />
              ) : (
                <View className="size-20 items-center justify-center rounded-full bg-primary/10">
                  <Text className="text-2xl font-bold text-primary">{name.charAt(0)}</Text>
                </View>
              )}
              <View className="flex-row items-center gap-1.5">
                <Text className="text-lg font-bold text-foreground">{name}</Text>
                {partner.is_verified && <BadgeCheck size={18} color={colors.success} />}
              </View>
              <Text className="text-xs text-muted-foreground">{t("agent.memberSince", { date: memberSince })}</Text>

              {/* Stats */}
              <View className="mt-2 flex-row justify-around self-stretch border-t border-border pt-3">
                <Stat value={String(listings.length)} label={t("agent.listingsLabel")} />
                <Stat value={String(partner.total_leads_accepted)} label={t("agent.dealsLabel")} />
                <Stat value={String(partner.areas.length)} label={t("agent.areasLabel")} />
              </View>

              {summary && summary.review_count > 0 && (
                <View className="mt-1 flex-row items-center gap-1">
                  <Star size={16} color="#F59E0B" fill="#F59E0B" />
                  <Text className="text-sm font-semibold text-foreground">{summary.avg_rating?.toFixed(1)}</Text>
                  <Text className="text-sm text-muted-foreground">
                    ·{" "}
                    {summary.review_count === 1
                      ? t("agent.reviewCountSingular", { count: summary.review_count })
                      : t("agent.reviewCountPlural", { count: summary.review_count })}
                  </Text>
                </View>
              )}
            </View>

            {/* Trust & Activity (Property Verification & Trust Center,
                Prompt 10) — an additional dedicated card, not a rewrite of
                the pre-existing header hero above (which predates this
                feature and is the page's core identity header). This card
                surfaces Prompt 4's Trust & Activity fields (the exact
                verification phrase, the rent/sale listing split, response
                info, the "what does Verified mean" explainer) as one
                Trust-Center-branded unit. */}
            <View className="gap-3 rounded-2xl border border-border bg-card p-4">
              <View className="flex-row items-center gap-1.5">
                <ShieldCheck size={14} color={colors.primary} />
                <Text className="text-xs font-bold uppercase tracking-wide text-primary">{t("agent.trust.heading")}</Text>
              </View>
              <ListingVerificationBlock
                providers={[
                  {
                    key: "mymakan",
                    name: t("listingVerification.mymakan"),
                    status: partner.verification_label ? "verified" : "not_connected",
                    label: partner.verification_label ?? t("listingVerification.notVerifiedLabel"),
                  },
                ]}
                showExplainer
              />
              <View className="gap-1 border-t border-border pt-3">
                <View className="flex-row items-center gap-1.5">
                  <Star size={13} color="#F59E0B" fill={partner.avg_rating != null ? "#F59E0B" : "none"} />
                  <Text className="text-sm text-foreground">
                    {partner.avg_rating != null
                      ? `${partner.avg_rating.toFixed(1)} · ${
                          partner.review_count === 1
                            ? t("agent.reviewCountSingular", { count: partner.review_count })
                            : t("agent.reviewCountPlural", { count: partner.review_count })
                        }`
                      : t("agent.trust.ratingNone")}
                  </Text>
                </View>
                <Text className="text-xs text-muted-foreground">
                  {t("agent.trust.listingsBreakdown", {
                    rental: partner.rental_listing_count,
                    sale: partner.sale_listing_count,
                  })}
                </Text>
                <Text className="text-xs text-muted-foreground">{t("agent.trust.areasCovered", { count: partner.areas.length })}</Text>
                <Text className="text-xs text-muted-foreground">{t("agent.trust.memberSince", { date: memberSince })}</Text>
                <Text className="text-xs text-muted-foreground">
                  {partner.response_rate != null
                    ? partner.avg_response_time_hours != null
                      ? t("agent.trust.responseRateAndTime", {
                          rate: Math.round(partner.response_rate * 100),
                          hours: Math.round(partner.avg_response_time_hours),
                        })
                      : t("agent.trust.responseRateOnly", { rate: Math.round(partner.response_rate * 100) })
                    : t("agent.trust.noResponseData")}
                </Text>
              </View>
            </View>

            {/* Bio */}
            {partner.bio && <Text className="px-1 text-sm leading-5 text-muted-foreground">{partner.bio}</Text>}

            {/* Contact */}
            <View className="flex-row gap-2">
              <Pressable
                onPress={() => Linking.openURL(`tel:${partner.phone}`)}
                className="flex-1 flex-row items-center justify-center gap-1.5 rounded-xl bg-primary py-3"
              >
                <Phone size={16} color="#FFFFFF" />
                <Text className="text-sm font-semibold text-primary-foreground">{t("agent.contactAgent")}</Text>
              </Pressable>
              <Pressable
                onPress={() => Linking.openURL(waLink(partner.phone))}
                className="flex-1 flex-row items-center justify-center gap-1.5 rounded-xl border py-3"
                style={{ borderColor: colors.whatsapp, backgroundColor: "rgba(37,211,102,0.1)" }}
              >
                <MessageCircle size={16} color={colors.whatsappForeground} />
                <Text className="text-sm font-semibold" style={{ color: colors.whatsappForeground }}>
                  {t("agent.whatsapp")}
                </Text>
              </Pressable>
            </View>

            {/* Service areas */}
            {partner.areas.length > 0 && (
              <View className="gap-2">
                <Text className="text-sm font-semibold text-foreground">{t("agent.serviceAreas")}</Text>
                <View className="flex-row flex-wrap gap-2">
                  {partner.areas.map((a) => (
                    <View key={a.id} className="flex-row items-center gap-1 rounded-full border border-border bg-card px-3 py-1.5">
                      <MapPin size={12} color={colors.mutedForeground} />
                      <Text className="text-xs text-foreground">{a.area_name}</Text>
                    </View>
                  ))}
                </View>
              </View>
            )}

            <Text className="text-sm font-semibold text-foreground">{t("agent.listingsHeading")}</Text>
          </>
        }
        ListEmptyComponent={
          <Text className="text-sm text-muted-foreground">{t("agent.noActiveListings")}</Text>
        }
        renderItem={({ item: raw }) => {
          const p = mapApiProperty(raw);
          return (
            <Pressable
              onPress={() => router.push(`/property/${p.id}`)}
              className="flex-row items-center gap-3 rounded-xl border border-border bg-card p-3"
            >
              {p.image ? (
                <Image source={{ uri: p.image }} className="size-14 rounded-lg" resizeMode="cover" />
              ) : (
                <View className="size-14 items-center justify-center rounded-lg bg-muted">
                  <Home size={18} color={colors.mutedForeground} />
                </View>
              )}
              <View className="flex-1">
                <Text className="text-sm font-medium text-foreground" numberOfLines={1}>
                  {p.title}
                </Text>
                <Text className="text-xs text-muted-foreground">
                  {p.district}, {p.city}
                </Text>
                <Text className="mt-0.5 text-sm font-semibold text-foreground">SAR {formatSAR(p.price)}</Text>
              </View>
            </Pressable>
          );
        }}
        ItemSeparatorComponent={() => <View style={{ height: 8 }} />}
        ListFooterComponentStyle={{ gap: 8, marginTop: 16 }}
        ListFooterComponent={
          <>
            {/* Review Summary (Property Verification & Trust Center,
                Prompt 10) — inserted between the Listings grid and the
                pre-existing Reviews list below. Its own independent async
                fetch/loading state (see aiReviewSummaryLoading above), so a
                slow/failed AI call never blocks the reviews list. */}
            <ReviewSummarySection summary={aiReviewSummary} loading={aiReviewSummaryLoading} />

            {/* Reviews */}
            <Text className="text-sm font-semibold text-foreground">{t("agent.reviews.heading")}</Text>
            {reviews.length === 0 ? (
              <Text className="text-sm text-muted-foreground">{t("agent.noReviewsYet")}</Text>
            ) : (
              reviews.map((r) => (
                <View key={r.id} className="gap-1 rounded-xl border border-border bg-card p-3">
                  <View className="flex-row items-center justify-between">
                    <View className="flex-1 flex-row items-center gap-1.5">
                      <Text className="text-sm font-medium text-foreground">
                        {r.reviewer_name ?? t("agent.reviews.anonymous")}
                      </Text>
                      {r.reviewer_is_verified && (
                        <View className="flex-row items-center gap-0.5 rounded-full bg-success/10 px-1.5 py-0.5">
                          <BadgeCheck size={11} color={colors.success} />
                          <Text className="text-[10px] font-semibold text-success">{t("agent.verified")}</Text>
                        </View>
                      )}
                    </View>
                    <View className="flex-row">
                      {Array.from({ length: 5 }).map((_, i) => (
                        <Star key={i} size={13} color="#F59E0B" fill={i < r.rating ? "#F59E0B" : "none"} />
                      ))}
                    </View>
                  </View>
                  {r.comment && <Text className="text-sm text-muted-foreground">{r.comment}</Text>}
                </View>
              ))
            )}
          </>
        }
      />
    </SafeAreaView>
  );
}

function Stat({ value, label }: { value: string; label: string }) {
  return (
    <View className="items-center">
      <Text className="text-base font-bold text-foreground">{value}</Text>
      <Text className="text-xs text-muted-foreground">{label}</Text>
    </View>
  );
}

// AI-generated Review Summary block (Property Verification & Trust Center
// spec section 12, Prompt 4/10) — mirrors frontend/src/routes/agent.$id.tsx's
// ReviewSummarySection: always shows the deterministic avg_rating/
// review_count header first, then either the AI positive-themes/
// considerations lists (visibly labeled "AI Summary") or the backend's own
// deterministic fallback note when below the minimum review count. Returns
// null while loading is handled by the caller showing a spinner, and null
// when there are zero reviews at all — the header stats card above already
// shows "No reviews yet" in that case, so a second near-empty card here
// would be redundant noise (same judgment call the web reference
// implementation documents for the identical situation).
function ReviewSummarySection({ summary, loading }: { summary: ApiMediatorAiReviewSummary | null; loading: boolean }) {
  const { t } = useLanguage();
  if (loading) {
    return (
      <View className="items-center rounded-2xl border border-border bg-card p-4">
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }
  if (!summary || summary.review_count === 0) return null;

  return (
    <View className="gap-3 rounded-2xl border border-border bg-card p-4">
      <Text className="text-sm font-semibold text-foreground">{t("agent.reviewSummary.heading")}</Text>
      <View className="flex-row items-center gap-1.5">
        <Star size={14} color="#F59E0B" fill="#F59E0B" />
        <Text className="text-sm font-semibold text-foreground">{summary.avg_rating?.toFixed(1)}</Text>
        <Text className="text-sm text-muted-foreground">
          ·{" "}
          {summary.review_count === 1
            ? t("agent.reviewCountSingular", { count: summary.review_count })
            : t("agent.reviewCountPlural", { count: summary.review_count })}
        </Text>
      </View>

      {summary.generated_by === "ai" ? (
        <>
          <Badge tone="ai" icon={<Sparkles size={12} color={colors.ai} />}>
            {t("agent.reviewSummary.aiLabel")}
          </Badge>
          {summary.positive_themes.length > 0 && (
            <View className="gap-1">
              <Text className="text-xs font-semibold uppercase tracking-wide text-success">
                {t("agent.reviewSummary.positiveThemes")}
              </Text>
              {summary.positive_themes.map((th) => (
                <View key={th} className="flex-row items-start gap-1.5">
                  <CheckCircle2 size={13} color={colors.success} />
                  <Text className="flex-1 text-sm text-muted-foreground">{th}</Text>
                </View>
              ))}
            </View>
          )}
          {summary.considerations.length > 0 && (
            <View className="gap-1">
              <Text className="text-xs font-semibold uppercase tracking-wide text-warning">
                {t("agent.reviewSummary.considerations")}
              </Text>
              {summary.considerations.map((c) => (
                <View key={c} className="flex-row items-start gap-1.5">
                  <AlertTriangle size={13} color={colors.warning} />
                  <Text className="flex-1 text-sm text-muted-foreground">{c}</Text>
                </View>
              ))}
            </View>
          )}
        </>
      ) : summary.note ? (
        <Text className="text-xs text-muted-foreground">{summary.note}</Text>
      ) : null}
    </View>
  );
}
