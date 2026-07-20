import { View, Text, ScrollView, Pressable } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter, Stack } from "expo-router";
import { Sparkles, Clock, ArrowRight } from "lucide-react-native";
import { useLanguage } from "@/lib/i18n/context";

const SCORE_KEYS = ["area", "school", "healthcare", "traffic", "family"] as const;
const BANDS = [
  { key: "excellent", range: "85–100", color: "#15803D" },
  { key: "strong", range: "70–84", color: "#65A30D" },
  { key: "good", range: "55–69", color: "#B45309" },
  { key: "belowAverage", range: "40–54", color: "#DC2626" },
  { key: "limitedData", range: "—", color: "#A8A29E" },
] as const;
const LIFESTYLE = ["restaurants", "gyms", "mosques", "malls", "parks"] as const;

export default function MethodologyScreen() {
  const { t } = useLanguage();
  const router = useRouter();

  return (
    <SafeAreaView edges={["bottom"]} className="flex-1 bg-background">
      <Stack.Screen options={{ title: t("methodology.badge") }} />
      <ScrollView contentContainerClassName="gap-6 p-4">
        {/* Hero */}
        <View className="gap-2">
          <View className="flex-row items-center gap-1.5 self-start rounded-full bg-primary/10 px-3 py-1">
            <Sparkles size={13} color="#2563EB" />
            <Text className="text-xs font-medium text-primary">{t("methodology.badge")}</Text>
          </View>
          <Text className="text-2xl font-bold text-foreground">{t("methodology.heading")}</Text>
          <Text className="text-sm leading-5 text-muted-foreground">
            {t("methodology.heroDesc", { engine: t("methodology.heroEngine") })}
          </Text>
        </View>

        {/* Data freshness */}
        <View className="gap-2 rounded-xl border border-border bg-card p-4">
          <View className="flex-row items-center gap-2">
            <Clock size={16} color="#2563EB" />
            <Text className="text-sm font-semibold text-foreground">{t("methodology.dataFreshness")}</Text>
          </View>
          <Text className="text-sm leading-5 text-muted-foreground">
            {t("methodology.dataFreshnessDesc", { time: t("methodology.dataFreshnessTime") })}
          </Text>
          <View className="flex-row gap-2">
            <Badge text={t("methodology.refreshedNightly")} />
            <Badge text={t("methodology.districtsCovered")} />
          </View>
        </View>

        {/* Score bands */}
        <View className="gap-2">
          <Text className="text-sm font-semibold text-foreground">{t("methodology.whatNumbersMean")}</Text>
          {BANDS.map((b) => (
            <View key={b.key} className="flex-row items-center gap-3 rounded-lg border border-border bg-card p-3">
              <View className="w-14 items-center rounded-md py-1" style={{ backgroundColor: b.color }}>
                <Text className="text-xs font-bold text-white">{b.range}</Text>
              </View>
              <View className="flex-1">
                <Text className="text-sm font-medium text-foreground">{t(`methodology.bands.${b.key}`)}</Text>
                <Text className="text-xs text-muted-foreground">{t(`methodology.bands.${b.key}Note`)}</Text>
              </View>
            </View>
          ))}
        </View>

        {/* Individual scores */}
        <View className="gap-3">
          <Text className="text-sm font-semibold text-foreground">{t("methodology.scoreBreakdown")}</Text>
          {SCORE_KEYS.map((key) => (
            <View key={key} className="gap-2 rounded-xl border border-border bg-card p-4">
              <Text className="text-base font-bold text-foreground">{t(`methodology.scores.${key}.label`)}</Text>
              <Text className="text-xs font-medium text-primary">{t(`methodology.scores.${key}.tagline`)}</Text>
              <Text className="text-sm leading-5 text-muted-foreground">{t(`methodology.scores.${key}.description`)}</Text>
              <View className="mt-1 gap-1">
                {["w1", "w2", "w3", "w4"].map((w) => {
                  const val = t(`methodology.scores.${key}.${w}`);
                  if (val === `methodology.scores.${key}.${w}`) return null; // key missing → skip
                  return (
                    <View key={w} className="flex-row gap-2">
                      <Text className="text-primary">•</Text>
                      <Text className="flex-1 text-sm text-muted-foreground">{val}</Text>
                    </View>
                  );
                })}
              </View>
            </View>
          ))}
        </View>

        {/* Lifestyle */}
        <View className="gap-2 rounded-xl border border-border bg-card p-4">
          <Text className="text-sm font-semibold text-foreground">{t("methodology.lifestyle.heading")}</Text>
          <Text className="text-sm leading-5 text-muted-foreground">{t("methodology.lifestyle.desc")}</Text>
          <View className="mt-1 gap-1.5">
            {LIFESTYLE.map((l) => (
              <View key={l} className="flex-row items-center justify-between">
                <Text className="text-sm text-foreground">{t(`methodology.lifestyle.${l}`)}</Text>
                <Text className="text-xs text-muted-foreground">{t(`methodology.lifestyle.${l}Note`)}</Text>
              </View>
            ))}
          </View>
        </View>

        {/* Limitations */}
        <View className="gap-2">
          <Text className="text-sm font-semibold text-foreground">{t("methodology.limitations.heading")}</Text>
          {["gated", "newDev", "ratingData", "commuteTime"].map((k) => (
            <View key={k} className="rounded-lg border border-border bg-card p-3">
              <Text className="text-sm font-medium text-foreground">{t(`methodology.limitations.${k}`)}</Text>
              <Text className="mt-0.5 text-sm leading-5 text-muted-foreground">{t(`methodology.limitations.${k}Desc`)}</Text>
            </View>
          ))}
        </View>

        <Pressable
          onPress={() => router.push("/areas")}
          className="flex-row items-center justify-center gap-2 rounded-xl bg-primary py-3.5"
        >
          <Text className="text-sm font-semibold text-primary-foreground">{t("methodology.exploreAreaScores")}</Text>
          <ArrowRight size={16} color="#FFFFFF" />
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}

function Badge({ text }: { text: string }) {
  return (
    <View className="rounded-full bg-muted px-2.5 py-1">
      <Text className="text-[11px] font-medium text-muted-foreground">{text}</Text>
    </View>
  );
}
