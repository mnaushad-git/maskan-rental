import { useEffect, useState } from "react";
import { View, Text, ScrollView, ActivityIndicator } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useLocalSearchParams, Stack } from "expo-router";
import { GraduationCap, Building2, TrendingUp, FileText } from "lucide-react-native";
import { fetchAreaIntelligence, type ApiAreaIntelligence } from "@/lib/api/maskan";
import { formatSAR } from "@/lib/maskan-data";
import { useLanguage } from "@/lib/i18n/context";
import { colors } from "@/lib/colors";

function scoreColor(score: number | null): string {
  if (score == null) return colors.neutral400;
  if (score >= 85) return colors.success;
  if (score >= 70) return "#65A30D";
  if (score >= 55) return "#B45309";
  return colors.destructive;
}

export default function AreaDetailScreen() {
  const { name, city } = useLocalSearchParams<{ name: string; city?: string }>();
  const { t } = useLanguage();
  const [area, setArea] = useState<ApiAreaIntelligence | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    if (!name) {
      setError(true);
      setLoading(false);
      return;
    }
    fetchAreaIntelligence(name, city)
      .then(setArea)
      .catch(() => setError(true))
      .finally(() => setLoading(false));
  }, [name, city]);

  if (loading) {
    return (
      <SafeAreaView edges={["bottom"]} className="flex-1 items-center justify-center bg-background">
        <Stack.Screen options={{ title: name ?? "" }} />
        <ActivityIndicator color={colors.primary} />
      </SafeAreaView>
    );
  }

  if (error || !area) {
    return (
      <SafeAreaView edges={["bottom"]} className="flex-1 items-center justify-center bg-background p-6">
        <Stack.Screen options={{ title: name ?? "" }} />
        <Text className="text-center text-sm text-muted-foreground">{t("areas.detail.noMarketNotes")}</Text>
      </SafeAreaView>
    );
  }

  const latestRent = area.rent_trend.length > 0 ? area.rent_trend[area.rent_trend.length - 1] : null;

  return (
    <SafeAreaView edges={["bottom"]} className="flex-1 bg-background">
      <Stack.Screen options={{ title: `${area.area_name}, ${area.city}` }} />
      <ScrollView contentContainerClassName="gap-5 p-4">
        {/* Overview */}
        {area.overview && (
          <View className="gap-2 rounded-xl border border-border bg-card p-4">
            <View className="flex-row items-center justify-between">
              <Text className="text-base font-bold text-foreground">{area.area_name}</Text>
              <View className="rounded-lg px-3 py-1" style={{ backgroundColor: scoreColor(area.area_score) }}>
                <Text className="text-sm font-bold text-white">
                  {area.area_score != null ? Math.round(area.area_score) : "—"}
                </Text>
              </View>
            </View>
            <Text className="text-sm leading-5 text-muted-foreground">{area.overview}</Text>
          </View>
        )}

        {/* District scores */}
        <View className="gap-3">
          <Text className="text-sm font-semibold text-foreground">{t("areas.detail.districtScores")}</Text>
          <ScoreBar label={t("areas.detail.areaQuality")} value={area.area_score} />
          <ScoreBar label={t("areas.detail.familySuitability")} value={area.family_score} />
          <ScoreBar label={t("areas.detail.schools")} value={area.school_score} />
          <ScoreBar label={t("areas.detail.healthcare")} value={area.healthcare_score} />
          <ScoreBar label={t("areas.detail.trafficFlow")} value={area.traffic_score} />
        </View>

        {/* Rent trend */}
        {latestRent && (
          <View className="gap-2 rounded-xl border border-border bg-card p-4">
            <View className="flex-row items-center gap-2">
              <TrendingUp size={16} color={colors.success} />
              <Text className="text-sm font-semibold text-foreground">{t("areas.detail.avgAnnualRent")}</Text>
            </View>
            <Text className="text-2xl font-bold text-foreground">SAR {formatSAR(latestRent.avg_rent_annual)}</Text>
            <View className="mt-1 flex-row flex-wrap gap-3">
              {area.rent_trend.map((pt) => (
                <View key={pt.year} className="items-center">
                  <Text className="text-xs font-medium text-foreground">{Math.round(pt.avg_rent_annual / 1000)}k</Text>
                  <Text className="text-[11px] text-muted-foreground">{pt.year}</Text>
                </View>
              ))}
            </View>
          </View>
        )}

        {/* Schools */}
        {area.schools.length > 0 && (
          <View className="gap-2">
            <View className="flex-row items-center gap-2">
              <GraduationCap size={16} color={colors.mutedForeground} />
              <Text className="text-sm font-semibold text-foreground">{t("areas.detail.schools")}</Text>
            </View>
            {area.schools.slice(0, 6).map((s, i) => (
              <View key={i} className="flex-row items-center justify-between rounded-lg border border-border bg-card px-3 py-2.5">
                <View className="flex-1">
                  <Text className="text-sm font-medium text-foreground" numberOfLines={1}>{s.name}</Text>
                  <Text className="text-xs text-muted-foreground">{s.type} · {s.distance_km} km</Text>
                </View>
                <Text className="text-sm font-semibold" style={{ color: scoreColor(s.rating * 20) }}>★ {s.rating.toFixed(1)}</Text>
              </View>
            ))}
          </View>
        )}

        {/* Hospitals */}
        {area.hospitals.length > 0 && (
          <View className="gap-2">
            <View className="flex-row items-center gap-2">
              <Building2 size={16} color={colors.mutedForeground} />
              <Text className="text-sm font-semibold text-foreground">{t("areas.detail.healthcare")}</Text>
            </View>
            {area.hospitals.slice(0, 6).map((h, i) => (
              <View key={i} className="flex-row items-center justify-between rounded-lg border border-border bg-card px-3 py-2.5">
                <View className="flex-1">
                  <Text className="text-sm font-medium text-foreground" numberOfLines={1}>{h.name}</Text>
                  <Text className="text-xs text-muted-foreground">{h.tier} · {h.distance_km} km</Text>
                </View>
                <Text className="text-sm font-semibold" style={{ color: scoreColor(h.rating * 20) }}>★ {h.rating.toFixed(1)}</Text>
              </View>
            ))}
          </View>
        )}

        {/* Market notes */}
        {area.market_notes.length > 0 && (
          <View className="gap-2">
            <View className="flex-row items-center gap-2">
              <FileText size={16} color={colors.mutedForeground} />
              <Text className="text-sm font-semibold text-foreground">{t("areas.detail.marketNote")}</Text>
            </View>
            {area.market_notes.map((note, i) => (
              <View key={i} className="rounded-lg border border-border bg-card p-3">
                <Text className="text-sm leading-5 text-muted-foreground">{note}</Text>
              </View>
            ))}
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function ScoreBar({ label, value }: { label: string; value: number | null }) {
  const pct = value != null ? Math.max(4, Math.min(100, value)) : 0;
  return (
    <View className="gap-1">
      <View className="flex-row items-center justify-between">
        <Text className="text-sm text-muted-foreground">{label}</Text>
        <Text className="text-sm font-semibold" style={{ color: scoreColor(value) }}>
          {value != null ? Math.round(value) : "—"}
        </Text>
      </View>
      <View className="h-2 overflow-hidden rounded-full bg-muted">
        <View className="h-full rounded-full" style={{ width: `${pct}%`, backgroundColor: scoreColor(value) }} />
      </View>
    </View>
  );
}
