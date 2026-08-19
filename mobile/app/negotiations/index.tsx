import { useEffect, useMemo, useState } from "react";
import { View, Text, ScrollView, Pressable, Image } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter, Link } from "expo-router";
import { Handshake, MapPin, MessageCircle, Sparkles } from "lucide-react-native";
import { fetchMyNegotiations, type ApiPropertyNegotiation } from "@/lib/api/maskan";
import { useAuth } from "@/lib/auth-context";
import { useLanguage } from "@/lib/i18n/context";
import { formatSAR } from "@/lib/maskan-data";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/Badges";
import { EmptyState } from "@/components/ui/EmptyState";
import { PropertyCardSkeleton } from "@/components/ui/Skeleton";
import { colors } from "@/lib/colors";
import { NEGOTIATION_SIGNAL_TONE, NEGOTIATION_SIGNAL_I18N_KEY } from "@/lib/negotiationSignal";

// AI Negotiation & Offer Management (Prompt 11) — My Negotiations list.
// Mirrors mobile's own app/viewings/index.tsx structure (tabbed list) and
// web's negotiations.tsx STATUS_TAB mapping exactly — see
// docs/implementation/mymakan-negotiations.md "Screens changed" for the
// single source of truth on this bucketing.
type TabKey = "active" | "accepted" | "closed";
const TABS: TabKey[] = ["active", "accepted", "closed"];

const STATUS_TAB: Record<string, TabKey> = {
  submitted: "active",
  countered: "active",
  accepted: "accepted",
  rejected: "closed",
  withdrawn: "closed",
  closed: "closed",
};

// No "destructive" tone on mobile's Badge (see components/Badges.tsx) —
// rejected maps to "warning" too, same decision property/[id].tsx's
// classificationTone comment documents for the price-fairness badge.
const STATUS_TONE: Record<string, "success" | "warning" | "info" | "neutral"> = {
  submitted: "info",
  countered: "warning",
  accepted: "success",
  rejected: "warning",
  withdrawn: "neutral",
  closed: "neutral",
};

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

