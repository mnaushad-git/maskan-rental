import { useState } from "react";
import { Pressable, Text, View, type LayoutChangeEvent } from "react-native";
import { ChevronDown } from "lucide-react-native";
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from "react-native-reanimated";
import { duration, easing } from "@/lib/theme";
import { colors } from "@/lib/colors";

/** Expandable section — for methodology/FAQ-style content (e.g. the
 * lifestyle-score breakdown, limitations list) where showing everything at
 * once would overwhelm the screen. Animates height from a measured content
 * size rather than "auto", since RN's layout engine has no native
 * equivalent of CSS's `height: auto` transition. */
export function Accordion({ title, children, defaultOpen = false }: { title: string; children: React.ReactNode; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  const [contentHeight, setContentHeight] = useState(0);
  const animatedHeight = useSharedValue(defaultOpen ? 1 : 0);

  const onContentLayout = (e: LayoutChangeEvent) => {
    const h = e.nativeEvent.layout.height;
    if (h > 0 && h !== contentHeight) setContentHeight(h);
  };

  const toggle = () => {
    const next = !open;
    setOpen(next);
    animatedHeight.value = withTiming(next ? 1 : 0, { duration: duration.base, easing: easing.standard });
  };

  const containerStyle = useAnimatedStyle(() => ({
    height: animatedHeight.value * contentHeight,
    opacity: animatedHeight.value,
  }));

  return (
    <View className="border-b border-border py-3">
      <Pressable
        onPress={toggle}
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        className="flex-row items-center justify-between py-1"
      >
        <Text className="flex-1 text-sm font-semibold text-foreground">{title}</Text>
        <Animated.View style={useAnimatedStyle(() => ({ transform: [{ rotate: `${animatedHeight.value * 180}deg` }] }))}>
          <ChevronDown size={18} color={colors.mutedForeground} />
        </Animated.View>
      </Pressable>
      <Animated.View style={[{ overflow: "hidden" }, containerStyle]}>
        <View onLayout={onContentLayout} className="absolute w-full pt-2">
          {children}
        </View>
      </Animated.View>
    </View>
  );
}
