import { useEffect, useState } from "react";
import { View, Text, Pressable } from "react-native";
import { useRouter } from "expo-router";
import { ChevronRight, School, Cross, Landmark, Trees, ShoppingBag } from "lucide-react-native";
import { fetchAreaIntelligence, type ApiAreaIntelligence } from "@/lib/api/maskan";
import { useLanguage } from "@/lib/i18n/context";
import { ScoreBar } from "./ScoreIndicator";
import { Skeleton } from "./ui/Skeleton";
import { colors } from "@/lib/colors";

/** Compact area-score + nearby-places summary for the property-detail screen
 * — a condensed version of the web app's AreaSummary + NearbyPlaces
 * sections, using the same /areas/{name}/intelligence endpoint. */
export function PropertyAreaInsights({ district, city }: { district: string; city: string }) {
  const { t } = useLanguage();
  const router = useRouter();
  const [data, setData] = useState<ApiAreaIntelligence | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setData(null);
    setFailed(false);
    fetchAreaIntelligence(district, city)
      .then((res) => !cancelled && setData(res))
      .catch(() => !cancelled && setFailed(true));
    return () => {
      cancelled = true;
    };
  }, [district, city]);

  if (failed) return null;

  if (!data) {
    return (
      <View className="gap-3 rounded-2xl border border-border bg-card p-4">
        <Skeleton width="50%" height={16} />
        <Skeleton height={8} />
        <Skeleton height={8} />
        <Skeleton height={8} />
      </View>
    );
  }

  const places = [
    { icon: School, count: data.schools.length, label: t("property.nearby.schools") },
    { icon: Cross, count: data.hospitals.length, label: t("property.nearby.hospitals") },
    { icon: Landmark, count: data.lifestyle.mosques?.count ?? 0, label: t("property.nearby.mosques") },
    { icon: ShoppingBag, count: data.lifestyle.malls?.count ?? 0, label: t("property.nearby.malls") },
    { icon: Trees, count: data.lifestyle.parks?.count ?? 0, label: t("property.nearby.parks") },
  ].filter((p) => p.count > 0);

  return (
    <View className="gap-4 rounded-2xl border border-border bg-card p-4">
      <View className="flex-row items-center justify-between">
        <Text className="text-sm font-bold text-foreground">
          {district} {t("property.areaSummary.titleSuffix")}
        </Text>
        <Pressable
          onPress={() => router.push({ pathname: "/areas/[name]", params: { name: district, city } })}
          className="flex-row items-center gap-0.5"
        >
          <Text className="text-xs font-semibold text-primary">{t("property.areaSummary.exploreArea")}</Text>
          <ChevronRight size={14} color={colors.primary} />
        </Pressable>
      </View>

      <View className="gap-3">
        {data.area_score != null && <ScoreBar label={t("property.areaSummary.areaScore")} value={data.area_score} />}
        {data.family_score != null && <ScoreBar label={t("property.areaSummary.familyScore")} value={data.family_score} />}
        {data.school_score != null && <ScoreBar label={t("property.areaSummary.schoolScore")} value={data.school_score} />}
      </View>

      {places.length > 0 && (
        <View className="flex-row flex-wrap gap-x-4 gap-y-2 border-t border-border pt-3">
          {places.map(({ icon: Icon, count, label }) => (
            <View key={label} className="flex-row items-center gap-1.5">
              <Icon size={14} color={colors.mutedForeground} />
              <Text className="text-xs text-muted-foreground">
                {count} {label}
              </Text>
            </View>
          ))}
        </View>
      )}
    </View>
  );
}
