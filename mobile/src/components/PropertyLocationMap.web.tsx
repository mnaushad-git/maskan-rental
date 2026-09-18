import { View, Text, Pressable, Linking, Platform } from "react-native";
import { MapPin, Navigation } from "lucide-react-native";
import { CITY_CENTERS, DISTRICT_COORDS } from "@/lib/geo";
import { useLanguage } from "@/lib/i18n/context";
import { colors } from "@/lib/colors";

/** Web-platform variant of PropertyLocationMap.
 *
 * `react-native-maps` has no web implementation (its native module throws
 * `codegenNativeComponent is not a function` when bundled for web, which
 * crashes the *entire* Expo Router web bundle, not just this screen — see
 * docs/testing/mymakan-e2e-test-report.md P2-00x). Metro/Expo automatically
 * prefers a `.web.tsx` file over the base component when bundling for web,
 * so this file swaps the interactive map for a static, honest placeholder
 * instead of crashing. Native (iOS/Android) is untouched — it still uses
 * PropertyLocationMap.tsx with the real react-native-maps view. */
export function PropertyLocationMap({
  latitude,
  longitude,
  district,
  city,
  title,
}: {
  latitude: number | null;
  longitude: number | null;
  district: string;
  city: string;
  title: string;
}) {
  const { t } = useLanguage();
  const [lat, lng] =
    latitude != null && longitude != null
      ? [latitude, longitude]
      : (DISTRICT_COORDS[`${district}|${city}`] ?? CITY_CENTERS[city] ?? CITY_CENTERS.Riyadh);

  function openDirections() {
    const url = Platform.select({
      default: `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`,
    });
    if (url) Linking.openURL(url).catch(() => {});
  }

  return (
    <View className="gap-3">
      <Text className="text-sm font-bold text-foreground">{t("property.map.title")}</Text>
      <View className="h-40 items-center justify-center gap-1.5 rounded-2xl border border-border bg-surface-2">
        <MapPin size={20} color={colors.mutedForeground} />
        <Text className="px-4 text-center text-xs text-muted-foreground">
          {district}, {city}
        </Text>
      </View>
      <Pressable
        onPress={openDirections}
        className="flex-row items-center justify-center gap-1.5 rounded-xl border border-border py-2.5"
      >
        <Navigation size={14} color={colors.primary} />
        <Text className="text-sm font-semibold text-primary">{t("property.map.getDirections")}</Text>
      </Pressable>
    </View>
  );
}
