import { useEffect, useState } from "react";
import { View, Text, Pressable, Modal, ScrollView } from "react-native";
import { DoorOpen, Key, ChevronDown, MapPin, Building2, Wallet } from "lucide-react-native";
import { OptionModal } from "./SelectField";
import { districtsByCity } from "@/lib/maskan-search-data";
import { allCategories, type ListingType } from "@/lib/listingCategories";
import { useLanguage } from "@/lib/i18n/context";

const RENT_BUDGETS = [
  { min: 0, max: Number.MAX_SAFE_INTEGER },
  { min: 50000, max: 80000 },
  { min: 80000, max: 200000 },
  { min: 200000, max: 400000 },
  { min: 400000, max: Number.MAX_SAFE_INTEGER },
];
const RENT_BUDGET_KEYS = [
  "searchBar.anyBudget",
  "searchBar.budget50to80",
  "searchBar.budget80to200",
  "searchBar.budget200to400",
  "searchBar.budget400plus",
];
const SALE_BUDGETS = [
  { min: 0, max: Number.MAX_SAFE_INTEGER },
  { min: 0, max: 500_000 },
  { min: 500_000, max: 1_500_000 },
  { min: 1_500_000, max: 5_000_000 },
  { min: 5_000_000, max: Number.MAX_SAFE_INTEGER },
];
const SALE_BUDGET_KEYS = [
  "searchBar.anyBudget",
  "searchBar.saleBudgetUnder500k",
  "searchBar.saleBudget500kTo1_5m",
  "searchBar.saleBudget1_5mTo5m",
  "searchBar.saleBudget5mPlus",
];

export type HomeFilterValue = {
  listingType: ListingType;
  city: string; // "Any" or city name
  district: string; // "Any" or district name
  propertyType: string; // "Any" or a category
  budgetIdx: number;
  minBedrooms: number; // 0 = any
};

export type ResolvedHomeFilters = {
  listingType: ListingType;
  city: string;
  district: string;
  propertyType: string;
  minRent: number;
  maxRent: number;
  minBedrooms: number;
};

const CITIES = Object.keys(districtsByCity);

