import { useEffect, useState } from "react";
import { View, Text, ScrollView } from "react-native";
import { fetchProperties, mapApiSearchProperty } from "@/lib/api/maskan";
import { useLanguage } from "@/lib/i18n/context";
import { PropertyCard } from "./PropertyCard";
import { toCardProperty, type Property } from "@/lib/maskan-data";

/** Horizontal rail of other listings in the same district — a condensed
 * mobile take on the web app's "Comparable Listings" section. */
export function PropertySimilarListings({
  excludeId,
  district,
  city,
}: {
  excludeId: string;
  district: string;
  city: string;
}) {
  const { t } = useLanguage();
  const [items, setItems] = useState<Property[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchProperties()
      .then((all) => {
        if (cancelled) return;
        const similar = all
          .map(mapApiSearchProperty)
          .filter((p) => p.id !== excludeId && p.district === district && p.city === city)
          .slice(0, 6)
          .map(toCardProperty);
        setItems(similar);
      })
      .catch(() => !cancelled && setItems([]));
    return () => {
      cancelled = true;
    };
  }, [excludeId, district, city]);

  if (!items || items.length === 0) return null;

  return (
    <View className="gap-3">
      <View>
        <Text className="text-sm font-bold text-foreground">{t("property.comparable.title")}</Text>
        <Text className="text-xs text-muted-foreground">{t("property.comparable.subtitle")}</Text>
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerClassName="gap-3 pe-1">
        {items.map((p) => (
          <View key={p.id} style={{ width: 280 }}>
            <PropertyCard p={p} />
          </View>
        ))}
      </ScrollView>
    </View>
  );
}
