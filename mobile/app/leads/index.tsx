import { useCallback, useState } from "react";
import { View, Text, ScrollView, Pressable, RefreshControl } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter, Stack, useFocusEffect } from "expo-router";
import { ChevronRight, FileText, MapPin } from "lucide-react-native";
import { fetchMyLeads, type ApiLeadSummary } from "@/lib/api/maskan";
import { formatSAR } from "@/lib/maskan-data";
import { useAuth } from "@/lib/auth-context";
import { useLanguage } from "@/lib/i18n/context";
import { ErrorState } from "@/components/ErrorState";
import { Button } from "@/components/ui/Button";
import { Skeleton } from "@/components/ui/Skeleton";

const STATUS_COLORS: Record<string, { bg: string; fg: string }> = {
  pending_review: { bg: "#FEF3C7", fg: "#92400E" },
  rejected: { bg: "#FEE2E2", fg: "#991B1B" },
  open: { bg: "#E0F2FE", fg: "#075985" },
  assigned: { bg: "#DCFCE7", fg: "#166534" },
  in_progress: { bg: "#DCFCE7", fg: "#166534" },
  pending_closure: { bg: "#FEF3C7", fg: "#92400E" },
  closed_won: { bg: "#DCFCE7", fg: "#166534" },
  closed_lost: { bg: "#F5EAD9", fg: "#57534E" },
};

export default function MyLeadsScreen() {
  const { t } = useLanguage();
  const { user } = useAuth();
  const router = useRouter();
  const [leads, setLeads] = useState<ApiLeadSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(false);

  const load = useCallback(() => {
    if (!user) {
      setLoading(false);
      return;
    }
    setError(false);
    fetchMyLeads()
      .then(setLeads)
      .catch(() => setError(true))
      .finally(() => {
        setLoading(false);
        setRefreshing(false);
      });
  }, [user]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  if (!user) {
    return (
      <SafeAreaView edges={["bottom"]} className="flex-1 items-center justify-center gap-4 bg-background p-6">
        <Stack.Screen options={{ title: t("nav.myLeads") }} />
        <Text className="text-center text-base text-muted-foreground">{t("myLeads.signInToView")}</Text>
        <Button onPress={() => router.push("/auth/login")}>{t("myLeads.signIn")}</Button>
      </SafeAreaView>
    );
  }

  if (loading) {
    return (
      <SafeAreaView edges={["bottom"]} className="flex-1 gap-3 bg-background p-4">
        <Stack.Screen options={{ title: t("nav.myLeads") }} />
        {Array.from({ length: 4 }).map((_, i) => (
          <View key={i} className="gap-2.5 rounded-xl border border-border bg-card p-4">
            <Skeleton width="60%" height={16} />
            <Skeleton width="40%" height={12} />
            <Skeleton width={90} height={22} radius={11} />
          </View>
        ))}
      </SafeAreaView>
    );
  }

  if (error && leads.length === 0) {
    return (
      <SafeAreaView edges={["bottom"]} className="flex-1 bg-background">
        <Stack.Screen options={{ title: t("nav.myLeads") }} />
        <ErrorState onRetry={load} />
      </SafeAreaView>
    );
  }

  if (leads.length === 0) {
    return (
      <SafeAreaView edges={["bottom"]} className="flex-1 items-center justify-center gap-3 bg-background p-6">
        <Stack.Screen options={{ title: t("nav.myLeads") }} />
        <FileText size={40} color="#A8A29E" />
        <Text className="text-center text-lg font-semibold text-foreground">{t("myLeads.empty.heading")}</Text>
        <Text className="text-center text-sm text-muted-foreground">{t("myLeads.empty.desc")}</Text>
        <Button className="mt-2" onPress={() => router.push("/lead/new")}>
          {t("myLeads.empty.submitFirstLead")}
        </Button>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView edges={["bottom"]} className="flex-1 bg-background">
      <Stack.Screen options={{ title: t("nav.myLeads") }} />
      <ScrollView
        contentContainerClassName="gap-3 p-4"
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => {
              setRefreshing(true);
              load();
            }}
            tintColor="#2563EB"
          />
        }
      >
        {leads.map((lead) => {
          const color = STATUS_COLORS[lead.status] ?? STATUS_COLORS.closed_lost;
          return (
            <Pressable
              key={lead.id}
              onPress={() => router.push(`/lead/${lead.id}`)}
              className="flex-row items-center gap-3 rounded-xl border border-border bg-card p-4"
            >
              <View className="flex-1 gap-1.5">
                <View className="flex-row items-center gap-1">
                  <MapPin size={14} color="#79716B" />
                  <Text className="text-sm font-semibold text-foreground">
                    {lead.area_name}, {lead.city}
                  </Text>
                </View>
                <Text className="text-xs text-muted-foreground">
                  {lead.bedrooms_needed ? t("myLeads.bedroomsPrefix", { count: lead.bedrooms_needed }) : ""}
                  {lead.max_budget
                    ? t("myLeads.budgetUpTo", { amount: formatSAR(lead.max_budget) })
                    : t("myLeads.budgetFlexible")}
                </Text>
                <View className="mt-1 flex-row">
                  <View className="rounded-full px-2.5 py-1" style={{ backgroundColor: color.bg }}>
                    <Text className="text-xs font-medium" style={{ color: color.fg }}>
                      {t(`myLeads.statusBadges.${lead.status}`)}
                    </Text>
                  </View>
                </View>
              </View>
              <ChevronRight size={18} color="#A8A29E" />
            </Pressable>
          );
        })}
      </ScrollView>
    </SafeAreaView>
  );
}
