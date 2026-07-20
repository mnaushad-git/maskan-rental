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
    },
  },
  plugins: [],
};
