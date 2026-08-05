import { useCallback, useMemo, useState } from "react";
import { View, Text, FlatList, Pressable, RefreshControl, ActivityIndicator } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Stack, useFocusEffect, useRouter } from "expo-router";
import { ChevronRight, MapPin, Plus, Sparkles } from "lucide-react-native";
import {
  fetchPropertyRequests,
  pausePropertyRequest,
  resumePropertyRequest,
  type ApiPropertyRequestSummary,
  type PropertyRequestStatus,
} from "@/lib/api/maskan";
import { formatSAR } from "@/lib/maskan-data";
import { useAuth } from "@/lib/auth-context";
import { useLanguage } from "@/lib/i18n/context";
import { useFetch } from "@/lib/useFetch";
import { useToast } from "@/components/ui/Toast";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { Skeleton } from "@/components/ui/Skeleton";
import { ErrorState } from "@/components/ErrorState";
import { PropertyRequestStatusBadge } from "@/components/Badges";
import { colors } from "@/lib/colors";

type StatusGroup = "active" | "drafts" | "paused" | "fulfilled" | "closed";

const GROUP_STATUSES: Record<StatusGroup, PropertyRequestStatus[]> = {
  active: ["active", "matched", "negotiating"],
  drafts: ["draft", "awaiting_clarification"],
  paused: ["paused"],
  fulfilled: ["fulfilled"],
  closed: ["closed", "expired", "cancelled"],
};

const GROUPS: StatusGroup[] = ["active", "drafts", "paused", "fulfilled", "closed"];

const KNOWN_CITIES = ["Riyadh", "Jeddah", "Dammam", "Khobar", "Madinah"];

export function cityLabel(city: string | null | undefined, t: (key: string) => string): string {
  if (!city) return "";
  return KNOWN_CITIES.includes(city) ? t(`cities.${city}`) : city;
}

function criteriaLine(
  r: ApiPropertyRequestSummary,
  t: (key: string, vars?: Record<string, string | number>) => string,
): string {
  const parts: string[] = [];
  parts.push(r.transaction_type ? t(`listingCategories.${r.transaction_type}`) : t("propertyRequest.criteriaSummary.anyTransactionType"));
  parts.push(r.city ? cityLabel(r.city, t) : t("propertyRequest.list.anyCity"));
  if (r.bedrooms_min) parts.push(t("propertyRequest.criteriaSummary.bedroomsMin", { count: r.bedrooms_min }));
  if (r.min_price && r.max_price) {
    parts.push(t("propertyRequest.criteriaSummary.budgetRange", { min: formatSAR(r.min_price), max: formatSAR(r.max_price) }));
  } else if (r.max_price) {
    parts.push(t("propertyRequest.criteriaSummary.budgetMax", { max: formatSAR(r.max_price) }));
  } else if (r.min_price) {
    parts.push(t("propertyRequest.criteriaSummary.budgetMin", { min: formatSAR(r.min_price) }));
  }
  return parts.join(" · ");
}

function RequestCard({
  request,
  onChanged,
}: {
  request: ApiPropertyRequestSummary;
  onChanged: (next: ApiPropertyRequestSummary) => void;
}) {
  const { t } = useLanguage();
  const router = useRouter();
  const toast = useToast();
  const [busy, setBusy] = useState(false);

  async function togglePause() {
    if (busy) return;
    setBusy(true);
    try {
      const updated =
        request.status === "paused" ? await resumePropertyRequest(request.id) : await pausePropertyRequest(request.id);
      onChanged({ ...request, status: updated.status });
    } catch {
      toast(t("propertyRequest.detail.actions.failed"), "error");
    } finally {
      setBusy(false);
    }
  }

  const canQuickToggle = request.status === "active" || request.status === "paused";

  return (
    <Pressable
      onPress={() => router.push(`/property-requests/${request.id}`)}
      className="gap-3 rounded-2xl border border-border bg-background p-4 shadow-card"
    >
      <View className="flex-row items-start justify-between gap-2">
        <View className="flex-1 gap-1">
          <Text numberOfLines={1} className="text-base font-bold text-foreground">
            {request.title}
          </Text>
          <View className="flex-row items-center gap-1">
            <MapPin size={12} color={colors.mutedForeground} />
            <Text numberOfLines={1} className="flex-1 text-xs text-muted-foreground">
              {criteriaLine(request, t)}
            </Text>
          </View>
        </View>
        <ChevronRight size={18} color={colors.neutral400} />
      </View>

      <View className="flex-row flex-wrap items-center gap-2">
        <PropertyRequestStatusBadge status={request.status} />
        {request.match_count > 0 && (
          <View className="rounded-full bg-surface-2 px-2.5 py-1">
            <Text className="text-[11px] font-medium text-muted-foreground">
              {t(request.match_count === 1 ? "propertyRequest.list.matchesSingular" : "propertyRequest.list.matchesPlural", {
                count: request.match_count,
              })}
            </Text>
          </View>
        )}
        {request.new_match_count > 0 && (
          <View className="rounded-full bg-ai-soft px-2.5 py-1">
            <Text className="text-[11px] font-semibold text-ai">
              {t(request.new_match_count === 1 ? "propertyRequest.list.newMatchesSingular" : "propertyRequest.list.newMatchesPlural", {
                count: request.new_match_count,
              })}
            </Text>
          </View>
        )}
        {request.mediator_response_count > 0 && (
          <View className="rounded-full bg-primary-soft px-2.5 py-1">
            <Text className="text-[11px] font-medium text-primary">
              {t(
                request.mediator_response_count === 1
                  ? "propertyRequest.list.mediatorResponsesSingular"
                  : "propertyRequest.list.mediatorResponsesPlural",
                { count: request.mediator_response_count },
              )}
            </Text>
          </View>
        )}
      </View>

      <View className="flex-row items-center justify-between border-t border-border pt-3">
        <Text className="text-[11px] text-muted-foreground">
          {request.expiry_date
            ? t("propertyRequest.list.expiresOn", { date: new Date(request.expiry_date).toLocaleDateString() })
            : t("propertyRequest.list.createdOn", { date: new Date(request.created_at).toLocaleDateString() })}
        </Text>
        {canQuickToggle && (
          <Button size="sm" variant="outline" loading={busy} onPress={togglePause}>
            {t(request.status === "paused" ? "propertyRequest.list.resume" : "propertyRequest.list.pause")}
          </Button>
        )}
      </View>
    </Pressable>
  );
}

