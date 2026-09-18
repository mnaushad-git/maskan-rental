import { View, Text, type ViewStyle } from "react-native";
import { MapPin } from "lucide-react-native";
import type { SearchProperty } from "@/lib/maskan-search-data";
import { useLanguage } from "@/lib/i18n/context";
import { colors } from "@/lib/colors";
import type { MapSearchBounds } from "./PropertyMapView";

export type { MapSearchBounds };

/** Web-platform variant of PropertyMapView.
 *
 * `react-native-maps` (and `react-native-map-clustering`, which wraps it)
 * has no web implementation — its native module throws
 * `codegenNativeComponent is not a function` when Metro bundles it for web,
 * which crashes the *entire* Expo Router web bundle (every route, not just
 * the map screen). See docs/testing/mymakan-e2e-test-report.md P2-00x.
 * Metro/Expo automatically prefers a `.web.tsx` file over the base
 * component when bundling for web, so this file swaps the interactive,
 * clustered map for a static, honest placeholder instead of crashing.
 * Native (iOS/Android) is untouched — it still uses PropertyMapView.tsx
 * with the real react-native-maps view. This is a test-environment
 * enabler, not a real web map experience — myMakan mobile is not a web
 * product; a fuller web map view (if ever wanted) is out of scope here. */
export function PropertyMapView({
  properties,
  style,
  chromeless = false,
}: {
  properties: SearchProperty[];
  style?: ViewStyle;
  chromeless?: boolean;
  onSelectedChange?: (p: SearchProperty | null) => void;
  onRegionSearch?: (bounds: MapSearchBounds) => void;
  locateButtonBottomOffset?: number;
}) {
  const { t } = useLanguage();
  return (
    <View
      className={
        chromeless
          ? "relative items-center justify-center overflow-hidden bg-surface-2"
          : "relative items-center justify-center overflow-hidden rounded-2xl border border-border bg-surface-2"
      }
      style={style ?? { height: 320 }}
    >
      <MapPin size={24} color={colors.mutedForeground} />
      <Text className="mt-2 px-6 text-center text-xs text-muted-foreground">
        {t(properties.length === 1 ? "map.propertyCountSingular" : "map.propertyCountPlural", {
          count: properties.length,
        })}
      </Text>
    </View>
  );
}
