import { useEffect, useMemo, useState } from "react";
import { View, Text, ScrollView, Pressable, Image } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { CalendarClock, MapPin, X } from "lucide-react-native";
import { fetchMyViewings, cancelViewing, VIEWING_CUSTOMER_CANCEL_REASONS, type ApiPropertyViewing } from "@/lib/api/maskan";
import { useAuth } from "@/lib/auth-context";
import { useLanguage } from "@/lib/i18n/context";
import { Button } from "@/components/ui/Button";
import { Chip } from "@/components/ui/Chip";
import { Badge } from "@/components/Badges";
import { EmptyState } from "@/components/ui/EmptyState";
import { PropertyCardSkeleton } from "@/components/ui/Skeleton";
import { BottomSheet } from "@/components/ui/BottomSheet";
import { colors } from "@/lib/colors";

type TabKey = "upcoming" | "pending" | "completed" | "cancelled";
const TABS: TabKey[] = ["upcoming", "pending", "completed", "cancelled"];

const STATUS_TAB: Record<string, TabKey> = {
  requested: "pending",
  reschedule_proposed: "pending",
  confirmed: "upcoming",
  completed: "completed",
  cancelled_by_customer: "cancelled",
  cancelled_by_mediator: "cancelled",
  no_show_customer: "cancelled",
  no_show_mediator: "cancelled",
};