export default function PropertyRequestsListScreen() {
  const { t } = useLanguage();
  const { user, authLoading } = useAuth();
  const router = useRouter();
  const [group, setGroup] = useState<StatusGroup>("active");
  const [overrides, setOverrides] = useState<Record<number, ApiPropertyRequestSummary>>({});

  const { data, loading, refreshing, error, refresh } = useFetch(
    () => (user ? fetchPropertyRequests({ limit: 100 }).then((r) => r.items) : Promise.resolve<ApiPropertyRequestSummary[]>([])),
    [user],
  );

  useFocusEffect(
    useCallback(() => {
      if (user) refresh();
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [user]),
  );

  const items = useMemo(() => (data ?? []).map((r) => overrides[r.id] ?? r), [data, overrides]);
  const grouped = useMemo(
    () => items.filter((r) => GROUP_STATUSES[group].includes(r.status)),
    [items, group],
  );
  const groupCounts = useMemo(() => {
    const counts: Record<StatusGroup, number> = { active: 0, drafts: 0, paused: 0, fulfilled: 0, closed: 0 };
    for (const r of items) {
      for (const g of GROUPS) {
        if (GROUP_STATUSES[g].includes(r.status)) counts[g] += 1;
      }
    }
    return counts;
  }, [items]);

  if (authLoading) {
    return (
      <SafeAreaView edges={["bottom"]} className="flex-1 items-center justify-center bg-background">
        <ActivityIndicator color={colors.primary} />
      </SafeAreaView>
    );
  }

  if (!user) {
    return (
      <SafeAreaView edges={["bottom"]} className="flex-1 items-center justify-center gap-4 bg-background p-6">
        <Stack.Screen options={{ title: t("propertyRequest.navTitle") }} />
        <Text className="text-center text-base font-semibold text-foreground">{t("myLeads.signInToView")}</Text>
        <Button onPress={() => router.push("/auth/login")}>{t("myLeads.signIn")}</Button>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView edges={["bottom"]} className="flex-1 bg-background">
      <Stack.Screen
        options={{
          title: t("propertyRequest.navTitle"),
          headerRight: () => (
            <Pressable
              onPress={() => router.push("/property-requests/new")}
              accessibilityLabel={t("propertyRequest.list.newRequest")}
              className="flex-row items-center gap-1 pr-1"
            >
              <Plus size={18} color={colors.primary} />
            </Pressable>
          ),
        }}
      />

      <View className="flex-row gap-2 border-b border-border px-4 py-2.5">
        <FlatList
          horizontal
          showsHorizontalScrollIndicator={false}
          data={GROUPS}
          keyExtractor={(g) => g}
          contentContainerClassName="gap-2"
          renderItem={({ item: g }) => (
            <Pressable
              onPress={() => setGroup(g)}
              className={`rounded-full border px-3.5 py-2 ${group === g ? "border-primary bg-primary" : "border-border bg-background"}`}
            >
              <Text className={`text-xs font-semibold ${group === g ? "text-white" : "text-foreground"}`}>
                {t(`propertyRequest.statusGroup.${g}`)} ({groupCounts[g]})
              </Text>
            </Pressable>
          )}
        />
      </View>

      {loading ? (
        <View className="gap-3 p-4">
          {Array.from({ length: 3 }).map((_, i) => (
            <View key={i} className="gap-2.5 rounded-2xl border border-border bg-card p-4">
              <Skeleton width="60%" height={16} />
              <Skeleton width="40%" height={12} />
              <Skeleton width={90} height={22} radius={11} />
            </View>
          ))}
        </View>
      ) : error && items.length === 0 ? (
        <ErrorState onRetry={refresh} />
      ) : items.length === 0 ? (
        <EmptyState
          icon={<Sparkles size={32} color={colors.mutedForeground} />}
          title={t("propertyRequest.list.empty.heading")}
          description={t("propertyRequest.list.empty.desc")}
          actionLabel={t("propertyRequest.list.empty.cta")}
          onAction={() => router.push("/property-requests/new")}
        />
      ) : (
        <FlatList
          data={grouped}
          keyExtractor={(r) => String(r.id)}
          contentContainerClassName="gap-3 p-4"
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={colors.primary} />}
          ListEmptyComponent={
            <View className="items-center py-12">
              <Text className="text-sm text-muted-foreground">{t("propertyRequest.list.emptyGroup")}</Text>
            </View>
          }
          renderItem={({ item }) => (
            <RequestCard request={item} onChanged={(next) => setOverrides((prev) => ({ ...prev, [next.id]: next }))} />
          )}
        />
      )}
    </SafeAreaView>
  );
}
