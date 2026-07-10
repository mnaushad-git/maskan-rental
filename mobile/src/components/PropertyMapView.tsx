import { useEffect, useMemo, useRef, useState } from "react";
import { View, Text, Image, Pressable, type ViewStyle } from "react-native";
import MapView, { Marker, type Region } from "react-native-maps";
import { Link } from "expo-router";
import { BedDouble, Bath, MapPin, ExternalLink, X } from "lucide-react-native";
import type { SearchProperty } from "@/lib/maskan-search-data";
import { formatSAR } from "@/lib/maskan-data";
import { CITY_CENTERS, DISTRICT_COORDS } from "@/lib/geo";
import { useLanguage } from "@/lib/i18n/context";

function getCoords(p: SearchProperty): [number, number] {
  return DISTRICT_COORDS[`${p.district}|${p.city}`] ?? CITY_CENTERS[p.city] ?? CITY_CENTERS.Riyadh;
}

function jitter(val: number, seed: number, scale = 0.007): number {
  const x = Math.sin(seed * 127.1) * 43758.5453;
  return val + (x - Math.floor(x) - 0.5) * scale;
}

function formatPinPrice(n: number): string {
  if (n >= 1_000_000) return `${Math.round((n / 1_000_000) * 10) / 10}M`;
  if (n >= 1_000) return `${Math.round(n / 1000)}K`;
  return String(Math.round(n));
}

function regionFor(properties: SearchProperty[]): Region {
  if (properties.length === 0) {
    const [lat, lng] = CITY_CENTERS.Riyadh;
    return { latitude: lat, longitude: lng, latitudeDelta: 0.3, longitudeDelta: 0.3 };
  }
  const points = properties.map((p, i) => {
    const [baseLat, baseLng] = getCoords(p);
    return [jitter(baseLat, Number(p.id) * 3 + i), jitter(baseLng, Number(p.id) * 7 + i + 13)] as const;
  });
  const lats = points.map((p) => p[0]);
  const lngs = points.map((p) => p[1]);
  const minLat = Math.min(...lats);
  const maxLat = Math.max(...lats);
  const minLng = Math.min(...lngs);
  const maxLng = Math.max(...lngs);
  return {
    latitude: (minLat + maxLat) / 2,
    longitude: (minLng + maxLng) / 2,
    latitudeDelta: Math.max(0.05, (maxLat - minLat) * 1.6),
    longitudeDelta: Math.max(0.05, (maxLng - minLng) * 1.6),
  };
}

export function PropertyMapView({
  properties,
  style,
}: {
  properties: SearchProperty[];
  style?: ViewStyle;
}) {
  const { t } = useLanguage();
  const mapRef = useRef<MapView>(null);
  const [selected, setSelected] = useState<SearchProperty | null>(null);
  const initialRegion = useMemo(() => regionFor(properties), []); // eslint-disable-line react-hooks/exhaustive-deps

  // Re-fit the viewport only when the result set actually changes (e.g. a
  // filter or search) — a controlled `region` prop would re-center on every
  // render and fight the user's own pan/zoom gestures.
  useEffect(() => {
    mapRef.current?.animateToRegion(regionFor(properties), 300);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [properties]);

  return (
    <View className="relative overflow-hidden rounded-2xl border border-border" style={style ?? { height: 320 }}>
      <MapView ref={mapRef} style={{ flex: 1 }} initialRegion={initialRegion}>
        {properties.map((p, i) => {
          const [baseLat, baseLng] = getCoords(p);
          const lat = jitter(baseLat, Number(p.id) * 3 + i);
          const lng = jitter(baseLng, Number(p.id) * 7 + i + 13);
          const isSale = p.listingType === "sale";
          const color = isSale ? "#D97706" : "#16A34A";
          const priceLabel = isSale ? formatPinPrice(p.price) : `${formatPinPrice(p.price / 12)}/mo`;

          return (
            <Marker key={p.id} coordinate={{ latitude: lat, longitude: lng }} onPress={() => setSelected(p)}>
              <View className="items-center">
                <View
                  className="rounded-md border-2 border-white px-1.5 py-1 shadow-card"
                  style={{ backgroundColor: color }}
                >
                  <Text className="text-[11px] font-bold text-white">{priceLabel}</Text>
                </View>
                <View
                  style={{
                    width: 0,
                    height: 0,
                    borderLeftWidth: 5,
                    borderRightWidth: 5,
                    borderTopWidth: 6,
                    borderLeftColor: "transparent",
                    borderRightColor: "transparent",
                    borderTopColor: color,
                    marginTop: -1,
                  }}
                />
              </View>
            </Marker>
          );
        })}
      </MapView>

      <View className="absolute start-3 top-3 flex-row items-center gap-1 rounded-xl border border-border bg-background/95 px-3 py-1.5">
        <MapPin size={14} color="#16A34A" />
        <Text className="text-xs font-semibold text-foreground">
          {t(properties.length === 1 ? "map.propertyCountSingular" : "map.propertyCountPlural", {
            count: properties.length,
          })}
        </Text>
      </View>

      {selected && (
        <View className="absolute inset-x-3 bottom-4 overflow-hidden rounded-2xl border border-border bg-background shadow-elevated">
          <View className="relative aspect-[16/7] overflow-hidden bg-surface-2">
            <Image source={{ uri: selected.image }} className="size-full" resizeMode="cover" />
            <Pressable
              onPress={() => setSelected(null)}
              className="absolute end-2 top-2 size-7 items-center justify-center rounded-full bg-background/90"
            >
              <X size={14} color="#0F172A" />
            </Pressable>
          </View>
          <View className="p-4">
            <Text numberOfLines={1} className="font-bold text-sm text-foreground">
              {selected.title}
            </Text>
            <View className="mt-0.5 flex-row items-center gap-1">
              <MapPin size={12} color="#64748B" />
              <Text className="text-xs text-muted-foreground">
                {selected.district}, {selected.city}
              </Text>
            </View>
            <View className="mt-2 flex-row items-center gap-3">
              <View className="flex-row items-center gap-1">
                <BedDouble size={14} color="#64748B" />
                <Text className="text-xs text-muted-foreground">
                  {selected.bedrooms} {t("map.bedroomsAbbr")}
                </Text>
              </View>
              <View className="flex-row items-center gap-1">
                <Bath size={14} color="#64748B" />
                <Text className="text-xs text-muted-foreground">
                  {selected.bathrooms} {t("map.bathroomsAbbr")}
                </Text>
              </View>
              <Text className="ms-auto text-base font-bold text-foreground">
                SAR {formatSAR(selected.price)}
                {selected.listingType !== "sale" && (
                  <Text className="text-xs font-normal text-muted-foreground"> {t("map.perYear")}</Text>
                )}
              </Text>
            </View>
            <Link href={{ pathname: "/property/[id]", params: { id: selected.id } }} asChild>
              <Pressable className="mt-3 flex-row items-center justify-center gap-1.5 rounded-xl bg-primary py-2">
                <ExternalLink size={14} color="#FFFFFF" />
                <Text className="text-xs font-semibold text-primary-foreground">{t("map.viewFullDetails")}</Text>
              </Pressable>
            </Link>
          </View>
        </View>
      )}
    </View>
  );
}
