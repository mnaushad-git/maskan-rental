import { View, Text, Pressable, ScrollView } from "react-native";
import { DoorOpen, Key, SlidersHorizontal } from "lucide-react-native";
import { useLanguage } from "@/lib/i18n/context";
import { mainCategories, type ListingType } from "@/lib/listingCategories";

export function HomeSearchHeader({
  listingType,
  onListingType,
  category,
  onCategory,
  onFilters,
}: {
  listingType: ListingType;
  onListingType: (v: ListingType) => void;
  category: string;
  onCategory: (c: string) => void;
  onFilters: () => void;
}) {
  const { t } = useLanguage();
  const chips = ["Any", ...mainCategories(listingType)];

  return (
    <View className="gap-2">
      {/* Rent / Sale toggle + Filters */}
      <View className="flex-row items-center rounded-2xl border border-border bg-background p-1.5 shadow-elevated">
        <Pressable
          onPress={() => onListingType("rent")}
          className={`flex-row items-center gap-1.5 rounded-xl px-4 py-2 ${listingType === "rent" ? "bg-primary" : ""}`}
        >
          <DoorOpen size={16} color={listingType === "rent" ? "#FFFFFF" : "#79716B"} />
          <Text
            className="text-sm font-semibold"
            style={{ color: listingType === "rent" ? "#FFFFFF" : "#79716B" }}
          >
            {t("listingCategories.rent")}
          </Text>
        </Pressable>
        <Pressable
          onPress={() => onListingType("sale")}
          className={`flex-row items-center gap-1.5 rounded-xl px-4 py-2 ${listingType === "sale" ? "bg-primary" : ""}`}
        >
          <Key size={16} color={listingType === "sale" ? "#FFFFFF" : "#79716B"} />
          <Text
            className="text-sm font-semibold"
            style={{ color: listingType === "sale" ? "#FFFFFF" : "#79716B" }}
          >
            {t("listingCategories.sale")}
          </Text>
        </Pressable>
        <View className="flex-1" />
        <Pressable
          onPress={onFilters}
          className="mr-1 flex-row items-center gap-1.5 rounded-xl border border-primary px-3 py-2"
        >
          <SlidersHorizontal size={15} color="#2563EB" />
          <Text className="text-sm font-semibold text-primary">{t("searchBar.allFilters")}</Text>
        </Pressable>
      </View>

      {/* Property-type chips */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ gap: 8, paddingRight: 12 }}
      >
        {chips.map((c) => {
          const isActive = c === category;
          return (
            <Pressable
              key={c}
              onPress={() => onCategory(c)}
              className={`rounded-full border px-4 py-2 ${isActive ? "border-primary bg-primary" : "border-border bg-background"}`}
            >
              <Text
                className="text-sm font-medium"
                style={{ color: isActive ? "#FFFFFF" : "#44403C" }}
              >
                {t(`propertyTypes.${c}`)}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );
}
