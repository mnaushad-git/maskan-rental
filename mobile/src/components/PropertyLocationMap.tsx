import { View, Text, Pressable, Linking, Platform } from "react-native";
import RNMapView, { Marker } from "react-native-maps";
import { Navigation } from "lucide-react-native";
import { CITY_CENTERS, DISTRICT_COORDS } from "@/lib/geo";
import { useLanguage } from "@/lib/i18n/context";
import { colors } from "@/lib/colors";

/** Single-pin, non-interactive-feeling location preview for the property
 * detail screen — deliberately simpler than PropertyMapView (no clustering,
 * no live search), just "here's roughly where this is" + directions. */
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
      ios: `maps:0,0?q=${lat},${lng}`,
      android: `geo:0,0?q=${lat},${lng}(${encodeURIComponent(title)})`,
      default: `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`,
    });
    if (url) Linking.openURL(url).catch(() => {});
  }

  return (
    <View className="gap-3">
      <Text className="text-sm font-bold text-foreground">{t("property.map.title")}</Text>
      <View className="h-40 overflow-hidden rounded-2xl border border-border">
        <RNMapView
          style={{ flex: 1 }}
          initialRegion={{ latitude: lat, longitude: lng, latitudeDelta: 0.02, longitudeDelta: 0.02 }}
          scrollEnabled={false}
          zoomEnabled={false}
          pitchEnabled={false}
          rotateEnabled={false}
        >
          <Marker coordinate={{ latitude: lat, longitude: lng }} />
        </RNMapView>
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
