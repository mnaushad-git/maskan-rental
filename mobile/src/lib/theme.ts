/**
 * Design principles (myHome mobile) — the "why" behind the tokens below and
 * the components built on top of them:
 *  1. Map-first, content-second. The map is the primary surface on Home; UI
 *     that floats over it (sheets, pins, cards) must stay light — no heavy
 *     blur/glass, since RN blur is expensive on mid-range Android and the
 *     app's own performance notes already flag low-end-device concerns.
 *  2. One accent color for actionable things, one accent for AI. `primary`
 *     is the only color that means "tap this"; `ai` is reserved for
 *     AI-attributed content (the advisor, match scores, recommendations) so
 *     users learn to recognize "the AI said this" at a glance.
 *  3. Premium means restrained, not decorated. Spacing and type hierarchy
 *     carry the "premium" feeling — not gradients, shadows, or animation.
 *     Default to the smallest shadow tier that reads as elevated (`card`
 *     before `elevated` before `floating`).
 *  4. Every list has three states, not two: loading (Skeleton), empty
 *     (EmptyState), and error (ErrorState) — never conflate empty-because-
 *     still-loading with empty-because-no-results (see the Search-screen
 *     bug fixed in the previous pass for exactly this).
 *
 * Design tokens that can't be expressed as Tailwind/NativeWind utility
 * classes — shadows (RN needs separate iOS shadow* props vs Android
 * `elevation`, not CSS box-shadow), animation timing (Reanimated takes JS
 * numbers, not CSS duration classes), z-index, and touch-target sizing.
 * Colors, radius, and font-size live in tailwind.config.js so components can
 * use className for those; reach for these only where a raw style prop is
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

// Stacking order for the floating/overlapping surfaces that show up across
// the app (map overlays, sheets, toasts). Named by role rather than by
// screen, so new floating UI can pick a tier without inventing a number —
// codifies values already in ad hoc use (e.g. index.tsx's map-card-open
// z-index of 20 and header z-index of 30).
export const zIndex = {
  base: 0,
  raised: 10, // a selected/active element within its own layer (e.g. the open map pin)
  overlay: 20, // content floating over the base layer (map preview cards, HomeSheet)
  header: 30, // persistent chrome that should stay above overlay content
  modal: 40, // BottomSheet / full modals
  toast: 50, // toasts always win — they're transient and time-boxed
} as const;
