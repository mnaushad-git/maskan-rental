import { useEffect, useState } from "react";
import { View, Text, ScrollView, ActivityIndicator } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { fetchProperties, mapApiSearchProperty, type ApiProperty } from "@/lib/api/maskan";
import type { SearchProperty } from "@/lib/maskan-search-data";
import { useLanguage } from "@/lib/i18n/context";
import { SearchBar } from "@/components/SearchBar";
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

export default function HomeScreen() {
  const { t } = useLanguage();
  const [properties, setProperties] = useState<SearchProperty[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchProperties()
      .then((raw: ApiProperty[]) => setProperties(raw.map(mapApiSearchProperty)))
      .catch(() => setProperties([]))
      .finally(() => setLoading(false));
  }, []);

  return (
    <SafeAreaView edges={["bottom"]} className="flex-1 bg-background">
      <ScrollView contentContainerClassName="gap-6 p-4">
        <SearchBar />

        <View>
          <Text className="mb-3 text-base font-bold text-foreground">
            {t("map.propertyCountPlural", { count: properties.length })}
          </Text>
          {loading ? (
            <View className="h-64 items-center justify-center rounded-2xl border border-border bg-surface">
              <ActivityIndicator color="#16A34A" />
            </View>
          ) : (
            <PropertyMapView properties={properties} style={{ height: 260 }} />
          )}
        </View>

        <View>
          <Text className="mb-3 text-base font-bold text-foreground">
            {t("home.newListings.heading", { city: t("cities.Riyadh") })}
          </Text>
          <View className="gap-4">
            {properties.slice(0, 8).map((p) => (
              <PropertyCard key={p.id} p={toUiProperty(p)} />
            ))}
          </View>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
