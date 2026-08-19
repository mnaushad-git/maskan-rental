import { useEffect, useMemo, useState } from "react";
import { View, Text, FlatList, Pressable, TextInput } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter, Stack } from "expo-router";
import { Search, ChevronRight, MapPin, SearchX } from "lucide-react-native";
import { fetchAreaIntelligenceList, type ApiAreaIntelligenceSummary } from "@/lib/api/maskan";
import { useLanguage } from "@/lib/i18n/context";
import { EmptyState } from "@/components/ui/EmptyState";
import { Skeleton } from "@/components/ui/Skeleton";
import { colors } from "@/lib/colors";
import { scoreColor } from "@/lib/scoreBands";

export default function AreasScreen() {
  const { t } = useLanguage();
  const router = useRouter();
  const [areas, setAreas] = useState<ApiAreaIntelligenceSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");

  useEffect(() => {
    fetchAreaIntelligenceList()
      .then(setAreas)
      .catch(() => setAreas([]))
      .finally(() => setLoading(false));
  }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = q
      ? areas.filter((a) => a.area_name.toLowerCase().includes(q) || a.city.toLowerCase().includes(q))
      : areas;
    return [...list].sort((a, b) => (b.area_score ?? 0) - (a.area_score ?? 0));
  }, [areas, query]);

  if (loading) {
    return (
      <SafeAreaView edges={["bottom"]} className="flex-1 gap-3 bg-background p-4">
        <Stack.Screen options={{ title: t("areas.heading") }} />
        {Array.from({ length: 5 }).map((_, i) => (
          <View key={i} className="gap-2.5 rounded-xl border border-border bg-card p-4">
            <View className="flex-row items-center justify-between">
              <Skeleton width="40%" height={18} />
              <Skeleton width={36} height={24} radius={8} />
            </View>
            <Skeleton width="90%" height={14} />
            <Skeleton width="70%" height={14} />
          </View>
        ))}
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView edges={["bottom"]} className="flex-1 bg-background">
      <Stack.Screen options={{ title: t("areas.heading") }} />
      <FlatList
        data={filtered}
        keyExtractor={(a) => `${a.area_name}-${a.city}`}
        contentContainerClassName="gap-3 p-4"
        ListHeaderComponent={
          <View className="gap-3">
            <Text className="text-sm text-muted-foreground">{t("areas.subtitle")}</Text>
            <View className="flex-row items-center gap-2 rounded-xl border border-border bg-card px-3">
              <Search size={16} color={colors.neutral400} />
              <TextInput
                value={query}
                onChangeText={setQuery}
                placeholder={t("areas.searchPlaceholder")}
                placeholderTextColor={colors.neutral400}
                className="flex-1 py-2.5 text-sm text-foreground"
              />
            </View>
          </View>
        }
        ListHeaderComponentStyle={{ marginBottom: 12 }}
        ListEmptyComponent={
          <EmptyState icon={<SearchX size={28} color={colors.mutedForeground} />} title={t("areas.table.noMatches")} />
        }
        ListFooterComponent={
          <Text className="mt-2 text-center text-xs text-muted-foreground">{t("areas.footerNote")}</Text>
        }
        renderItem={({ item: a }) => (
          <Pressable
            onPress={() => router.push({ pathname: "/areas/[name]", params: { name: a.area_name, city: a.city } })}
            className="gap-2 rounded-xl border border-border bg-card p-4"
          >
            <View className="flex-row items-center justify-between">
              <View className="flex-1 flex-row items-center gap-1.5">
                <MapPin size={14} color={colors.mutedForeground} />
                <Text className="text-base font-semibold text-foreground">{a.area_name}</Text>
              </View>
              <View className="flex-row items-center gap-2">
                <View className="rounded-lg px-2.5 py-1" style={{ backgroundColor: scoreColor(a.area_score) }}>
                  <Text className="text-sm font-bold text-white">{a.area_score != null ? Math.round(a.area_score) : "—"}</Text>
                </View>
                <ChevronRight size={18} color={colors.neutral400} />
              </View>
            </View>
            <Text className="text-xs text-muted-foreground">{a.city}</Text>
            {a.overview && (
              <Text className="text-sm leading-5 text-muted-foreground" numberOfLines={2}>
                {a.overview}
              </Text>
            )}
            <View className="flex-row flex-wrap gap-1.5">
              <ScorePill label={t("areas.detail.familySuitability")} value={a.family_score} />
              <ScorePill label={t("areas.detail.schools")} value={a.school_score} />
              <ScorePill label={t("areas.detail.healthcare")} value={a.healthcare_score} />
            </View>
            {a.tags.length > 0 && (
              <View className="flex-row flex-wrap gap-1.5">
                {a.tags.slice(0, 3).map((tag) => (
                  <View key={tag} className="rounded-full bg-muted px-2 py-0.5">
                    <Text className="text-[11px] text-muted-foreground">{tag}</Text>
                  </View>
                ))}
              </View>
            )}
          </Pressable>
        )}
      />
    </SafeAreaView>
  );
}

function ScorePill({ label, value }: { label: string; value: number | null }) {
  return (
    <View className="flex-row items-center gap-1 rounded-md border border-border px-2 py-0.5">
      <Text className="text-[11px] text-muted-foreground">{label}</Text>
      <Text className="text-[11px] font-semibold" style={{ color: scoreColor(value) }}>
        {value != null ? Math.round(value) : "—"}
      </Text>
    </View>
  );
}
