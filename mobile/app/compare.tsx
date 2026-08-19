import { useEffect, useMemo, useState } from "react";
import { View, Text, ScrollView, Pressable, Modal, TextInput, FlatList, ActivityIndicator, Image } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter, Stack, Link } from "expo-router";
import { Plus, X, Search, BedDouble, Bath, Maximize, Sparkles, Trophy, Gauge, PiggyBank, MapPin } from "lucide-react-native";
import {
  fetchProperties,
  mapApiSearchProperty,
  mapApiProperty,
  fetchPropertyIntelligence,
  type ApiProperty,
  type ApiPropertyIntelligence,
} from "@/lib/api/maskan";
import { formatSAR } from "@/lib/maskan-data";
import { useLanguage } from "@/lib/i18n/context";
import { Badge } from "@/components/Badges";
import { colors } from "@/lib/colors";

type Scored = {
  raw: ApiProperty;
  id: string;
  title: string;
  district: string;
  city: string;
  price: number;
  image: string;
  bedrooms: number;
  bathrooms: number;
  area: number;
  areaScore: number;
  rentalScore: number;
  matchScore: number;
  composite: number;
};

function score(raw: ApiProperty): Scored {
  const s = mapApiSearchProperty(raw);
  const ui = mapApiProperty(raw);
  const composite = Math.round((s.matchScore + s.areaScore + s.rentalScore) / 3);
  return {
    raw,
    id: ui.id,
    title: ui.title,
    district: ui.district,
    city: ui.city,
    price: ui.price,
    image: ui.image,
    bedrooms: s.bedrooms,
    bathrooms: s.bathrooms,
    area: s.area,
    areaScore: s.areaScore,
    rentalScore: s.rentalScore,
    matchScore: s.matchScore,
    composite,
  };
}

