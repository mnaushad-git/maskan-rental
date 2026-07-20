import type { ReactNode } from "react";
import { View, ScrollView, Dimensions } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, { useAnimatedStyle, useSharedValue, withSpring } from "react-native-reanimated";

const { height: SCREEN_H } = Dimensions.get("window");
const SHEET_HEIGHT = Math.round(SCREEN_H * 0.72);
const PEEK = 132; // how much of the sheet is visible when collapsed
const MAX_Y = SHEET_HEIGHT - PEEK; // translateY when collapsed

/**
 * A draggable bottom sheet that floats over the full-screen map. The pan handle
 * lives in the header (grip + peek content); the body below scrolls on its own,
 * so dragging the sheet and scrolling its content don't fight each other.
 */
export function HomeSheet({ header, children }: { header: ReactNode; children: ReactNode }) {
  const translateY = useSharedValue(MAX_Y); // start collapsed
  const startY = useSharedValue(MAX_Y);

  const pan = Gesture.Pan()
    .onStart(() => {
      startY.value = translateY.value;
    })
    .onUpdate((e) => {
      translateY.value = Math.max(0, Math.min(MAX_Y, startY.value + e.translationY));
    })
    .onEnd((e) => {
      const expand = translateY.value < MAX_Y / 2 || e.velocityY < -600;
      translateY.value = withSpring(expand ? 0 : MAX_Y, { damping: 22, stiffness: 220 });
    });

  const sheetStyle = useAnimatedStyle(() => ({ transform: [{ translateY: translateY.value }] }));

  return (
    <Animated.View
      style={[
        {
          position: "absolute",
          left: 0,
          right: 0,
          bottom: 0,
          height: SHEET_HEIGHT,
        },
        sheetStyle,
      ]}
      className="rounded-t-3xl border-t border-border bg-background shadow-elevated"
    >
      <GestureDetector gesture={pan}>
        <View className="items-center px-4 pb-2 pt-2.5">
          <View className="mb-2 h-1.5 w-10 rounded-full bg-muted" />
          <View className="w-full">{header}</View>
        </View>
      </GestureDetector>
      <ScrollView contentContainerClassName="gap-6 px-4 pb-16" showsVerticalScrollIndicator={false}>
        {children}
      </ScrollView>
    </Animated.View>
  );
}
