import { useEffect, useMemo, useRef, useState } from "react";
import { View, Text, Pressable, Image, ActivityIndicator, Alert, Linking, type ViewStyle } from "react-native";
import RNMapView, { Marker, type Region } from "react-native-maps";
// Drop-in MapView replacement that clusters nearby markers into a single
// numbered pin below a zoom threshold — same react-native-maps under the
// hood (this wraps it, no native code of its own), just groups Markers when
// there'd otherwise be an unreadable pile of overlapping price tags.
import ClusteredMapView from "react-native-map-clustering";
import { Link } from "expo-router";
import * as Location from "expo-location";
import { BedDouble, Bath, MapPin, ExternalLink, X, LocateFixed } from "lucide-react-native";
import type { SearchProperty } from "@/lib/maskan-search-data";
import { formatSAR } from "@/lib/maskan-data";
import { CITY_CENTERS, DISTRICT_COORDS } from "@/lib/geo";
import { useLanguage } from "@/lib/i18n/context";
import { colors } from "@/lib/colors";

// Fallback for any property the backend hasn't backfilled real coordinates
// for yet — derives an approximate district-center pin, same as the server does.
function getCoords(p: SearchProperty): [number, number] {
  return DISTRICT_COORDS[`${p.district}|${p.city}`] ?? CITY_CENTERS[p.city] ?? CITY_CENTERS.Riyadh;
}

function jitter(val: number, seed: number, scale = 0.007): number {
  const x = Math.sin(seed * 127.1) * 43758.5453;
  return val + (x - Math.floor(x) - 0.5) * scale;
}