export default function MyNegotiationsScreen() {
  const { user, authLoading } = useAuth();
  const { t } = useLanguage();
  const router = useRouter();
  const [items, setItems] = useState<ApiPropertyNegotiation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [tab, setTab] = useState<TabKey>("active");

  function load() {
    setLoading(true);
    setError(false);
    fetchMyNegotiations()
      .then(setItems)
      .catch(() => setError(true))
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    if (authLoading || !user) return;
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, authLoading]);

  const filtered = useMemo(() => items.filter((n) => (STATUS_TAB[n.status] ?? "closed") === tab), [items, tab]);
  const tabCounts = useMemo(() => {
    const counts: Record<TabKey, number> = { active: 0, accepted: 0, closed: 0 };
    for (const n of items) counts[STATUS_TAB[n.status] ?? "closed"]++;
    return counts;
  }, [items]);

  if (!authLoading && !user) {
    return (
      <SafeAreaView edges={["bottom"]} className="flex-1 items-center justify-center gap-4 bg-background p-6">
        <Text className="text-center text-base font-semibold text-foreground">{t("myNegotiations.signInToView")}</Text>
        <Button onPress={() => router.push("/auth/login")}>{t("navAuth.signIn")}</Button>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView edges={["bottom"]} className="flex-1 bg-background">
      <View className="flex-row flex-wrap gap-2 px-4 pt-3">
        {TABS.map((key) => (
          <Pressable
            key={key}
            onPress={() => setTab(key)}
            className={`rounded-full border px-4 py-2 ${tab === key ? "border-primary bg-primary" : "border-border bg-background"}`}
          >
            <Text className={`text-sm font-medium ${tab === key ? "text-white" : "text-foreground"}`}>
              {t(`myNegotiations.tabs.${key}`)}
              {tabCounts[key] > 0 ? ` (${tabCounts[key]})` : ""}
            </Text>
          </Pressable>
        ))}
      </View>

      <ScrollView contentContainerStyle={{ padding: 16, gap: 12 }}>
        {authLoading || loading ? (
          <>
            <PropertyCardSkeleton />
            <PropertyCardSkeleton />
          </>
        ) : error ? (
          <EmptyState
            icon={<Handshake size={28} color={colors.mutedForeground} />}
            title={t("myNegotiations.loadError")}
            actionLabel={t("myNegotiations.retry")}
            onAction={load}
          />
        ) : filtered.length === 0 ? (
          <EmptyState
            icon={<Handshake size={28} color={colors.mutedForeground} />}
            title={t(`myNegotiations.empty.${tab}`)}
            actionLabel={t("myNegotiations.empty.cta")}
            onAction={() => router.push("/search")}
          />
        ) : (
          filtered.map((n) => {
            const listingAmount = Number(n.property_listing_amount ?? n.original_listing_amount);
            const currentOffer = Number(n.current_offer_amount);
            const perMonth = n.transaction_type === "rent" ? t("negotiationDetail.offerBlock.perMonth") : "";
            return (
              <Pressable
                key={n.id}
                onPress={() => router.push(`/negotiations/${n.id}`)}
                className="gap-2.5 rounded-2xl border border-border bg-background p-4"
              >
                {n.property_image_url && <Image source={{ uri: n.property_image_url }} className="h-36 w-full rounded-xl" style={{ resizeMode: "cover" }} />}
                <View className="flex-row items-start justify-between gap-2">
                  <Text className="flex-1 text-sm font-semibold text-foreground">{n.property_title ?? `#${n.property_id}`}</Text>
                  <Badge tone={STATUS_TONE[n.status] ?? "neutral"}>{t(`negotiationDetail.status.${n.status}`)}</Badge>
                </View>
                {n.property_district && (
                  <View className="flex-row items-center gap-1">
                    <MapPin size={12} color={colors.mutedForeground} />
                    <Text className="text-xs text-muted-foreground">{n.property_district}</Text>
                  </View>
                )}
                {/* Negotiation strength signal (brief §14) — same
                    badge/coloring the detail screen renders
                    (@/lib/negotiationSignal), read straight off the backend
                    field, never re-derived. */}
                {n.negotiation_signal && (
                  <Badge tone={NEGOTIATION_SIGNAL_TONE[n.negotiation_signal.signal]} className="self-start">
                    {t(`negotiationDetail.signal.tag.${NEGOTIATION_SIGNAL_I18N_KEY[n.negotiation_signal.signal]}`)}
                  </Badge>
                )}
                <View className="flex-row gap-6">
                  <View>
                    <Text className="text-[11px] text-muted-foreground">{t("myNegotiations.card.listingAmount")}</Text>
                    <Text className="text-sm font-semibold text-muted-foreground">
                      SAR {formatSAR(Math.round(listingAmount))}{perMonth}
                    </Text>
                  </View>
                  <View>
                    <Text className="text-[11px] text-muted-foreground">{t("myNegotiations.card.currentOffer")}</Text>
                    <Text className="text-sm font-bold text-foreground">
                      SAR {formatSAR(Math.round(currentOffer))}{perMonth}
                    </Text>
                  </View>
                </View>
                <Text className="text-xs text-muted-foreground">{t("myNegotiations.card.lastActivity", { datetime: formatDateTime(n.updated_at) })}</Text>
                {n.mediator_agent_name && <Text className="text-xs text-muted-foreground">{n.mediator_agent_name}</Text>}
                <View className="flex-row flex-wrap gap-2 pt-1">
                  <Button variant="outline" size="sm" className="flex-1" onPress={() => router.push(`/negotiations/${n.id}`)}>
                    {t("myNegotiations.card.open")}
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    icon={<Sparkles size={14} color={colors.ai} />}
                    onPress={() => router.push({ pathname: "/negotiations/[id]", params: { id: String(n.id), ask: "1" } })}
                  >
                    {t("myNegotiations.card.askMyMakan")}
                  </Button>
                  {n.lead_id != null && (
                    <Link href={`/lead/${n.lead_id}`} asChild>
                      <Button variant="ghost" size="sm" icon={<MessageCircle size={14} color={colors.foreground} />}>
                        {t("myNegotiations.card.messageMediator")}
                      </Button>
                    </Link>
                  )}
                </View>
              </Pressable>
            );
          })
        )}
      </ScrollView>
    </SafeAreaView>
  );
}
