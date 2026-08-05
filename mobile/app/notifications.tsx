import { useCallback, useEffect, useMemo, useState } from "react";
import { ActivityIndicator, FlatList, Pressable, RefreshControl, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Stack, useFocusEffect, useRouter } from "expo-router";
import * as Notifications from "expo-notifications";
import { Bell, BellOff, Home, Megaphone, MessageSquare, Sparkles, TrendingDown, TrendingUp, UserRoundCheck } from "lucide-react-native";
import {
  deleteNotification,
  fetchNotificationCenter,
  markAllNotificationsRead,
  markNotificationRead,
  type ApiNotificationRecord,
} from "@/lib/api/maskan";
import { useAuth } from "@/lib/auth-context";
import { useLanguage } from "@/lib/i18n/context";
import { useToast } from "@/components/ui/Toast";
import { Button } from "@/components/ui/Button";
import { Chip } from "@/components/ui/Chip";
import { EmptyState } from "@/components/ui/EmptyState";
import { Skeleton } from "@/components/ui/Skeleton";
import { ErrorState } from "@/components/ErrorState";
import { PushPermissionPrompt, usePushPermissionPrompt } from "@/components/PushPermissionPrompt";
import { deepLinkToRoute } from "@/lib/deepLink";
import { colors } from "@/lib/colors";

type CategoryFilter = "all" | "property" | "leads" | "system";

function categoryOf(type: string): CategoryFilter {
  if (type.startsWith("saved_search_")) return "property";
  if (type.startsWith("lead_")) return "leads";
  return "system";
}

function iconFor(type: string) {
  if (type === "saved_search_price_drop") return TrendingDown;
  if (type === "saved_search_new_listing" || type === "saved_search_back_on_market") return Home;
  if (type === "lead_message") return MessageSquare;
  if (type === "lead_status_update") return UserRoundCheck;
  if (type === "saved_search_digest") return Bell;
  return Megaphone;
}

function groupKey(iso: string, t: (key: string) => string): string {
  const date = new Date(iso);
  const now = new Date();
  const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const diffDays = Math.round((startOfDay(now) - startOfDay(date)) / 86_400_000);
  if (diffDays <= 0) return t("notificationCenter.groupToday");
  if (diffDays === 1) return t("notificationCenter.groupYesterday");
  return t("notificationCenter.groupEarlier");
}

function relativeTime(iso: string, t: (key: string, vars?: Record<string, string | number>) => string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diffMs / 60_000);
  if (mins < 1) return t("notificationCenter.justNow");
  if (mins < 60) return t("notificationCenter.minutesAgo", { count: mins });
  const hours = Math.floor(mins / 60);
  if (hours < 24) return t("notificationCenter.hoursAgo", { count: hours });
  return t("notificationCenter.daysAgo", { count: Math.floor(hours / 24) });
}

function NotificationRow({
  item,
  onOpen,
  onDelete,
}: {
  item: ApiNotificationRecord;
  onOpen: (item: ApiNotificationRecord) => void;
  onDelete: (id: number) => void;
}) {
  const { t } = useLanguage();
  const Icon = iconFor(item.type);
  const unread = !item.read_at;
  const aiInsight = item.meta?.ai_explanation;

  return (
    <Pressable
      onPress={() => onOpen(item)}
      className={`flex-row gap-3 rounded-2xl border p-3.5 ${unread ? "border-primary/30 bg-primary-soft/40" : "border-border bg-background"}`}
    >
      <View className={`size-10 items-center justify-center rounded-full ${unread ? "bg-primary-soft" : "bg-surface-2"}`}>
        <Icon size={18} color={unread ? colors.primary : colors.mutedForeground} />
      </View>
      <View className="flex-1 gap-1">
        <View className="flex-row items-start justify-between gap-2">
          <Text className="flex-1 text-sm font-bold text-foreground">{item.title}</Text>
          {unread && <View className="mt-1.5 size-2 rounded-full bg-primary" />}
        </View>
        <Text className="text-xs leading-4 text-muted-foreground">{item.body}</Text>
        {aiInsight ? (
          <View className="mt-1 flex-row items-start gap-1.5 rounded-lg bg-ai-soft px-2.5 py-1.5">
            <Sparkles size={12} color={colors.ai} />
            <Text className="flex-1 text-[11px] leading-4 text-foreground">
              <Text className="font-semibold" style={{ color: colors.ai }}>
                {t("notificationCenter.aiInsightLabel")}:{" "}
              </Text>
              {aiInsight}
            </Text>
          </View>
        ) : null}
        <View className="flex-row items-center justify-between pt-0.5">
          <Text className="text-[11px] text-muted-foreground">{relativeTime(item.created_at, t)}</Text>
          <Pressable onPress={() => onDelete(item.id)} hitSlop={8} accessibilityLabel={t("notificationCenter.delete")}>
            <Text className="text-[11px] font-semibold text-destructive">{t("notificationCenter.delete")}</Text>
          </Pressable>
        </View>
      </View>
    </Pressable>
  );
}

