/**
 * Design tokens that can't be expressed as Tailwind/NativeWind utility
 * classes — shadows (RN needs separate iOS shadow* props vs Android
 * `elevation`, not CSS box-shadow), animation timing (Reanimated takes JS
 * numbers, not CSS duration classes), and touch-target sizing. Colors,
 * radius, and font-size live in tailwind.config.js so components can use
 * className for those; reach for these only where a raw style prop is
 * unavoidable (e.g. react-native-maps overlays, Reanimated configs).
 */
import { Platform } from "react-native";
import { Easing } from "react-native-reanimated";

// Mirrors tailwind.config.js borderRadius so non-NativeWind code (map
// overlays, canvas-drawn UI) can match the same roundedness.
export const radius = {
  sm: 12,
  md: 14,
  lg: 16,
  xl: 20,
  "2xl": 24,
  "3xl": 28,
  "4xl": 32,
} as const;

// Same three-tier shadow language as the web app's --shadow-card /
// --shadow-elevated (frontend/src/styles.css), translated to RN's platform-
// specific shadow model.
function shadow(elevation: number, iosOpacity: number, iosRadius: number, iosOffsetY: number) {
  return Platform.select({
    android: { elevation },
    ios: {
      shadowColor: "#000000",
      shadowOpacity: iosOpacity,
      shadowRadius: iosRadius,
      shadowOffset: { width: 0, height: iosOffsetY },
    },
    default: {},
  });
}

export const shadows = {
  card: shadow(2, 0.06, 4, 1),
  elevated: shadow(6, 0.12, 12, 4),
  floating: shadow(10, 0.18, 20, 8),
} as const;

// Reanimated timing — durations in ms, paired with an easing curve so
// motion feels consistent across screens instead of each component picking
// its own numbers.
export const duration = {
  fast: 150,
  base: 250,
  slow: 400,
} as const;

export const easing = {
  standard: Easing.bezier(0.2, 0, 0, 1),
  decelerate: Easing.out(Easing.cubic),
  accelerate: Easing.in(Easing.cubic),
} as const;

// WCAG 2.5.5 / Material minimum — every Pressable should hit at least this,
// via hitSlop if the visual element itself is smaller.
export const MIN_TOUCH_TARGET = 44;
