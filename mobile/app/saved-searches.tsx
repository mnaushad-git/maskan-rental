import { useCallback, useState } from "react";
import { ActivityIndicator, Alert, FlatList, Pressable, RefreshControl, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Stack, useFocusEffect, useRouter } from "expo-router";
import { Bell, BellOff, ChevronRight, Search, Trash2 } from "lucide-react-native";
import {
  deleteSavedSearch,
  disableSavedSearchAlerts,
  enableSavedSearchAlerts,
  fetchSavedSearches,
  previewExistingSavedSearch,
  type ApiSavedSearch,
} from "@/lib/api/maskan";
import { useAuth } from "@/lib/auth-context";
import { useLanguage } from "@/lib/i18n/context";
import { useToast } from "@/components/ui/Toast";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { Skeleton } from "@/components/ui/Skeleton";
import { ErrorState } from "@/components/ErrorState";
import { PushPermissionPrompt, usePushPermissionPrompt } from "@/components/PushPermissionPrompt";
import { formatSAR } from "@/lib/maskan-data";
import { colors } from "@/lib/colors";

function relativeTime(iso: string | null, t: (key: string, vars?: Record<string, string | number>) => string): string {
  if (!iso) return t("savedSearches.card.lastAlertNever");
  const diffMs = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diffMs / 60_000);
  if (mins < 1) return t("notificationCenter.justNow");
  if (mins < 60) return t("notificationCenter.minutesAgo", { count: mins });
  const hours = Math.floor(mins / 60);
  if (hours < 24) return t("notificationCenter.hoursAgo", { count: hours });
  return t("notificationCenter.daysAgo", { count: Math.floor(hours / 24) });
}

function summaryLine(search: ApiSavedSearch, t: (key: string, vars?: Record<string, string | number>) => string): string {
  const f = search.filters;
  const parts: string[] = [];
  if (f.districts?.length) parts.push(f.districts.join(", "));
  else if (f.city) parts.push(f.city);
  if (f.property_type) parts.push(t(`propertyTypes.${f.property_type}`));
  if (f.max_price) parts.push(`≤ ${formatSAR(f.max_price)} SAR`);
  return parts.length ? parts.join(" · ") : t(`listingCategories.${f.transaction_type ?? "rent"}`);
}

function SavedSearchCard({
  search,
  onChange,
  onDelete,
  onEnabledAlerts,
}: {
  search: ApiSavedSearch;
  onChange: (next: ApiSavedSearch) => void;
  onDelete: () => void;
  onEnabledAlerts: () => void;
}) {
  const { t } = useLanguage();
  const router = useRouter();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [previewing, setPreviewing] = useState(false);

  async function toggleAlerts() {
    if (busy) return;
    setBusy(true);
    try {
      const wasEnabled = search.alert_enabled;
      const next = wasEnabled ? await disableSavedSearchAlerts(search.id) : await enableSavedSearchAlerts(search.id);
      onChange(next);
      if (!wasEnabled) onEnabledAlerts();
    } catch {
      toast(t("savedSearches.saveSheet.errorToast"), "error");
    } finally {
      setBusy(false);
    }
  }

  function confirmDelete() {
    Alert.alert(
      t("savedSearches.deleteConfirm.title"),
      t("savedSearches.deleteConfirm.desc", { name: search.name }),
      [
        { text: t("savedSearches.deleteConfirm.cancel"), style: "cancel" },
        {
          text: t("savedSearches.deleteConfirm.confirm"),
          style: "destructive",
          onPress: async () => {
            try {
              await deleteSavedSearch(search.id);
              onDelete();
            } catch {
              toast(t("savedSearches.saveSheet.errorToast"), "error");
            }
          },
        },
      ],
    );
  }

  async function handlePreview() {
    if (previewing) return;
    setPreviewing(true);
    try {
      const res = await previewExistingSavedSearch(search.id);
      toast(
        t(res.estimated_count === 1 ? "savedSearches.saveSheet.estimatedMatchesSingular" : "savedSearches.saveSheet.estimatedMatchesPlural", {
          count: res.estimated_count,
        }),
        "info",
      );
    } catch {
      toast(t("savedSearches.saveSheet.errorToast"), "error");
    } finally {
      setPreviewing(false);
    }
  }

  const frequencyLabelKey: Record<string, string> = {
    instant: "savedSearches.card.frequencyInstant",
    daily: "savedSearches.card.frequencyDaily",
    weekly: "savedSearches.card.frequencyWeekly",
    off: "savedSearches.card.frequencyOff",
  };

  return (
    <View className="gap-3 rounded-2xl border border-border bg-background p-4 shadow-card">
      <View className="flex-row items-start justify-between gap-2">
        <View className="flex-1 gap-1">
          <Text className="text-base font-bold text-foreground">{search.name}</Text>
          <Text className="text-xs text-muted-foreground">{summaryLine(search, t)}</Text>
        </View>
        <Pressable onPress={confirmDelete} hitSlop={8} accessibilityLabel={t("savedSearches.card.delete")}>
          <Trash2 size={17} color={colors.destructive} />
        </Pressable>
      </View>

      <View className="flex-row flex-wrap items-center gap-2">
        <View className={`flex-row items-center gap-1 rounded-full px-2.5 py-1 ${search.alert_enabled ? "bg-success/15" : "bg-surface-2"}`}>
          {search.alert_enabled ? <Bell size={12} color={colors.success} /> : <BellOff size={12} color={colors.mutedForeground} />}
          <Text className={`text-[11px] font-semibold ${search.alert_enabled ? "text-success" : "text-muted-foreground"}`}>
            {t(search.alert_enabled ? "savedSearches.card.alertsOn" : "savedSearches.card.alertsOff")}
          </Text>
        </View>
        <View className="rounded-full bg-primary-soft px-2.5 py-1">
          <Text className="text-[11px] font-semibold text-primary">{t(frequencyLabelKey[search.alert_frequency])}</Text>
        </View>
        <View className="rounded-full bg-surface-2 px-2.5 py-1">
          <Text className="text-[11px] font-medium text-muted-foreground">
            {t(search.latest_matches_count === 1 ? "savedSearches.card.matchesSingular" : "savedSearches.card.matchesPlural", {
              count: search.latest_matches_count,
            })}
          </Text>
        </View>
      </View>

      <Text className="text-[11px] text-muted-foreground">{t("savedSearches.card.lastAlert", { date: relativeTime(search.last_notified_at, t) })}</Text>

      <View className="flex-row flex-wrap gap-2 pt-1">
        <Button size="sm" variant="outline" icon={<Search size={13} color={colors.foreground} />} onPress={() => router.push("/search")}>
          {t("savedSearches.card.runSearch")}
        </Button>
        <Button size="sm" variant="outline" loading={previewing} onPress={handlePreview}>
          {t("savedSearches.card.previewMatches")}
        </Button>
        <Button size="sm" variant="ghost" loading={busy} onPress={toggleAlerts}>
          {t(search.alert_enabled ? "savedSearches.card.disable" : "savedSearches.card.enable")}
        </Button>
      </View>
    </View>
  );
}