export default function NotificationsScreen() {
  const { t } = useLanguage();
  const { user, authLoading } = useAuth();
  const router = useRouter();
  const toast = useToast();

  const [items, setItems] = useState<ApiNotificationRecord[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [unreadCount, setUnreadCount] = useState(0);
  const [filter, setFilter] = useState<CategoryFilter>("all");
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(false);
  const pushPrompt = usePushPermissionPrompt();

  const load = useCallback((isRefresh: boolean) => {
    if (isRefresh) setRefreshing(true);
    else setLoading(true);
    setError(false);
    fetchNotificationCenter({ limit: 25 })
      .then((res) => {
        setItems(res.items);
        setCursor(res.next_cursor);
        setUnreadCount(res.unread_count);
        // Opening the Notification Center and having something to read is a
        // good, non-annoying moment to offer push alerts for the user who
        // clearly cares about staying informed but may not have push on yet.
        if (res.items.length > 0) pushPrompt.trigger();
      })
      .catch(() => setError(true))
      .finally(() => {
        setLoading(false);
        setRefreshing(false);
      });
  }, []);

  useFocusEffect(
    useCallback(() => {
      if (user) load(false);
      else setLoading(false);
    }, [user, load]),
  );

  // A push notification arriving while this screen is already open should
  // refresh the list in the background — no need to wait for the next
  // 60s poll or a manual pull-to-refresh (see NotificationBell.tsx for the
  // same listener wired to just the unread badge).
  useEffect(() => {
    if (!user) return;
    const sub = Notifications.addNotificationReceivedListener(() => load(false));
    return () => sub.remove();
  }, [user, load]);

  function loadMore() {
    if (!cursor || loadingMore) return;
    setLoadingMore(true);
    fetchNotificationCenter({ limit: 25, cursor })
      .then((res) => {
        setItems((prev) => [...prev, ...res.items]);
        setCursor(res.next_cursor);
      })
      .catch(() => {})
      .finally(() => setLoadingMore(false));
  }

  async function handleOpen(item: ApiNotificationRecord) {
    if (!item.read_at) {
      setItems((prev) => prev.map((n) => (n.id === item.id ? { ...n, read_at: new Date().toISOString() } : n)));
      setUnreadCount((c) => Math.max(0, c - 1));
      markNotificationRead(item.id).catch(() => {
        // Optimistic update stands even if the network call fails — the
        // next full refresh will reconcile from the server's actual state.
      });
    }
    const route = deepLinkToRoute(item.deep_link);
    if (route) router.push(route as never);
  }

  async function handleDelete(id: number) {
    const removed = items.find((n) => n.id === id);
    setItems((prev) => prev.filter((n) => n.id !== id));
    if (removed && !removed.read_at) setUnreadCount((c) => Math.max(0, c - 1));
    try {
      await deleteNotification(id);
    } catch {
      toast(t("common.loadFailed"), "error");
      load(false);
    }
  }

  async function handleMarkAllRead() {
    const previous = items;
    setItems((prev) => prev.map((n) => ({ ...n, read_at: n.read_at ?? new Date().toISOString() })));
    setUnreadCount(0);
    try {
      await markAllNotificationsRead();
    } catch {
      setItems(previous);
      toast(t("common.loadFailed"), "error");
    }
  }

  const filtered = useMemo(() => (filter === "all" ? items : items.filter((n) => categoryOf(n.type) === filter)), [items, filter]);

  const sections = useMemo(() => {
    const groups = new Map<string, ApiNotificationRecord[]>();
    for (const item of filtered) {
      const key = groupKey(item.created_at, t);
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(item);
    }
    return Array.from(groups.entries());
  }, [filtered, t]);

  if (authLoading) {
    return (
      <SafeAreaView edges={["bottom"]} className="flex-1 items-center justify-center bg-background">
        <Stack.Screen options={{ title: t("notificationCenter.heading") }} />
        <ActivityIndicator color={colors.primary} />
      </SafeAreaView>
    );
  }

  if (!user) {
    return (
      <SafeAreaView edges={["bottom"]} className="flex-1 items-center justify-center gap-4 bg-background p-6">
        <Stack.Screen options={{ title: t("notificationCenter.heading") }} />
        <Text className="text-center text-base font-semibold text-foreground">{t("myLeads.signInToView")}</Text>
        <Button onPress={() => router.push("/auth/login")}>{t("myLeads.signIn")}</Button>
      </SafeAreaView>
    );
  }

  const filterOptions: { key: CategoryFilter; labelKey: string }[] = [
    { key: "all", labelKey: "notificationCenter.filters.all" },
    { key: "property", labelKey: "notificationCenter.filters.propertyAlerts" },
    { key: "leads", labelKey: "notificationCenter.filters.leads" },
    { key: "system", labelKey: "notificationCenter.filters.system" },
  ];

  return (
    <SafeAreaView edges={["bottom"]} className="flex-1 bg-background">
      <Stack.Screen options={{ title: t("notificationCenter.heading") }} />
      <View className="gap-3 p-4 pb-2">
        <View className="flex-row items-center justify-between">
          <ScrollableFilters options={filterOptions} value={filter} onChange={setFilter} t={t} />
          {unreadCount > 0 && (
            <Pressable onPress={handleMarkAllRead} className="ms-2">
              <Text className="text-xs font-semibold text-primary">{t("notificationCenter.markAllRead")}</Text>
            </Pressable>
          )}
        </View>
      </View>

      {loading ? (
        <View className="flex-1 gap-3 p-4 pt-0">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} height={84} radius={16} />
          ))}
        </View>
      ) : error && items.length === 0 ? (
        <ErrorState onRetry={() => load(false)} />
      ) : (
        <FlatList
          data={sections}
          keyExtractor={([key]) => key}
          contentContainerClassName="gap-2 p-4 pt-0"
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => load(true)} tintColor={colors.primary} />}
          onEndReachedThreshold={0.4}
          onEndReached={loadMore}
          renderItem={({ item: [key, rows] }) => (
            <View className="gap-2 pb-2">
              <Text className="pt-2 text-xs font-bold uppercase tracking-wide text-muted-foreground">{key}</Text>
              {rows.map((row) => (
                <NotificationRow key={row.id} item={row} onOpen={handleOpen} onDelete={handleDelete} />
              ))}
            </View>
          )}
          ListFooterComponent={loadingMore ? <ActivityIndicator color={colors.primary} className="py-4" /> : null}
          ListEmptyComponent={
            <EmptyState
              icon={<BellOff size={32} color={colors.mutedForeground} />}
              title={t("notificationCenter.empty.heading")}
              description={t("notificationCenter.empty.desc")}
            />
          }
        />
      )}
      <PushPermissionPrompt visible={pushPrompt.visible} onClose={pushPrompt.close} />
    </SafeAreaView>
  );
}

function ScrollableFilters({
  options,
  value,
  onChange,
  t,
}: {
  options: { key: CategoryFilter; labelKey: string }[];
  value: CategoryFilter;
  onChange: (v: CategoryFilter) => void;
  t: (key: string) => string;
}) {
  return (
    <View className="flex-row flex-1 flex-wrap gap-2">
      {options.map((opt) => (
        <Chip key={opt.key} selected={value === opt.key} onPress={() => onChange(opt.key)}>
          {t(opt.labelKey)}
        </Chip>
      ))}
    </View>
  );
}
