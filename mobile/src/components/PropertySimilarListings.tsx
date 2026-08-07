import { useEffect, useState } from "react";
import { View, Text, ScrollView } from "react-native";
import { fetchSimilarProperties, mapApiSearchProperty } from "@/lib/api/maskan";
import { useLanguage } from "@/lib/i18n/context";
import { PropertyCard } from "./PropertyCard";
import { toCardProperty, type Property } from "@/lib/maskan-data";

/** Horizontal rail of other listings near this one — backed by the
 * server-side /properties/{id}/similar endpoint (same district first, then
 * closest price), mirroring the web app's "Comparable Listings" section. */
export function PropertySimilarListings({ excludeId }: { excludeId: string }) {
  const { t } = useLanguage();
  const [items, setItems] = useState<Property[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchSimilarProperties(Number(excludeId))
      .then((results) => {
        if (cancelled) return;
        setItems(results.map(mapApiSearchProperty).map(toCardProperty));
      })
      .catch(() => !cancelled && setItems([]));
    return () => {
      cancelled = true;
    };
  }, [excludeId]);

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