function pinFor(p: SearchProperty, i: number): [number, number] {
  if (p.latitude != null && p.longitude != null) return [p.latitude, p.longitude];
  const [baseLat, baseLng] = getCoords(p);
  return [jitter(baseLat, Number(p.id) * 3 + i), jitter(baseLng, Number(p.id) * 7 + i + 13)];
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
  const points = properties.map((p, i) => pinFor(p, i));
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

export type MapSearchBounds = { minLat: number; maxLat: number; minLng: number; maxLng: number };

const REGION_SEARCH_DEBOUNCE_MS = 500;
const LOCATE_TIMEOUT_MS = 8000;
const LOCATE_DELTA = 0.05;

export function PropertyMapView({
  properties,
  style,
  chromeless = false,
  onSelectedChange,
  onRegionSearch,
  locateButtonBottomOffset = 16,
}: {
  properties: SearchProperty[];
  style?: ViewStyle;
  // Full-screen mode: drop the rounded border and the built-in count badge
  // (the home screen's floating header shows the count instead).
  chromeless?: boolean;
  // Lets a chromeless host (e.g. the home screen) know a marker's preview
  // card is open, so it can raise the map above any overlay that would
  // otherwise cover the card (see HomeSheet).
  onSelectedChange?: (p: SearchProperty | null) => void;
  // Search-as-you-move-the-map: called (debounced) with the currently visible
  // bounds whenever the user pans/zooms, so the host can refetch and swap in
  // only the properties within view. Omit to keep the old fixed-list behavior.
  onRegionSearch?: (bounds: MapSearchBounds) => void;
  // Lifts the "locate me" FAB clear of overlays anchored to the bottom edge
  // (e.g. the home screen's peeked HomeSheet).
  locateButtonBottomOffset?: number;
}) {
  const { t } = useLanguage();
  const mapRef = useRef<RNMapView>(null);
  const [selected, setSelected] = useState<SearchProperty | null>(null);
  const [locating, setLocating] = useState(false);
  const [showsUserLocation, setShowsUserLocation] = useState(false);
  const initialRegion = useMemo(() => regionFor(properties), []); // eslint-disable-line react-hooks/exhaustive-deps

  // Guards against PropertyMapView's own camera moves being misread as a user
  // pan (which would immediately re-trigger onRegionSearch and fight the
  // filter-driven re-fit below), and against a region-search-driven property
  // update re-triggering that re-fit and yanking the camera out from under
  // the user right after they just panned it. Both start `true` so the
  // automatic onRegionChangeComplete react-native-maps fires on mount is ignored.
  const programmaticMove = useRef(true);
  const suppressNextAutoFit = useRef(true);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Re-fit the viewport only when the result set actually changes (e.g. a
  // filter or search) — a controlled `region` prop would re-center on every
  // render and fight the user's own pan/zoom gestures.
  useEffect(() => {
    if (suppressNextAutoFit.current) {
      suppressNextAutoFit.current = false;
      return;
    }
    programmaticMove.current = true;
    mapRef.current?.animateToRegion(regionFor(properties), 300);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [properties]);

  useEffect(() => () => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
  }, []);

  function handleRegionChangeComplete(region: Region) {
    if (programmaticMove.current) {
      programmaticMove.current = false;
      return;
    }
    if (!onRegionSearch) return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      suppressNextAutoFit.current = true;
      onRegionSearch({
        minLat: region.latitude - region.latitudeDelta / 2,
        maxLat: region.latitude + region.latitudeDelta / 2,
        minLng: region.longitude - region.longitudeDelta / 2,
        maxLng: region.longitude + region.longitudeDelta / 2,
      });
    }, REGION_SEARCH_DEBOUNCE_MS);
  }

  async function handleLocateMe() {
    if (locating) return;
    setLocating(true);
    try {
      const servicesEnabled = await Location.hasServicesEnabledAsync();
      if (!servicesEnabled) {
        Alert.alert(t("map.locationServicesOff"));
        return;
      }
      const { status, canAskAgain } = await Location.requestForegroundPermissionsAsync();
      if (status !== "granted") {
        Alert.alert(
          t("onboarding.locationDenied"),
          undefined,
          canAskAgain
            ? undefined
            : [
                { text: t("common.cancel"), style: "cancel" },
                { text: t("map.openSettings"), onPress: () => Linking.openSettings() },
              ],
        );
        return;
      }
      // Emulators/indoor devices often can't get a fresh GPS fix in time —
      // fall back to whatever position the OS last cached (e.g. from the
      // emulator's Extended Controls location, which doesn't keep "streaming").
      const position = await Promise.race([
        Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }),
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error("timeout")), LOCATE_TIMEOUT_MS)),
      ]).catch(async () => {
        const lastKnown = await Location.getLastKnownPositionAsync();
        if (!lastKnown) throw new Error("no-location");
        return lastKnown;
      });
      const region: Region = {
        latitude: position.coords.latitude,
        longitude: position.coords.longitude,
        latitudeDelta: LOCATE_DELTA,
        longitudeDelta: LOCATE_DELTA,
      };
      setShowsUserLocation(true);
      programmaticMove.current = true;
      mapRef.current?.animateToRegion(region, 500);
      if (onRegionSearch) {
        // Skip the auto-fit-to-results effect below, same as a real pan does —
        // otherwise the fetched properties would yank the camera away from
        // the user's own location right after we just centered on it.
        suppressNextAutoFit.current = true;
        onRegionSearch({
          minLat: region.latitude - region.latitudeDelta / 2,
          maxLat: region.latitude + region.latitudeDelta / 2,
          minLng: region.longitude - region.longitudeDelta / 2,
          maxLng: region.longitude + region.longitudeDelta / 2,
        });
      }
    } catch {
      Alert.alert(t("onboarding.locationDenied"));
    } finally {
      setLocating(false);
    }
  }

  return (
    <View
      className={chromeless ? "relative overflow-hidden" : "relative overflow-hidden rounded-2xl border border-border"}
      style={style ?? { height: 320 }}
    >
      <ClusteredMapView
        // The library's own .d.ts types this callback's argument as
        // React.Ref<Map> (a ref *wrapper* type), but in practice it invokes
        // it with the live MapView instance, like any other ref callback —
        // typed `any` here rather than fighting a type declaration that
        // doesn't match the library's actual runtime behavior.
        mapRef={(ref: any) => {
          mapRef.current = ref;
        }}
        style={{ flex: 1 }}
        initialRegion={initialRegion}
        onRegionChangeComplete={handleRegionChangeComplete}
        showsUserLocation={showsUserLocation}
        showsMyLocationButton={false}
        // Aqar-style map: always show each property as its own price pin,
        // even when several sit close together, rather than collapsing
        // nearby pins into a single numbered cluster circle.
        clusteringEnabled={false}
      >
        {properties.map((p, i) => {
          const [lat, lng] = pinFor(p, i);
          const isSale = p.listingType === "sale";
          const color = isSale ? colors.sale : colors.primary;
          const priceLabel = isSale ? formatPinPrice(p.price) : `${formatPinPrice(p.price / 12)}/mo`;

          return (
            <Marker
              key={p.id}
              coordinate={{ latitude: lat, longitude: lng }}
              onPress={() => {
                setSelected(p);
                onSelectedChange?.(p);
              }}
            >
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
      </ClusteredMapView>

      <Pressable
        onPress={handleLocateMe}
        disabled={locating}
        accessibilityRole="button"
        accessibilityLabel={t("map.locateMe")}
        className="absolute start-3 size-11 items-center justify-center rounded-full border border-border bg-background shadow-elevated"
        style={{ bottom: locateButtonBottomOffset, opacity: locating ? 0.7 : 1 }}
      >
        {locating ? (
          <ActivityIndicator size="small" color={colors.primary} />
        ) : (
          <LocateFixed size={20} color={colors.primary} />
        )}
      </Pressable>

      {!chromeless && (
        <View className="absolute start-3 top-3 flex-row items-center gap-1 rounded-xl border border-border bg-background/95 px-3 py-1.5">
          <MapPin size={14} color={colors.primary} />
          <Text className="text-xs font-semibold text-foreground">
            {t(properties.length === 1 ? "map.propertyCountSingular" : "map.propertyCountPlural", {
              count: properties.length,
            })}
          </Text>
        </View>
      )}

      {selected && (
        <View className="absolute inset-x-3 bottom-4 overflow-hidden rounded-2xl border border-border bg-background shadow-elevated">
          <View className="relative aspect-[16/7] overflow-hidden bg-surface-2">
            <Image source={{ uri: selected.image }} className="size-full" resizeMode="cover" />
            <Pressable
              onPress={() => {
                setSelected(null);
                onSelectedChange?.(null);
              }}
              accessibilityRole="button"
              accessibilityLabel={t("common.close")}
              className="absolute end-2 top-2 size-7 items-center justify-center rounded-full bg-background/90"
            >
              <X size={14} color={colors.foreground} />
            </Pressable>
          </View>
          <View className="p-4">
            <Text numberOfLines={1} className="font-bold text-sm text-foreground">
              {selected.title}
            </Text>
            <View className="mt-0.5 flex-row items-center gap-1">
              <MapPin size={12} color={colors.mutedForeground} />
              <Text className="text-xs text-muted-foreground">
                {selected.district}, {selected.city}
              </Text>
            </View>
            <Text className="mt-1 text-[11px] text-muted-foreground">{t("map.approxLocation")}</Text>
            <View className="mt-2 flex-row items-center gap-3">
              <View className="flex-row items-center gap-1">
                <BedDouble size={14} color={colors.mutedForeground} />
                <Text className="text-xs text-muted-foreground">
                  {selected.bedrooms} {t("map.bedroomsAbbr")}
                </Text>
              </View>
              <View className="flex-row items-center gap-1">
                <Bath size={14} color={colors.mutedForeground} />
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
