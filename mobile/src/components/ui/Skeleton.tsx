import { useEffect } from "react";
import { View, type DimensionValue } from "react-native";
import Animated, { useAnimatedStyle, useSharedValue, withRepeat, withTiming } from "react-native-reanimated";
import { duration, easing } from "@/lib/theme";

/** Pulsing placeholder shown while data loads — replaces the bare
 * ActivityIndicator spinners every screen previously rolled on its own.
 * Compose shapes with width/height/radius rather than adding named presets:
 * a single primitive is easier to keep consistent than a growing enum of
 * "line" | "circle" | "card" variants that all end up needing one-off
 * overrides anyway. */
export function Skeleton({
  width = "100%",
  height = 16,
  radius = 8,
  className = "",
}: {
  width?: DimensionValue;
  height?: DimensionValue;
  radius?: number;
  className?: string;
}) {
  const opacity = useSharedValue(0.4);

  useEffect(() => {
    opacity.value = withRepeat(withTiming(1, { duration: duration.slow, easing: easing.standard }), -1, true);
  }, [opacity]);

  const style = useAnimatedStyle(() => ({ opacity: opacity.value }));

  return (
    <Animated.View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[{ width, height, borderRadius: radius }, style]}
      className={`bg-surface-2 ${className}`}
    />
  );
}

/** Common composite: a property-card-shaped skeleton, for search/saved/list
 * screens to show while the real cards are loading. */
export function PropertyCardSkeleton() {
  return (
    <View className="gap-3 rounded-2xl bg-background p-3">
      <Skeleton height={160} radius={16} />
      <Skeleton width="70%" height={18} />
      <Skeleton width="40%" height={14} />
      <View className="flex-row gap-2">
        <Skeleton width={60} height={24} radius={12} />
        <Skeleton width={60} height={24} radius={12} />
      </View>
    </View>
  );
}