const STATUS_TONE: Record<string, "success" | "warning" | "info" | "neutral"> = {
  requested: "info",
  reschedule_proposed: "warning",
  confirmed: "success",
  completed: "neutral",
  cancelled_by_customer: "neutral",
  cancelled_by_mediator: "neutral",
  no_show_customer: "neutral",
  no_show_mediator: "neutral",
};

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString("en-US", { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

export default function MyViewingsScreen() {
  const { user, authLoading } = useAuth();
  const { t } = useLanguage();
  const router = useRouter();
  const [items, setItems] = useState<ApiPropertyViewing[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<TabKey>("upcoming");
  const [cancelTarget, setCancelTarget] = useState<ApiPropertyViewing | null>(null);

  useEffect(() => {
    if (authLoading || !user) return;
    setLoading(true);
    fetchMyViewings()
      .then(setItems)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [user, authLoading]);

  const filtered = useMemo(() => items.filter((v) => (STATUS_TAB[v.status] ?? "cancelled") === tab), [items, tab]);

  function handleCancelled(updated: ApiPropertyViewing) {
    setItems((prev) => prev.map((v) => (v.id === updated.id ? updated : v)));
    setCancelTarget(null);
  }

  if (!authLoading && !user) {
    return (
      <SafeAreaView edges={["bottom"]} className="flex-1 items-center justify-center gap-4 bg-background p-6">
        <Text className="text-center text-base font-semibold text-foreground">{t("myViewings.signInToView")}</Text>
        <Button onPress={() => router.push("/auth/login")}>{t("navAuth.signIn")}</Button>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView edges={["bottom"]} className="flex-1 bg-background">
      <View className="flex-row flex-wrap gap-2 px-4 pt-3">
        {TABS.map((key) => (
          <Chip key={key} selected={tab === key} onPress={() => setTab(key)}>
            {t(`myViewings.tabs.${key}`)}
          </Chip>
        ))}
      </View>

      <ScrollView contentContainerStyle={{ padding: 16, gap: 12 }}>
        {authLoading || loading ? (
          <>
            <PropertyCardSkeleton />
            <PropertyCardSkeleton />
          </>
        ) : filtered.length === 0 ? (
          <EmptyState
            icon={<CalendarClock size={28} color={colors.mutedForeground} />}
            title={t(`myViewings.empty.${tab}`)}
            actionLabel={t("myViewings.empty.cta")}
            onAction={() => router.push("/search")}
          />
        ) : (
          filtered.map((v) => {
            const canCancel = tab === "pending" || tab === "upcoming";
            const datetimeLine =
              v.status === "confirmed" && v.confirmed_start_at
                ? t("myViewings.card.confirmedFor", { datetime: formatDateTime(v.confirmed_start_at) })
                : v.status === "reschedule_proposed" && v.proposed_start_at
                  ? t("myViewings.card.proposedFor", { datetime: formatDateTime(v.proposed_start_at) })
                  : t("myViewings.card.requestedFor", { datetime: formatDateTime(v.requested_start_at) });
            return (
              <Pressable
                key={v.id}
                onPress={() => router.push(`/viewings/${v.id}`)}
                className="gap-2.5 rounded-2xl border border-border bg-background p-4"
              >
                {v.property_image_url && <Image source={{ uri: v.property_image_url }} className="h-36 w-full rounded-xl" style={{ resizeMode: "cover" }} />}
                <View className="flex-row items-start justify-between gap-2">
                  <Text className="flex-1 text-sm font-semibold text-foreground">{v.property_title ?? `#${v.property_id}`}</Text>
                  <Badge tone={STATUS_TONE[v.status] ?? "neutral"}>{t(`myViewings.status.${v.status}`)}</Badge>
                </View>
                {v.property_area && (
                  <View className="flex-row items-center gap-1">
                    <MapPin size={12} color={colors.mutedForeground} />
                    <Text className="text-xs text-muted-foreground">{v.property_area}, {v.property_city}</Text>
                  </View>
                )}
                <Text className="text-sm font-medium text-foreground">{datetimeLine}</Text>
                <View className="flex-row gap-2 pt-1">
                  <Button variant="outline" size="sm" className="flex-1" onPress={() => router.push(`/viewings/${v.id}`)}>
                    {t("myViewings.card.viewDetails")}
                  </Button>
                  {canCancel && (
                    <Button
                      variant="ghost"
                      size="sm"
                      icon={<X size={14} color={colors.foreground} />}
                      onPress={() => setCancelTarget(v)}
                    >
                      {t("myViewings.card.cancel")}
                    </Button>
                  )}
                </View>
              </Pressable>
            );
          })
        )}
      </ScrollView>

      {cancelTarget && (
        <CancelSheet viewing={cancelTarget} onClose={() => setCancelTarget(null)} onCancelled={handleCancelled} />
      )}
    </SafeAreaView>
  );
}

function CancelSheet({
  viewing,
  onClose,
  onCancelled,
}: {
  viewing: ApiPropertyViewing;
  onClose: () => void;
  onCancelled: (v: ApiPropertyViewing) => void;
}) {
  const { t } = useLanguage();
  const [reason, setReason] = useState<string>(VIEWING_CUSTOMER_CANCEL_REASONS[0]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleConfirm() {
    setSubmitting(true);
    setError(null);
    try {
      const updated = await cancelViewing(viewing.id, reason);
      onCancelled(updated);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("myViewings.cancelModal.failed"));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <BottomSheet visible onClose={onClose}>
      <View className="gap-3 p-4">
        <Text className="text-base font-bold text-foreground">{t("myViewings.cancelModal.title")}</Text>
        <Text className="text-sm font-medium text-foreground">{t("myViewings.cancelModal.reasonLabel")}</Text>
        <View className="flex-row flex-wrap gap-2">
          {VIEWING_CUSTOMER_CANCEL_REASONS.map((r) => (
            <Chip key={r} selected={reason === r} onPress={() => setReason(r)}>
              {t(`myViewings.cancelModal.reasons.${r}`)}
            </Chip>
          ))}
        </View>
        {error && <Text className="text-sm text-destructive">{error}</Text>}
        <View className="flex-row gap-2.5 pt-2">
          <Button variant="outline" className="flex-1" onPress={onClose} disabled={submitting}>
            {t("myViewings.cancelModal.cancel")}
          </Button>
          <Button variant="destructive" className="flex-1" onPress={() => void handleConfirm()} loading={submitting}>
            {t("myViewings.cancelModal.confirm")}
          </Button>
        </View>
      </View>
    </BottomSheet>
  );
}
