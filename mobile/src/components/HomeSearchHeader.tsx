import { View, Text, Pressable, ScrollView } from "react-native";
import { DoorOpen, Key, SlidersHorizontal } from "lucide-react-native";
import { useLanguage } from "@/lib/i18n/context";
import { mainCategories, type ListingType } from "@/lib/listingCategories";
import { Chip } from "@/components/ui/Chip";
import { SegmentedControl } from "@/components/ui/SegmentedControl";

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
      <View className="flex-row items-center gap-2">
        <View className="flex-1">
          <SegmentedControl
            options={[
              { value: "rent" as ListingType, label: t("listingCategories.rent"), icon: <DoorOpen size={16} color={listingType === "rent" ? "#FFFFFF" : "#79716B"} /> },
              { value: "sale" as ListingType, label: t("listingCategories.sale"), icon: <Key size={16} color={listingType === "sale" ? "#FFFFFF" : "#79716B"} /> },
            ]}
            value={listingType}
            onChange={onListingType}
          />
        </View>
        <Pressable
          onPress={onFilters}
          className="flex-row items-center gap-1.5 rounded-xl border border-primary px-3 py-2"
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
        {chips.map((c) => (
          <Chip key={c} selected={c === category} onPress={() => onCategory(c)}>
            {t(`propertyTypes.${c}`)}
          </Chip>
        ))}
      </ScrollView>
    </View>
  );
}