export function HomeFilterSheet({
  visible,
  onClose,
  value,
  onApply,
}: {
  visible: boolean;
  onClose: () => void;
  value: HomeFilterValue;
  onApply: (v: ResolvedHomeFilters & { value: HomeFilterValue }) => void;
}) {
  const { t } = useLanguage();
  const [draft, setDraft] = useState<HomeFilterValue>(value);
  const [picker, setPicker] = useState<null | "city" | "district" | "type" | "budget">(null);

  // Re-sync the draft with the applied filters each time the sheet opens.
  useEffect(() => {
    if (visible) setDraft(value);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  const budgets = draft.listingType === "sale" ? SALE_BUDGETS : RENT_BUDGETS;
  const budgetKeys = draft.listingType === "sale" ? SALE_BUDGET_KEYS : RENT_BUDGET_KEYS;
  const districts = ["Any", ...(draft.city !== "Any" ? (districtsByCity[draft.city] ?? []) : [])];
  const propertyTypes = ["Any", ...allCategories(draft.listingType)];
  const bedroomOptions = [0, 1, 2, 3, 4, 5];

  function apply() {
    const b = budgets[draft.budgetIdx] ?? budgets[0];
    onApply({
      listingType: draft.listingType,
      city: draft.city,
      district: draft.district,
      propertyType: draft.propertyType,
      minRent: b.min,
      maxRent: b.max,
      minBedrooms: draft.minBedrooms,
      value: draft,
    });
    onClose();
  }

  function reset() {
    setDraft({ ...draft, city: "Any", district: "Any", propertyType: "Any", budgetIdx: 0, minBedrooms: 0 });
  }

  function setListing(lt: ListingType) {
    setDraft({ ...draft, listingType: lt, propertyType: "Any", budgetIdx: 0 });
  }

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable className="flex-1 justify-end bg-black/40" onPress={onClose}>
        <Pressable className="max-h-[85%] rounded-t-3xl bg-background px-4 pb-6 pt-3" onPress={() => {}}>
          <View className="mb-3 items-center">
            <View className="h-1.5 w-10 rounded-full bg-muted" />
          </View>
          <View className="mb-3 flex-row items-center justify-between">
            <Text className="text-lg font-bold text-foreground">{t("searchBar.allFilters")}</Text>
            <Pressable onPress={reset}>
              <Text className="text-sm font-semibold text-primary">{t("compare.picker.clearFilters")}</Text>
            </Pressable>
          </View>

          <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ gap: 14 }}>
            {/* Rent / Buy */}
            <View className="flex-row gap-2">
              <Pressable
                onPress={() => setListing("rent")}
                className={`flex-1 flex-row items-center justify-center gap-1.5 rounded-xl border py-3 ${draft.listingType === "rent" ? "border-primary bg-primary" : "border-border"}`}
              >
                <DoorOpen size={16} color={draft.listingType === "rent" ? "#FFFFFF" : "#79716B"} />
                <Text className="text-sm font-semibold" style={{ color: draft.listingType === "rent" ? "#FFFFFF" : "#79716B" }}>
                  {t("listingCategories.rent")}
                </Text>
              </Pressable>
              <Pressable
                onPress={() => setListing("sale")}
                className={`flex-1 flex-row items-center justify-center gap-1.5 rounded-xl border py-3 ${draft.listingType === "sale" ? "border-primary bg-primary" : "border-border"}`}
              >
                <Key size={16} color={draft.listingType === "sale" ? "#FFFFFF" : "#79716B"} />
                <Text className="text-sm font-semibold" style={{ color: draft.listingType === "sale" ? "#FFFFFF" : "#79716B" }}>
                  {t("listingCategories.sale")}
                </Text>
              </Pressable>
            </View>

            <Row
              icon={<MapPin size={16} color="#79716B" />}
              label={t("estimate.city")}
              value={draft.city === "Any" ? t("map.allCities") : draft.city}
              onPress={() => setPicker("city")}
            />
            <Row
              icon={<Building2 size={16} color="#79716B" />}
              label={t("estimate.areaDistrict")}
              value={draft.district === "Any" ? t("propertyTypes.Any") : draft.district}
              onPress={() => draft.city !== "Any" && setPicker("district")}
              disabled={draft.city === "Any"}
            />
            <Row
              label={t("searchBar.propertyType")}
              value={t(`propertyTypes.${draft.propertyType}`)}
              onPress={() => setPicker("type")}
            />
            <Row
              icon={<Wallet size={16} color="#79716B" />}
              label={draft.listingType === "sale" ? t("searchBar.budget") : t("searchBar.budgetPerYear")}
              value={t(budgetKeys[draft.budgetIdx])}
              onPress={() => setPicker("budget")}
            />

            {/* Bedrooms */}
            <View className="gap-2">
              <Text className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                {t("estimate.bedrooms")}
              </Text>
              <View className="flex-row gap-2">
                {bedroomOptions.map((n) => {
                  const active = draft.minBedrooms === n;
                  return (
                    <Pressable
                      key={n}
                      onPress={() => setDraft({ ...draft, minBedrooms: n })}
                      className={`flex-1 items-center rounded-lg border py-2.5 ${active ? "border-primary bg-primary" : "border-border"}`}
                    >
                      <Text className="text-sm font-semibold" style={{ color: active ? "#FFFFFF" : "#44403C" }}>
                        {n === 0 ? t("propertyTypes.Any") : `${n}+`}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            </View>
          </ScrollView>

          <Pressable onPress={apply} className="mt-4 items-center rounded-xl bg-primary py-3.5">
            <Text className="text-sm font-semibold text-primary-foreground">{t("searchBar.search")}</Text>
          </Pressable>

          <OptionModal
            visible={picker === "city"}
            onClose={() => setPicker(null)}
            options={[{ key: "Any", label: t("map.allCities") }, ...CITIES.map((c) => ({ key: c, label: c }))]}
            onSelect={(city) => setDraft({ ...draft, city, district: "Any" })}
          />
          <OptionModal
            visible={picker === "district"}
            onClose={() => setPicker(null)}
            options={districts.map((d) => ({ key: d, label: d === "Any" ? t("propertyTypes.Any") : d }))}
            onSelect={(district) => setDraft({ ...draft, district })}
          />
          <OptionModal
            visible={picker === "type"}
            onClose={() => setPicker(null)}
            options={propertyTypes.map((k) => ({ key: k, label: t(`propertyTypes.${k}`) }))}
            onSelect={(propertyType) => setDraft({ ...draft, propertyType })}
          />
          <OptionModal
            visible={picker === "budget"}
            onClose={() => setPicker(null)}
            options={budgets.map((_, i) => ({ key: String(i), label: t(budgetKeys[i]) }))}
            onSelect={(k) => setDraft({ ...draft, budgetIdx: Number(k) })}
          />
        </Pressable>
      </Pressable>
    </Modal>
  );
}

function Row({
  icon,
  label,
  value,
  onPress,
  disabled,
}: {
  icon?: React.ReactNode;
  label: string;
  value: string;
  onPress: () => void;
  disabled?: boolean;
}) {
  return (
    <Pressable onPress={onPress} disabled={disabled} className="gap-1.5" style={{ opacity: disabled ? 0.5 : 1 }}>
      <Text className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{label}</Text>
      <View className="flex-row items-center justify-between rounded-lg border border-border px-3 py-2.5">
        <View className="flex-row items-center gap-2">
          {icon}
          <Text className="text-sm font-medium text-foreground">{value}</Text>
        </View>
        <ChevronDown size={16} color="#A8A29E" />
      </View>
    </Pressable>
  );
}
