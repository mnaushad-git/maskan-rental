import { useEffect, useMemo, useState } from "react";
import { View, Text, FlatList, ActivityIndicator, Pressable } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useLocalSearchParams } from "expo-router";
import { List, Map as MapIcon } from "lucide-react-native";
import { fetchProperties, mapApiSearchProperty, type ApiProperty } from "@/lib/api/maskan";
import type { SearchProperty } from "@/lib/maskan-search-data";
import { useLanguage } from "@/lib/i18n/context";
import { SearchBar, type SearchBarFilters } from "@/components/SearchBar";
import { PropertyMapView } from "@/components/PropertyMapView";
import { PropertyCard } from "@/components/PropertyCard";
import type { Property } from "@/lib/maskan-data";

function toUiProperty(p: SearchProperty): Property {
  return {
    id: p.id,
    title: p.title,
    district: p.district,
    city: p.city,
    price: p.price,
    listingType: p.listingType,
    bedrooms: p.bedrooms,
    bathrooms: p.bathrooms,
    area: p.area,
    type: p.type,
    image: p.image,
    images: [p.image],
    matchScore: p.matchScore,
    badges: ["Verified"],
    status: "Available",
    pricePerSqm: p.area > 0 ? Math.round(p.price / p.area) : 0,
    agent: "Maskan Agent",
    agentPhone: p.agentPhone,
    agentProfileImage: null,
    mediatorId: null,
  };
}

export default function SearchScreen() {
  const { t } = useLanguage();
  const rawParams = useLocalSearchParams();
  const params = rawParams as Partial<Record<keyof SearchBarFilters, string>>;
  const [all, setAll] = useState<SearchProperty[]>([]);
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState<SearchBarFilters | null>(() =>
    params.listingType
      ? {
          listingType: (params.listingType as SearchBarFilters["listingType"]) ?? "rent",
          city: params.city ?? "Any",
          district: params.district ?? "Any",
          type: params.type ?? "Any",
          minRent: params.minRent ? Number(params.minRent) : 0,
          maxRent: params.maxRent ? Number(params.maxRent) : 500_000,
        }
      : null,
  );
  const [view, setView] = useState<"list" | "map">("list");

  useEffect(() => {
    fetchProperties()
      .then((raw: ApiProperty[]) => setAll(raw.map(mapApiSearchProperty)))
      .catch(() => setAll([]))
      .finally(() => setLoading(false));
  }, []);

  const results = useMemo(() => {
    if (!filters) return all;
    return all.filter((p) => {
      if (p.listingType !== filters.listingType) return false;
      if (filters.city !== "Any" && p.city !== filters.city) return false;
      if (filters.district !== "Any" && p.district !== filters.district) return false;
      if (filters.type !== "Any" && p.type !== filters.type) return false;
      const annual = p.listingType === "sale" ? p.price : p.price;
      if (annual < filters.minRent || annual > filters.maxRent) return false;
      return true;
    });
  }, [all, filters]);

  return (
    <SafeAreaView edges={["bottom"]} className="flex-1 bg-background">
      <View className="gap-4 p-4">
        <SearchBar onSearch={setFilters} onListingTypeChange={(v) => setFilters((f) => (f ? { ...f, listingType: v } : f))} />

        <View className="flex-row items-center justify-between">
          <Text className="text-sm text-muted-foreground">
            {loading
              ? t("common.loading")
              : t(results.length === 1 ? "search.resultsHeadingSingular" : "search.resultsHeadingPlural", {
                  count: results.length,
                })}
          </Text>
          <View className="flex-row gap-1">
            <Pressable
              onPress={() => setView("list")}
              className={`size-9 items-center justify-center rounded-lg ${view === "list" ? "bg-primary-soft" : ""}`}
            >
              <List size={18} color={view === "list" ? "#16A34A" : "#64748B"} />
            </Pressable>
            <Pressable
              onPress={() => setView("map")}
              className={`size-9 items-center justify-center rounded-lg ${view === "map" ? "bg-primary-soft" : ""}`}
            >
              <MapIcon size={18} color={view === "map" ? "#16A34A" : "#64748B"} />
            </Pressable>
          </View>
        </View>
      </View>

      {loading ? (
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator color="#16A34A" />
        </View>
      ) : view === "map" ? (
        <View className="flex-1 px-4 pb-4">
          <PropertyMapView properties={results} style={{ flex: 1 }} />
        </View>
      ) : (
        <FlatList
          data={results}
          keyExtractor={(p) => p.id}
          contentContainerClassName="gap-4 p-4 pt-0"
          renderItem={({ item }) => <PropertyCard p={toUiProperty(item)} />}
          ListEmptyComponent={
            <View className="items-center py-16">
              <Text className="text-sm text-muted-foreground">{t("search.noMatchesTitle")}</Text>
            </View>
          }
        />
      )}
    </SafeAreaView>
  );
}
