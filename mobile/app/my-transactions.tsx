import { useEffect, useMemo, useState } from "react";
import { View, Text, ScrollView, Pressable, Image } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { FileCheck2, MapPin } from "lucide-react-native";
import { fetchMyTransactions, type ApiPropertyTransaction } from "@/lib/api/maskan";
import { useAuth } from "@/lib/auth-context";
import { useLanguage } from "@/lib/i18n/context";
import { formatSAR } from "@/lib/maskan-data";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/Badges";
import { EmptyState } from "@/components/ui/EmptyState";
import { PropertyCardSkeleton } from "@/components/ui/Skeleton";
import { colors } from "@/lib/colors";
import { readinessText, nbaText } from "@/lib/transactionWorkspace";

// Transaction Workspace — My Transactions list (Prompt 11's mobile
// counterpart to web's my-transactions.tsx). Same bucketing convention
// (single unfiltered fetch, bucketed client-side by "active" = everything
// not completed/cancelled) and the same tab-pill layout mobile's own
// negotiations/index.tsx already established.
type TabKey = "active" | "completed" | "cancelled";
const TABS: TabKey[] = ["active", "completed", "cancelled"];

function bucketFor(status: string): TabKey {
  if (status === "completed") return "completed";
  if (status === "cancelled") return "cancelled";
  return "active";
}

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
  return new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

export default function MyTransactionsScreen() {
  const { user, authLoading } = useAuth();
  const { t } = useLanguage();
  const router = useRouter();
  const [items, setItems] = useState<ApiPropertyTransaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [tab, setTab] = useState<TabKey>("active");

  function load() {
    setLoading(true);
    setError(false);
    fetchMyTransactions()
      .then(setItems)
      .catch(() => setError(true))
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    if (authLoading || !user) return;
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, authLoading]);

  const filtered = useMemo(() => items.filter((tx) => bucketFor(tx.status) === tab), [items, tab]);
  const tabCounts = useMemo(() => {
    const counts: Record<TabKey, number> = { active: 0, completed: 0, cancelled: 0 };
    for (const tx of items) counts[bucketFor(tx.status)]++;
    return counts;
  }, [items]);

  if (!authLoading && !user) {
    return (
      <SafeAreaView edges={["bottom"]} className="flex-1 items-center justify-center gap-4 bg-background p-6">
        <Text className="text-center text-base font-semibold text-foreground">{t("myTransactions.signInToView")}</Text>
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
              {t(`myTransactions.tabs.${key}`)}
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
            icon={<FileCheck2 size={28} color={colors.mutedForeground} />}
            title={t("myTransactions.loadError")}
            actionLabel={t("myTransactions.retry")}
            onAction={load}
          />
        ) : filtered.length === 0 ? (
          <EmptyState
            icon={<FileCheck2 size={28} color={colors.mutedForeground} />}
            title={t(`myTransactions.empty.${tab}`)}
            actionLabel={t("myTransactions.empty.cta")}
            onAction={() => router.push("/search")}
          />
        ) : (
          filtered.map((tx) => {
            const perMonth = tx.transaction_type === "rent" ? t("negotiationDetail.offerBlock.perMonth") : "";
            const progress = Math.max(0, Math.min(100, tx.progress_percentage));
            // Same wording rule as transaction/[id].tsx (see P9-003 in the
            // test ledger, mirrors web's already-fixed P7-001): the card's
            // own status badge must never show the generic "Ready for Next
            // Step" humanization once a transaction is actually ready.
            const statusLabel =
              tx.status === "ready_for_next_step"
                ? readinessText(t, tx.transaction_type === "sale" ? "Ready for Sale Process" : "Ready for Rental Contract Process")
                : t(`transactionPage.status.${tx.status}`);
            return (
              <Pressable
                key={tx.id}
                onPress={() => router.push(`/transaction/${tx.id}`)}
                className="gap-2.5 rounded-2xl border border-border bg-background p-4"
              >
                {tx.property_image_url && (
                  <Image source={{ uri: tx.property_image_url }} className="h-36 w-full rounded-xl" style={{ resizeMode: "cover" }} />
                )}
                <View className="flex-row items-start justify-between gap-2">
                  <Text className="flex-1 text-sm font-semibold text-foreground">{tx.property_title ?? `#${tx.property_id}`}</Text>
                  <Badge tone={STATUS_TONE[tx.status] ?? "neutral"}>{statusLabel}</Badge>
                </View>
                <View className="flex-row items-center gap-2">
                  <Badge tone="secondary">{t(tx.transaction_type === "rent" ? "transactionPage.typeRent" : "transactionPage.typeSale")}</Badge>
                  {tx.property_area && (
                    <View className="flex-row items-center gap-1">
                      <MapPin size={12} color={colors.mutedForeground} />
                      <Text className="text-xs text-muted-foreground">{tx.property_area}</Text>
                    </View>
                  )}
                </View>
                <Text className="text-xs text-muted-foreground">{t("myTransactions.card.reference", { reference: tx.reference })}</Text>
                <View>
                  <Text className="text-[11px] text-muted-foreground">{t("myTransactions.card.agreedAmount")}</Text>
                  <Text className="text-lg font-bold text-foreground">
                    SAR {formatSAR(Math.round(Number(tx.agreed_amount)))}
                    {perMonth}
                  </Text>
                </View>
                <View>
                  <View className="mb-1 flex-row items-center justify-between">
                    <Text className="text-[11px] text-muted-foreground">{t("transactionPage.progress")}</Text>
                    <Text className="text-[11px] font-semibold text-foreground">{progress}%</Text>
                  </View>
                  <View className="h-1.5 w-full overflow-hidden rounded-full bg-surface-2">
                    <View className="h-full rounded-full bg-primary" style={{ width: `${progress}%` }} />
                  </View>
                </View>
                <Text className="text-xs font-medium text-foreground">{nbaText(t, tx.next_best_action, readinessText(t, tx.readiness_label))}</Text>
                <Text className="text-xs text-muted-foreground">{t("myTransactions.card.lastActivity", { datetime: formatDateTime(tx.updated_at) })}</Text>
                <Button variant="outline" size="sm" onPress={() => router.push(`/transaction/${tx.id}`)}>
                  {t("myTransactions.card.open")}
                </Button>
              </Pressable>
            );
          })
        )}
      </ScrollView>
    </SafeAreaView>
  );
}
