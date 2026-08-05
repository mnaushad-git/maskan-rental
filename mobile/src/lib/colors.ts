/**
 * Mirrors tailwind.config.js's `colors` so non-className code (icon `color`
 * props, RN `style` objects — NativeWind classNames don't reach either)
 * can reference the same palette instead of hardcoding hex. Same pattern
 * theme.ts already uses for `radius` mirroring tailwind's borderRadius.
 * Keep in sync with tailwind.config.js by hand if the palette changes.
 */
export const colors = {
  primary: "#2563EB",
  primaryForeground: "#FFFFFF",
  primarySoft: "#DBEAFE",
  secondary: "#B45309",
  secondaryForeground: "#FFFFFF",
  sale: "#0F766E",
  background: "#FFFCF7",
  foreground: "#2B211A",
  surface: "#FDF6EC",
  surface2: "#F5EAD9",
  border: "#E7D9C4",
  mutedForeground: "#79716B",
  destructive: "#DC2626",
  success: "#15803D",
  successForeground: "#FFFFFF",
  warning: "#B45309",
  warningForeground: "#451A03",
  info: "#0369A1",
  infoForeground: "#FFFFFF",
  ai: "#7C3AED",
  aiSoft: "#EDE9FE",

  // Fixed third-party brand marks — not part of the adaptive theme palette
  // above, so kept separate (mirrors frontend/src/styles.css's --whatsapp).
  whatsapp: "#25D366",
  whatsappForeground: "#128C7E",

  // Neutral tones used for icons/placeholders that need to read as
  // "quieter than mutedForeground" — not in tailwind.config.js's named
  // scale, but in ad hoc use across the app before this file existed.
  neutral400: "#A8A29E",
} as const;
