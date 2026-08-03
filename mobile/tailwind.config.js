/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./app/**/*.{js,jsx,ts,tsx}", "./src/**/*.{js,jsx,ts,tsx}"],
  presets: [require("nativewind/preset")],
  theme: {
    extend: {
      colors: {
        // myHome brand palette: royal-blue primary + gold accent, cream surfaces.
        // Update by eye if the brand palette changes again.
        primary: "#2563EB",
        "primary-foreground": "#FFFFFF",
        "primary-soft": "#DBEAFE",
        secondary: "#B45309",
        "secondary-foreground": "#FFFFFF",
        sale: "#0F766E",
        background: "#FFFCF7",
        foreground: "#2B211A",
        surface: "#FDF6EC",
        "surface-2": "#F5EAD9",
        border: "#E7D9C4",
        "muted-foreground": "#79716B",
        destructive: "#DC2626",
        success: "#15803D",
        "success-foreground": "#FFFFFF",
        warning: "#B45309",
        "warning-foreground": "#451A03",
        info: "#0369A1",
        "info-foreground": "#FFFFFF",
        ai: "#7C3AED",
        "ai-soft": "#EDE9FE",
      },
      // Radius scale — same shape as the web app's --radius-{sm..4xl} tokens
      // (frontend/src/styles.css), so a "lg" card reads as the same relative
      // roundedness on both platforms even though the two apps have their
      // own base unit (web's base radius is 14px; mobile's is 16px — chosen
      // to look right against RN's typically-larger touch targets).
      borderRadius: {
        sm: 12,
        md: 14,
        lg: 16,
        xl: 20,
        "2xl": 24,
        "3xl": 28,
        "4xl": 32,
      },
      // Font-size scale with paired line-heights — RN has no CSS line-height
      // default the way browsers do, so text reads cramped without setting
      // this explicitly everywhere. Values in px (NativeWind maps these to
      // RN's unitless line-height as px, not em).
      fontSize: {
        xs: ["12px", { lineHeight: "16px" }],
        sm: ["14px", { lineHeight: "20px" }],
        base: ["16px", { lineHeight: "24px" }],
        lg: ["18px", { lineHeight: "26px" }],
        xl: ["20px", { lineHeight: "28px" }],
        "2xl": ["24px", { lineHeight: "32px" }],
        "3xl": ["30px", { lineHeight: "38px" }],
        "4xl": ["36px", { lineHeight: "44px" }],
      },
    },
  },
  plugins: [],
};
