/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./app/**/*.{js,jsx,ts,tsx}", "./src/**/*.{js,jsx,ts,tsx}"],
  presets: [require("nativewind/preset")],
  theme: {
    extend: {
      colors: {
        // Mirrors frontend/src/styles.css (oklch tokens converted to hex —
        // RN's style engine can't parse oklch()). Keep in sync by eye when
        // the web theme changes; primary/sale match the map-pin colors in
        // frontend/src/components/maskan/PropertyMapView.tsx exactly.
        primary: "#16A34A",
        "primary-foreground": "#FFFFFF",
        "primary-soft": "#DCFCE7",
        secondary: "#2563EB",
        "secondary-foreground": "#FFFFFF",
        sale: "#D97706",
        background: "#FFFFFF",
        foreground: "#0F172A",
        surface: "#F8FAFC",
        "surface-2": "#F1F5F9",
        border: "#E2E8F0",
        "muted-foreground": "#64748B",
        destructive: "#DC2626",
        success: "#16A34A",
        "success-foreground": "#FFFFFF",
        warning: "#D97706",
        "warning-foreground": "#451A03",
        info: "#2563EB",
        "info-foreground": "#FFFFFF",
        ai: "#7C3AED",
        "ai-soft": "#EDE9FE",
      },
    },
  },
  plugins: [],
};
