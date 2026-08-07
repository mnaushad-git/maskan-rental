import { useEffect, useMemo, useState } from "react";
import { View, Text, ScrollView, Pressable, TextInput } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter, Stack } from "expo-router";
import { Calculator, ChevronDown, Minus, Plus, ArrowRight } from "lucide-react-native";
import { OptionModal } from "@/components/SelectField";
import { fetchAreas, type ApiAreaSummary } from "@/lib/api/maskan";
import { districtsByCity } from "@/lib/maskan-search-data";
import { formatSAR } from "@/lib/maskan-data";
import { useLanguage } from "@/lib/i18n/context";
import { colors } from "@/lib/colors";

const TYPE_FACTORS: Record<string, number> = { Apartment: 1, Villa: 1.35, Penthouse: 1.5, Townhouse: 1.15 };
const CITIES = Object.keys(districtsByCity);

export default function EstimateScreen() {
  const { t } = useLanguage();
  const router = useRouter();
  const [areas, setAreas] = useState<ApiAreaSummary[]>([]);
  const [city, setCity] = useState(CITIES[0] ?? "Riyadh");
  const [district, setDistrict] = useState("Any");
  const [bedrooms, setBedrooms] = useState(3);
  const [type, setType] = useState("Apartment");
  const [size, setSize] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const [picker, setPicker] = useState<null | "city" | "district" | "type">(null);

  useEffect(() => {
    fetchAreas().then(setAreas).catch(() => setAreas([]));
  }, []);

  const districts = ["Any", ...(districtsByCity[city] ?? [])];

  const estimate = useMemo(() => {
    const cityAreas = areas.filter((a) => a.city === city || (city === "Khobar" && a.city === "Al Khobar"));
    const matched = district !== "Any" ? cityAreas.find((a) => a.name === district) : null;
    const base =
      matched?.average_rent ??
      (cityAreas.length > 0 ? cityAreas.reduce((s, a) => s + a.average_rent, 0) / cityAreas.length : 6000);
    const bedroomFactor = 1 + (bedrooms - 3) * 0.12;
    const typeFactor = TYPE_FACTORS[type] ?? 1;
    const sizeNum = Number(size);
    const typicalSize = bedrooms * 70;
    const sizeFactor = sizeNum > 0 ? Math.max(0.7, Math.min(1.6, sizeNum / typicalSize)) : 1;
    const monthly = base * bedroomFactor * typeFactor * sizeFactor;
    const annual = monthly * 12;
    return {
      monthlyLow: Math.round((monthly * 0.9) / 100) * 100,
      monthlyHigh: Math.round((monthly * 1.1) / 100) * 100,
      annualLow: Math.round((annual * 0.9) / 100) * 100,
      annualHigh: Math.round((annual * 1.1) / 100) * 100,
      sampleSize: matched?.property_count ?? cityAreas.reduce((s, a) => s + a.property_count, 0),
      basedOn: matched ? `${district}, ${city}` : t("estimate.cityAverage", { city }),
    };
  }, [areas, city, district, bedrooms, type, size, t]);

  return (
    <SafeAreaView edges={["bottom"]} className="flex-1 bg-background">
      <Stack.Screen options={{ title: t("estimate.badge") }} />
      <ScrollView contentContainerClassName="gap-4 p-4">
        <View className="gap-1">
          <View className="flex-row items-center gap-1.5 self-start rounded-full bg-primary/10 px-3 py-1">
            <Calculator size={13} color={colors.primary} />
            <Text className="text-xs font-medium text-primary">{t("estimate.badge")}</Text>
          </View>
          <Text className="text-xl font-bold text-foreground">{t("estimate.heading")}</Text>
          <Text className="text-sm leading-5 text-muted-foreground">{t("estimate.subtitle")}</Text>
        </View>

        {/* Form */}
        <View className="gap-3 rounded-xl border border-border bg-card p-4">
          <SelectRow label={t("estimate.city")} value={city} onPress={() => setPicker("city")} />
          <SelectRow
            label={t("estimate.areaDistrict")}
            value={district === "Any" ? t("estimate.anyAreaIn", { city }) : district}
            onPress={() => setPicker("district")}
          />
          <View className="gap-1.5">
            <Text className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              {t("estimate.bedrooms")}
            </Text>
            <View className="flex-row items-center gap-4">
              <Pressable
                onPress={() => setBedrooms((b) => Math.max(1, b - 1))}
                accessibilityRole="button"
                accessibilityLabel={t("estimate.decreaseBedrooms")}
                className="size-9 items-center justify-center rounded-lg border border-border"
              >
                <Minus size={16} color={colors.foreground} />
              </Pressable>
              <Text className="w-8 text-center text-base font-bold text-foreground">{bedrooms}</Text>
              <Pressable
                onPress={() => setBedrooms((b) => Math.min(7, b + 1))}
                accessibilityRole="button"
                accessibilityLabel={t("estimate.increaseBedrooms")}
                className="size-9 items-center justify-center rounded-lg border border-border"
              >
                <Plus size={16} color={colors.foreground} />
              </Pressable>
            </View>
          </View>
          <SelectRow label={t("estimate.propertyType")} value={t(`propertyTypes.${type}`)} onPress={() => setPicker("type")} />
          <View className="gap-1.5">
            <Text className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              {t("estimate.sizeLabel")} {t("estimate.sizeOptional")}
            </Text>
            <TextInput
              value={size}
              onChangeText={setSize}
              keyboardType="numeric"
              placeholder={t("estimate.sizePlaceholder", { size: bedrooms * 70 })}
              placeholderTextColor={colors.neutral400}
              className="rounded-lg border border-border px-3 py-2.5 text-sm text-foreground"
            />
          </View>
          <Pressable
            onPress={() => setSubmitted(true)}
            className="mt-1 flex-row items-center justify-center gap-2 rounded-xl bg-primary py-3.5"
          >
            <Calculator size={16} color="#FFFFFF" />
            <Text className="text-sm font-semibold text-primary-foreground">{t("estimate.getMyEstimate")}</Text>
          </Pressable>
        </View>

        {/* Result */}
        {!submitted ? (
          <View className="rounded-xl border border-dashed border-border p-6">
            <Text className="text-center text-sm text-muted-foreground">{t("estimate.emptyPrompt")}</Text>
          </View>
        ) : (
          <View className="gap-3 rounded-2xl border p-5" style={{ borderColor: colors.primary, backgroundColor: "rgba(194,65,12,0.05)" }}>
            <Text className="text-sm font-semibold text-foreground">{t("estimate.resultHeading")}</Text>
            <Text className="text-xs text-muted-foreground">
              {estimate.sampleSize > 0
                ? t("estimate.basedOnWithListings", { basis: estimate.basedOn, count: estimate.sampleSize })
                : t("estimate.basedOn", { basis: estimate.basedOn })}
            </Text>
            <View className="flex-row justify-between border-y border-border py-3">
              <View>
                <Text className="text-xs text-muted-foreground">{t("estimate.monthlyRent")}</Text>
                <Text className="text-lg font-bold text-foreground">
                  {formatSAR(estimate.monthlyLow)}–{formatSAR(estimate.monthlyHigh)}
                </Text>
              </View>
              <View className="items-end">
                <Text className="text-xs text-muted-foreground">{t("estimate.annualRentRange")}</Text>
                <Text className="text-lg font-bold text-foreground">
                  {formatSAR(estimate.annualLow)}–{formatSAR(estimate.annualHigh)}
                </Text>
              </View>
            </View>
            <Text className="text-[11px] leading-4 text-muted-foreground">{t("estimate.disclaimer")}</Text>
            <View className="flex-row gap-2">
              <Pressable
                onPress={() => router.push("/search")}
                className="flex-1 flex-row items-center justify-center gap-1.5 rounded-xl border border-border py-3"
              >
                <Text className="text-sm font-medium text-foreground">{t("estimate.viewSimilarListings")}</Text>
              </Pressable>
              <Pressable
                onPress={() => router.push("/lead/new")}
                className="flex-1 flex-row items-center justify-center gap-1.5 rounded-xl bg-primary py-3"
              >
                <Text className="text-sm font-semibold text-primary-foreground">{t("estimate.submitLeadRequest")}</Text>
                <ArrowRight size={15} color="#FFFFFF" />
              </Pressable>
            </View>
          </View>
        )}
      </ScrollView>

      <OptionModal
        visible={picker === "city"}
        onClose={() => setPicker(null)}
        options={CITIES.map((c) => ({ key: c, label: c }))}
        onSelect={(c) => {
          setCity(c);
          setDistrict("Any");
        }}
      />
      <OptionModal
        visible={picker === "district"}
        onClose={() => setPicker(null)}
        options={districts.map((d) => ({ key: d, label: d === "Any" ? t("estimate.anyAreaIn", { city }) : d }))}
        onSelect={setDistrict}
      />
      <OptionModal
        visible={picker === "type"}
        onClose={() => setPicker(null)}
        options={Object.keys(TYPE_FACTORS).map((ty) => ({ key: ty, label: t(`propertyTypes.${ty}`) }))}
        onSelect={setType}
      />
    </SafeAreaView>
  );
}

function SelectRow({ label, value, onPress }: { label: string; value: string; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} className="gap-1.5">
      <Text className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{label}</Text>
      <View className="flex-row items-center justify-between rounded-lg border border-border px-3 py-2.5">
        <Text className="text-sm font-medium text-foreground">{value}</Text>
        <ChevronDown size={16} color={colors.neutral400} />
      </View>
    </Pressable>
  );
}
