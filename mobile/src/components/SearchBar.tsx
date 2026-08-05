import { useState } from "react";
import { View, Text, Pressable } from "react-native";
import { useRouter } from "expo-router";
import { DoorOpen, Key, MapPin, Search, SlidersHorizontal } from "lucide-react-native";
import { districtsByCity } from "@/lib/maskan-search-data";
import { useLanguage } from "@/lib/i18n/context";
import { allCategories, type ListingType } from "@/lib/listingCategories";
import { SelectField, OptionModal } from "./SelectField";
import { colors } from "@/lib/colors";

type LocationOption = { label: string; city: string; district: string };

function buildLocationOptions(tCity: (city: string) => string): LocationOption[] {
  return Object.entries(districtsByCity).flatMap(([city, districts]) => [
    { label: tCity(city), city, district: "Any" },
    ...districts.map((d) => ({ label: `${tCity(city)}, ${d}`, city, district: d })),
  ]);
}

const RENT_BUDGET_OPTIONS = [
  { min: 0, max: 500000 },
  { min: 50000, max: 80000 },
  { min: 80000, max: 200000 },
  { min: 200000, max: 400000 },
  { min: 400000, max: 500000 },
] as const;

const RENT_BUDGET_LABEL_KEYS = [
  "searchBar.anyBudget",
  "searchBar.budget50to80",
  "searchBar.budget80to200",
  "searchBar.budget200to400",
  "searchBar.budget400plus",
];

const SALE_BUDGET_OPTIONS = [
  { min: 0, max: 30_000_000 },
  { min: 0, max: 500_000 },
  { min: 500_000, max: 1_500_000 },
  { min: 1_500_000, max: 5_000_000 },
  { min: 5_000_000, max: 30_000_000 },
] as const;

const SALE_BUDGET_LABEL_KEYS = [
  "searchBar.anyBudget",
  "searchBar.saleBudgetUnder500k",
  "searchBar.saleBudget500kTo1_5m",
  "searchBar.saleBudget1_5mTo5m",
  "searchBar.saleBudget5mPlus",
];

export type SearchBarFilters = {
  listingType: ListingType;
  city: string;
  district: string;
  minRent: number;
  maxRent: number;
  type: string;
};

export function SearchBar({
  onSearch,
  onListingTypeChange,
  initialListingType = "rent",
}: {
  onSearch?: (filters: SearchBarFilters) => void;
  onListingTypeChange?: (v: ListingType) => void;
  initialListingType?: ListingType;
}) {
  const { t } = useLanguage();
  const router = useRouter();
  const locationOptions = buildLocationOptions((city) => t(`cities.${city}`));
  const [location, setLocation] = useState<LocationOption | null>(null);
  const [listingType, setListingType] = useState<ListingType>(initialListingType);
  const [propertyType, setPropertyType] = useState("Any");
  const [budgetIdx, setBudgetIdx] = useState(0);
  const [openModal, setOpenModal] = useState<"location" | "type" | "budget" | null>(null);

  const budgetOptions = listingType === "sale" ? SALE_BUDGET_OPTIONS : RENT_BUDGET_OPTIONS;
  const budgetLabelKeys = listingType === "sale" ? SALE_BUDGET_LABEL_KEYS : RENT_BUDGET_LABEL_KEYS;
  const propertyTypeKeys = ["Any", ...allCategories(listingType)];

  function switchListingType(v: ListingType) {
    setListingType(v);
    setPropertyType("Any");
    setBudgetIdx(0);
    onListingTypeChange?.(v);
  }

  function currentFilters(): SearchBarFilters {
    const budget = budgetOptions[budgetIdx];
    return {
      listingType,
      city: location?.city && location.city !== "Any" ? location.city : "Any",
      district: location?.district && location.district !== "Any" ? location.district : "Any",
      minRent: budget.min,
      maxRent: budget.max,
      type: propertyType,
    };
  }

  function handleSearch() {
    const filters = currentFilters();
    if (onSearch) {
      onSearch(filters);
      return;
    }
    router.push({ pathname: "/search", params: filters as unknown as Record<string, string> });
  }

  return (
    <View className="rounded-2xl border border-border bg-background p-2 shadow-elevated">
      <View className="flex-row items-center gap-1 p-1">
        <Pressable
          onPress={() => switchListingType("rent")}
          className={`flex-row items-center gap-1.5 rounded-lg px-4 py-2 ${listingType === "rent" ? "bg-primary" : ""}`}
        >
          <DoorOpen size={16} color={listingType === "rent" ? "#FFFFFF" : colors.mutedForeground} />
          <Text className={`text-sm font-semibold ${listingType === "rent" ? "text-primary-foreground" : "text-muted-foreground"}`}>
            {t("listingCategories.rent")}
          </Text>
        </Pressable>
        <Pressable
          onPress={() => switchListingType("sale")}
          className={`flex-row items-center gap-1.5 rounded-lg px-4 py-2 ${listingType === "sale" ? "bg-primary" : ""}`}
        >
          <Key size={16} color={listingType === "sale" ? "#FFFFFF" : colors.mutedForeground} />
          <Text className={`text-sm font-semibold ${listingType === "sale" ? "text-primary-foreground" : "text-muted-foreground"}`}>
            {t("listingCategories.sale")}
          </Text>
        </Pressable>
      </View>

      <SelectField
        label={t("searchBar.location")}
        value={location?.label ?? t("searchBar.cityOrDistrict")}
        onPress={() => setOpenModal("location")}
        icon={<MapPin size={18} color={colors.mutedForeground} />}
      />
      <View className="flex-row">
        <SelectField
          label={t("searchBar.propertyType")}
          value={t(`propertyTypes.${propertyType}`)}
          onPress={() => setOpenModal("type")}
        />
        <SelectField
          label={listingType === "sale" ? t("searchBar.budget") : t("searchBar.budgetPerYear")}
          value={t(budgetLabelKeys[budgetIdx])}
          onPress={() => setOpenModal("budget")}
        />
      </View>

      <View className="flex-row gap-2 p-1 pt-2">
        <Pressable
          className="w-11 items-center justify-center rounded-lg border border-border py-2.5"
          onPress={handleSearch}
          accessibilityRole="button"
          accessibilityLabel={t("searchBar.allFilters")}
        >
          <SlidersHorizontal size={18} color={colors.foreground} />
        </Pressable>
        <Pressable className="flex-1 flex-row items-center justify-center gap-1.5 rounded-lg bg-primary py-2.5" onPress={handleSearch}>
          <Search size={16} color="#FFFFFF" />
          <Text className="text-sm font-semibold text-primary-foreground">{t("searchBar.search")}</Text>
        </Pressable>
      </View>

      <OptionModal
        visible={openModal === "location"}
        onClose={() => setOpenModal(null)}
        options={locationOptions.map((o) => ({ key: o.label, label: o.label }))}
        onSelect={(key) => setLocation(locationOptions.find((o) => o.label === key) ?? null)}
      />
      <OptionModal
        visible={openModal === "type"}
        onClose={() => setOpenModal(null)}
        options={propertyTypeKeys.map((key) => ({ key, label: t(`propertyTypes.${key}`) }))}
        onSelect={(key) => setPropertyType(key)}
      />
      <OptionModal
        visible={openModal === "budget"}
        onClose={() => setOpenModal(null)}
        options={budgetOptions.map((_, i) => ({ key: String(i), label: t(budgetLabelKeys[i]) }))}
        onSelect={(key) => setBudgetIdx(Number(key))}
      />
    </View>
  );
}