export default function SavedSearchesScreen() {
  const { t } = useLanguage();
  const { user, authLoading } = useAuth();
  const router = useRouter();
  const [items, setItems] = useState<ApiSavedSearch[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(false);
  const pushPrompt = usePushPermissionPrompt();

  const load = useCallback(
    (isRefresh: boolean) => {
      if (!user) {
        setLoading(false);
        return;
      }
      if (isRefresh) setRefreshing(true);
      else setLoading(true);
      setError(false);
      fetchSavedSearches()
        .then(setItems)
        .catch(() => setError(true))
        .finally(() => {
          setLoading(false);
          setRefreshing(false);
        });
    },
    [user],
  );

  useFocusEffect(
    useCallback(() => {
      load(false);
    }, [load]),
  );

  if (authLoading || loading) {
    return (
      <SafeAreaView edges={["bottom"]} className="flex-1 gap-4 bg-background p-4">
        <Stack.Screen options={{ title: t("savedSearches.heading") }} />
        {Array.from({ length: 3 }).map((_, i) => (
          <View key={i} className="gap-3 rounded-2xl border border-border p-4">
            <Skeleton width="60%" height={18} />
            <Skeleton width="40%" height={14} />
            <Skeleton width="100%" height={32} radius={16} />
          </View>
        ))}
      </SafeAreaView>
    );
  }

  if (!user) {
    return (
      <SafeAreaView edges={["bottom"]} className="flex-1 items-center justify-center gap-4 bg-background p-6">
        <Stack.Screen options={{ title: t("savedSearches.heading") }} />
        <Text className="text-center text-base font-semibold text-foreground">{t("myLeads.signInToView")}</Text>
        <Button onPress={() => router.push("/auth/login")}>{t("myLeads.signIn")}</Button>
      </SafeAreaView>
    );
  }

  if (error && items.length === 0) {
    return (
      <SafeAreaView edges={["bottom"]} className="flex-1 bg-background">
        <Stack.Screen options={{ title: t("savedSearches.heading") }} />
        <ErrorState onRetry={() => load(false)} />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView edges={["bottom"]} className="flex-1 bg-background">
      <Stack.Screen options={{ title: t("savedSearches.heading") }} />
      <FlatList
        data={items}
        keyExtractor={(s) => String(s.id)}
        contentContainerClassName="gap-4 p-4"
        renderItem={({ item }) => (
          <SavedSearchCard
            search={item}
            onChange={(next) => setItems((prev) => prev.map((s) => (s.id === next.id ? next : s)))}
            onDelete={() => setItems((prev) => prev.filter((s) => s.id !== item.id))}
            onEnabledAlerts={() => pushPrompt.trigger()}
          />
        )}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => load(true)} tintColor={colors.primary} />}
        ListEmptyComponent={
          <EmptyState
            icon={<Bell size={32} color={colors.mutedForeground} />}
            title={t("savedSearches.empty.heading")}
            description={t("savedSearches.empty.desc")}
            actionLabel={t("savedSearches.empty.browseProperties")}
            onAction={() => router.push("/search")}
          />
        }
      />
      <PushPermissionPrompt visible={pushPrompt.visible} onClose={pushPrompt.close} />
    </SafeAreaView>
  );
}