export default function CompareScreen() {
  const { t } = useLanguage();
  const router = useRouter();
  const [all, setAll] = useState<Scored[]>([]);
  const [selected, setSelected] = useState<Scored[]>([]);
  const [loading, setLoading] = useState(true);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [query, setQuery] = useState("");
  // Prompt 11: myMakan Property Intelligence per compared property — bounded
  // to the page's ≤3 selection cap, fetched once per id and cached (mirrors
  // the web app's compare.tsx `intelMap`).
  const [intelMap, setIntelMap] = useState<Record<string, ApiPropertyIntelligence | null>>({});

  useEffect(() => {
    fetchProperties()
      .then((list) => setAll(list.map(score)))
      .catch(() => setAll([]))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    selected.forEach((p) => {
      if (!(p.id in intelMap)) {
        fetchPropertyIntelligence(Number(p.id))
          .then((intel) => setIntelMap((prev) => ({ ...prev, [p.id]: intel })))
          .catch(() => setIntelMap((prev) => ({ ...prev, [p.id]: null })));
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected]);

  const topPickId = useMemo(() => {
    if (selected.length < 2) return null;
    return selected.reduce((best, p) => (p.composite > best.composite ? p : best), selected[0]).id;
  }, [selected]);

  const pickerResults = useMemo(() => {
    const q = query.trim().toLowerCase();
    const selectedIds = new Set(selected.map((s) => s.id));
    return all
      .filter((p) => !selectedIds.has(p.id))
      .filter((p) => !q || `${p.title} ${p.district} ${p.city}`.toLowerCase().includes(q))
      .slice(0, 40);
  }, [all, selected, query]);

  function addProperty(p: Scored) {
    if (selected.length >= 3) return;
    setSelected((prev) => [...prev, p]);
    setPickerOpen(false);
    setQuery("");
  }

  if (loading) {
    return (
      <SafeAreaView edges={["bottom"]} className="flex-1 items-center justify-center bg-background">
        <Stack.Screen options={{ title: t("compare.heading") }} />
        <ActivityIndicator color={colors.primary} />
      </SafeAreaView>
    );
  }

  const topPick = selected.find((s) => s.id === topPickId);

  return (
    <SafeAreaView edges={["bottom"]} className="flex-1 bg-background">
      <Stack.Screen options={{ title: t("compare.heading") }} />
      <ScrollView contentContainerClassName="gap-4 p-4">
        <View className="flex-row items-center justify-between">
          <Text className="text-sm text-muted-foreground">{t("compare.desc")}</Text>
        </View>
        <Text className="text-xs font-medium text-primary">{t("compare.selectedCount", { count: selected.length })}</Text>

        {/* Slots */}
        <View className="flex-row gap-2">
          {[0, 1, 2].map((i) => {
            const p = selected[i];
            if (p) {
              const isTop = p.id === topPickId;
              return (
                <View
                  key={i}
                  className="flex-1 gap-1 rounded-xl border bg-card p-2"
                  style={isTop ? { borderColor: colors.primary, borderWidth: 2 } : { borderColor: colors.border }}
                >
                  {isTop && (
                    <View className="flex-row items-center gap-1 self-start rounded-full bg-primary px-1.5 py-0.5">
                      <Trophy size={9} color="#FFFFFF" />
                      <Text className="text-[9px] font-bold text-primary-foreground">{t("compare.header.aiTopPick")}</Text>
                    </View>
                  )}
                  <Image source={{ uri: p.image }} className="h-16 w-full rounded-lg" resizeMode="cover" />
                  <Text className="text-xs font-semibold text-foreground" numberOfLines={2}>{p.title}</Text>
                  <Text className="text-[10px] text-muted-foreground" numberOfLines={1}>{p.district}</Text>
                  <Pressable
                    onPress={() => setSelected((prev) => prev.filter((s) => s.id !== p.id))}
                    className="mt-0.5 flex-row items-center justify-center gap-1 rounded-md bg-muted py-1"
                  >
                    <X size={11} color={colors.mutedForeground} />
                    <Text className="text-[10px] text-muted-foreground">Remove</Text>
                  </Pressable>
                </View>
              );
            }
            return (
              <Pressable
                key={i}
                onPress={() => setPickerOpen(true)}
                className="h-40 flex-1 items-center justify-center gap-1 rounded-xl border border-dashed border-border"
              >
                <Plus size={20} color={colors.neutral400} />
                <Text className="text-[10px] text-muted-foreground">{t("compare.addSlot.addProperty")}</Text>
              </Pressable>
            );
          })}
        </View>

        {/* Comparison rows */}
        {selected.length >= 2 && (
          <View className="gap-0 rounded-xl border border-border">
            <MetricRow label={t("compare.rows.annualRent")} values={selected.map((p) => `SAR ${formatSAR(p.price)}`)} />
            <MetricRow label={t("compare.rows.bedrooms")} values={selected.map((p) => String(p.bedrooms))} icon={<BedDouble size={13} color={colors.mutedForeground} />} />
            <MetricRow label={t("compare.rows.bathrooms")} values={selected.map((p) => String(p.bathrooms))} icon={<Bath size={13} color={colors.mutedForeground} />} />
            <MetricRow label={t("compare.rows.area")} values={selected.map((p) => `${p.area} m²`)} icon={<Maximize size={13} color={colors.mutedForeground} />} />
            <MetricRow label={t("compare.rows.pricePerSqm")} values={selected.map((p) => `${formatSAR(Math.round(p.price / Math.max(1, p.area)))}`)} />
            <MetricRow label={t("compare.rows.areaScore")} values={selected.map((p) => String(p.areaScore))} highlight={selected.map((p) => p.areaScore === Math.max(...selected.map((x) => x.areaScore)))} />
            <MetricRow label={t("compare.rentalLabel")} values={selected.map((p) => String(p.rentalScore))} highlight={selected.map((p) => p.rentalScore === Math.max(...selected.map((x) => x.rentalScore)))} />
            <MetricRow label={t("compare.propertyScoreLabel")} values={selected.map((p) => String(p.composite))} highlight={selected.map((p) => p.id === topPickId)} last />
          </View>
        )}

        {/* myMakan Intelligence (Prompt 11) */}
        {selected.length >= 2 && (
          <View className="gap-2">
            <View className="flex-row items-center gap-1.5 px-1">
              <Gauge size={14} color={colors.foreground} />
              <Text className="text-xs font-bold uppercase tracking-wide text-foreground">{t("compare.categories.myMakanIntelligence")}</Text>
            </View>
            <View className="gap-0 rounded-xl border border-border">
              <MetricRow
                label={t("compare.rows.decisionScore")}
                values={selected.map((p) => (intelMap[p.id] ? `${intelMap[p.id]!.decision_score}/100` : "—"))}
                highlight={selected.map(
                  (p) =>
                    !!intelMap[p.id] &&
                    intelMap[p.id]!.decision_score === Math.max(...selected.map((s) => intelMap[s.id]?.decision_score ?? -1)),
                )}
              />
              <MetricRow label={t("compare.rows.matchScore")} values={selected.map((p) => `${p.matchScore}/100`)} />
              <MetricRow
                label={t("compare.rows.priceClassification")}
                values={selected.map((p) => intelMap[p.id]?.price_intelligence.classification ?? t("compare.notAvailable"))}
              />
              <MetricRow
                label={t("compare.rows.dataConfidence")}
                values={selected.map((p) => intelMap[p.id]?.data_confidence.level ?? "—")}
                last
              />
            </View>
          </View>
        )}

        {/* myMakan Recommendation (Prompt 11) — distinct from the AI
            recommendation below: that one picks a single overall winner from
            a client-side composite; this one picks three separate category
            winners straight from real Property Intelligence data, with a
            deterministic "why" per winner — AI never chooses the winner. */}
        {selected.length >= 2 && <MyMakanRecommendation selected={selected} intelMap={intelMap} />}

        {/* AI recommendation */}
        {topPick && (
          <View className="gap-2 rounded-2xl border p-4" style={{ borderColor: colors.primary, backgroundColor: "rgba(194,65,12,0.05)" }}>
            <View className="flex-row items-center gap-1.5">
              <Sparkles size={14} color={colors.primary} />
              <Text className="text-xs font-bold text-primary">{t("compare.aiReco.badge")}</Text>
            </View>
            <Text className="text-base font-bold text-foreground">
              {t("compare.aiReco.strongestMatch", { title: topPick.title })}
            </Text>
            <Text className="text-sm leading-5 text-muted-foreground">
              {t("compare.aiReco.description", {
                district: topPick.district,
                score: topPick.composite,
                price: formatSAR(topPick.price),
                family: topPick.areaScore,
                area: topPick.areaScore,
              })}
            </Text>
            <Pressable
              onPress={() => router.push(`/property/${topPick.id}`)}
              className="mt-1 flex-row items-center justify-center rounded-xl bg-primary py-3"
            >
              <Text className="text-sm font-semibold text-primary-foreground">{t("compare.aiReco.viewDistrict", { district: topPick.title })}</Text>
            </Pressable>
          </View>
        )}
      </ScrollView>

      {/* Property picker */}
      <Modal visible={pickerOpen} transparent animationType="slide" onRequestClose={() => setPickerOpen(false)}>
        <Pressable className="flex-1 justify-end bg-black/40" onPress={() => setPickerOpen(false)}>
          <Pressable className="max-h-[80%] rounded-t-2xl bg-background p-4" onPress={() => {}}>
            <Text className="mb-2 text-base font-bold text-foreground">{t("compare.picker.addTitle")}</Text>
            <View className="mb-2 flex-row items-center gap-2 rounded-xl border border-border px-3">
              <Search size={16} color={colors.neutral400} />
              <TextInput
                value={query}
                onChangeText={setQuery}
                placeholder={t("compare.picker.searchPlaceholder")}
                placeholderTextColor={colors.neutral400}
                className="flex-1 py-2.5 text-sm text-foreground"
              />
            </View>
            <FlatList
              data={pickerResults}
              keyExtractor={(p) => p.id}
              ListEmptyComponent={<Text className="p-4 text-center text-sm text-muted-foreground">{t("compare.picker.noMatch")}</Text>}
              renderItem={({ item }) => (
                <Pressable onPress={() => addProperty(item)} className="flex-row items-center gap-3 border-b border-border py-2.5">
                  <Image source={{ uri: item.image }} className="size-12 rounded-lg" resizeMode="cover" />
                  <View className="flex-1">
                    <Text className="text-sm font-medium text-foreground" numberOfLines={1}>{item.title}</Text>
                    <Text className="text-xs text-muted-foreground">{item.district}, {item.city} · SAR {formatSAR(item.price)}</Text>
                  </View>
                  <Plus size={18} color={colors.primary} />
                </Pressable>
              )}
            />
          </Pressable>
        </Pressable>
      </Modal>
    </SafeAreaView>
  );
}

const CLASSIFICATION_RANK: Record<string, number> = {
  "Excellent Value": 5,
  "Good Value": 4,
  Fair: 3,
  "Above Market": 2,
  "Significantly Above Market": 1,
};

type RecoEntry = { id: string; title: string; decisionScore: number | null; classification: string | null; areaScore: number | null };

function pickIntelligenceRecommendations(entries: RecoEntry[]) {
  const withScore = entries.filter((e) => e.decisionScore != null);
  const bestOverall = withScore.length ? withScore.reduce((a, b) => (b.decisionScore! > a.decisionScore! ? b : a)) : null;

  const withClass = entries.filter((e) => e.classification != null && e.classification in CLASSIFICATION_RANK);
  const bestValue = withClass.length
    ? withClass.reduce((a, b) => (CLASSIFICATION_RANK[b.classification!] > CLASSIFICATION_RANK[a.classification!] ? b : a))
    : null;

  const withArea = entries.filter((e) => e.areaScore != null);
  const bestLocation = withArea.length ? withArea.reduce((a, b) => (b.areaScore! > a.areaScore! ? b : a)) : null;

  return { bestOverall, bestValue, bestLocation };
}

function MyMakanRecommendation({ selected, intelMap }: { selected: Scored[]; intelMap: Record<string, ApiPropertyIntelligence | null> }) {
  const { t } = useLanguage();
  const entries: RecoEntry[] = selected.map((p) => {
    const intel = intelMap[p.id];
    return {
      id: p.id,
      title: p.title,
      decisionScore: intel?.decision_score ?? null,
      classification: intel?.price_intelligence.classification ?? null,
      areaScore: intel?.area_intelligence?.area_score ?? null,
    };
  });
  const { bestOverall, bestValue, bestLocation } = pickIntelligenceRecommendations(entries);
  if (!bestOverall && !bestValue && !bestLocation) return null;

  const rows: { key: string; icon: React.ReactNode; entry: RecoEntry | null; why: (e: RecoEntry) => string }[] = [
    { key: "bestOverall", icon: <Trophy size={13} color={colors.ai} />, entry: bestOverall, why: (e) => t("compare.myMakanReco.whyOverall", { score: e.decisionScore ?? 0 }) },
    { key: "bestValue", icon: <PiggyBank size={13} color={colors.ai} />, entry: bestValue, why: (e) => t("compare.myMakanReco.whyValue", { classification: e.classification ?? "" }) },
    { key: "bestLocation", icon: <MapPin size={13} color={colors.ai} />, entry: bestLocation, why: (e) => t("compare.myMakanReco.whyLocation", { score: Math.round(e.areaScore ?? 0) }) },
  ];

  return (
    <View className="gap-3 rounded-2xl border p-4" style={{ borderColor: "rgba(124,58,237,0.3)", backgroundColor: "rgba(124,58,237,0.05)" }}>
      <View className="flex-row items-center gap-1.5">
        <Sparkles size={14} color={colors.ai} />
        <Text className="text-xs font-bold" style={{ color: colors.ai }}>{t("compare.myMakanReco.title")}</Text>
      </View>
      <View className="gap-2">
        {rows
          .filter((r) => r.entry)
          .map((r) => (
            <View key={r.key} className="rounded-xl border border-border bg-card p-3">
              <Badge tone="ai" icon={r.icon}>{t(`compare.myMakanReco.${r.key}`)}</Badge>
              <Text className="mt-1.5 text-sm font-semibold text-foreground" numberOfLines={1}>{r.entry!.title}</Text>
              <Text className="mt-0.5 text-xs text-muted-foreground">{r.why(r.entry!)}</Text>
              <Link href={`/property/${r.entry!.id}`} asChild>
                <Pressable className="mt-1.5">
                  <Text className="text-xs font-semibold text-primary">{t("compare.myMakanReco.view")}</Text>
                </Pressable>
              </Link>
            </View>
          ))}
      </View>
    </View>
  );
}

function MetricRow({
  label,
  values,
  icon,
  highlight,
  last,
}: {
  label: string;
  values: string[];
  icon?: React.ReactNode;
  highlight?: boolean[];
  last?: boolean;
}) {
  return (
    <View className={`gap-1 px-3 py-2.5 ${last ? "" : "border-b border-border"}`}>
      <View className="flex-row items-center gap-1">
        {icon}
        <Text className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{label}</Text>
      </View>
      <View className="flex-row">
        {values.map((v, i) => (
          <Text
            key={i}
            className={`flex-1 text-sm ${highlight?.[i] ? "font-bold text-primary" : "font-medium text-foreground"}`}
          >
            {v}
          </Text>
        ))}
      </View>
    </View>
  );
}
