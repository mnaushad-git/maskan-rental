import { useEffect, useState } from "react";
import { View, Text, ScrollView, ActivityIndicator, Pressable, Linking } from "react-native";
import { Image } from "expo-image";
import { SafeAreaView } from "react-native-safe-area-context";
import { useLocalSearchParams, useRouter, Stack } from "expo-router";
import { BadgeCheck, Phone, MessageCircle, MapPin, Star, Home } from "lucide-react-native";
import {
  fetchPublicPartner,
  fetchMediatorReviews,
  fetchMediatorReviewSummary,
  fetchPropertiesByMediator,
  mapApiProperty,
  type ApiPartnerPublic,
  type ApiReview,
  type ApiReviewSummary,
  type ApiProperty,
} from "@/lib/api/maskan";
import { formatSAR } from "@/lib/maskan-data";
import { useLanguage } from "@/lib/i18n/context";

function waLink(phone: string) {
  return `https://wa.me/${phone.replace(/\D/g, "").replace(/^0/, "966")}`;
}

export default function AgentProfileScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t } = useLanguage();
  const router = useRouter();
  const mediatorId = Number(id);

  const [partner, setPartner] = useState<ApiPartnerPublic | null>(null);
  const [summary, setSummary] = useState<ApiReviewSummary | null>(null);
  const [reviews, setReviews] = useState<ApiReview[]>([]);
  const [listings, setListings] = useState<ApiProperty[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

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

  if (loading) {
    return (
      <SafeAreaView edges={["bottom"]} className="flex-1 items-center justify-center bg-background">
        <Stack.Screen options={{ title: t("agent.loadingProfile") }} />
        <ActivityIndicator color="#2563EB" />
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
      <ScrollView contentContainerClassName="gap-4 p-4">
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
            {partner.is_verified && <BadgeCheck size={18} color="#15803D" />}
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
            style={{ borderColor: "#25D366", backgroundColor: "rgba(37,211,102,0.1)" }}
          >
            <MessageCircle size={16} color="#128C7E" />
            <Text className="text-sm font-semibold" style={{ color: "#128C7E" }}>
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
                  <MapPin size={12} color="#79716B" />
                  <Text className="text-xs text-foreground">{a.area_name}</Text>
                </View>
              ))}
            </View>
          </View>
        )}

        {/* Listings */}
        <View className="gap-2">
          <Text className="text-sm font-semibold text-foreground">{t("agent.listingsHeading")}</Text>
          {listings.length === 0 ? (
            <Text className="text-sm text-muted-foreground">{t("agent.noActiveListings")}</Text>
          ) : (
            listings.map((raw) => {
              const p = mapApiProperty(raw);
              return (
                <Pressable
                  key={p.id}
                  onPress={() => router.push(`/property/${p.id}`)}
                  className="flex-row items-center gap-3 rounded-xl border border-border bg-card p-3"
                >
                  {p.image ? (
                    <Image source={{ uri: p.image }} className="size-14 rounded-lg" contentFit="cover" />
                  ) : (
                    <View className="size-14 items-center justify-center rounded-lg bg-muted">
                      <Home size={18} color="#79716B" />
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
            })
          )}
        </View>

        {/* Reviews */}
        <View className="gap-2">
          <Text className="text-sm font-semibold text-foreground">{t("agent.reviews.heading")}</Text>
          {reviews.length === 0 ? (
            <Text className="text-sm text-muted-foreground">{t("agent.noReviewsYet")}</Text>
          ) : (
            reviews.map((r) => (
              <View key={r.id} className="gap-1 rounded-xl border border-border bg-card p-3">
                <View className="flex-row items-center justify-between">
                  <Text className="text-sm font-medium text-foreground">
                    {r.reviewer_name ?? t("agent.reviews.anonymous")}
                  </Text>
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
        </View>
      </ScrollView>
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
