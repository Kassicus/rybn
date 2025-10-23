import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        // Monday.com Vibe design system colors
        primary: {
          DEFAULT: "#5034FF",
          hover: "#6B54FF",
          selected: "#403399",
          50: "#F5F3FF",
          100: "#EBE7FF",
          200: "#D9D2FF",
          300: "#C7B8FF",
          400: "#9D85FF",
          500: "#5034FF",
          600: "#403399",
          700: "#332980",
          800: "#261F66",
          900: "#1A154D",
        },
        success: {
          DEFAULT: "#00C875",
          hover: "#00B36B",
          light: "#E6FCF5",
        },
        error: {
          DEFAULT: "#E2445C",
          hover: "#D63A52",
          light: "#FFEBEE",
        },
        warning: {
          DEFAULT: "#FDAB3D",
          hover: "#FC9D26",
          light: "#FFF4E5",
        },
        // Light mode
        light: {
          background: "#FFFFFF",
          "background-secondary": "#F6F7FB",
          "background-hover": "#F5F6F8",
          border: "#D0D4E4",
          "text-primary": "#323338",
          "text-secondary": "#676879",
          "text-tertiary": "#9699A6",
        },
        // Dark mode - proper Vibe colors
        dark: {
          background: "#181B34",        // Dark blue-gray (Vibe standard)
          "background-secondary": "#292F4C", // Slightly lighter
          "background-hover": "#323850",     // Hover state
          border: "#525768",                 // Lighter border for visibility
          "text-primary": "#FFFFFF",         // White text
          "text-secondary": "#C5C7D0",       // Light gray
          "text-tertiary": "#9699A6",        // Medium gray
        },
      },
      borderRadius: {
        sm: "4px",
        DEFAULT: "6px",
        md: "8px",
        lg: "12px",
        xl: "16px",
      },
      boxShadow: {
        sm: "0px 4px 6px rgba(0, 0, 0, 0.04)",
        DEFAULT: "0px 6px 20px rgba(0, 0, 0, 0.08)",
        md: "0px 8px 24px rgba(0, 0, 0, 0.12)",
        lg: "0px 12px 32px rgba(0, 0, 0, 0.16)",
      },
      fontFamily: {
        sans: [
          "var(--font-figtree)",
          "var(--font-inter)",
          "-apple-system",
          "BlinkMacSystemFont",
          "Segoe UI",
          "Roboto",
          "Helvetica Neue",
          "Arial",
          "sans-serif",
        ],
      },
      fontWeight: {
        light: "300",
        normal: "400",
        medium: "500",
        semibold: "600",
        bold: "700",
      },
      fontSize: {
        // Vibe design system typography scale
        xs: ["12px", { lineHeight: "16px", letterSpacing: "0.01em", fontWeight: "400" }],
        sm: ["14px", { lineHeight: "20px", letterSpacing: "0.01em", fontWeight: "400" }],
        base: ["16px", { lineHeight: "24px", letterSpacing: "0", fontWeight: "400" }],
        lg: ["18px", { lineHeight: "28px", letterSpacing: "-0.01em", fontWeight: "400" }],
        xl: ["20px", { lineHeight: "28px", letterSpacing: "-0.01em", fontWeight: "500" }],
        "2xl": ["24px", { lineHeight: "32px", letterSpacing: "-0.02em", fontWeight: "600" }],
        "3xl": ["30px", { lineHeight: "36px", letterSpacing: "-0.02em", fontWeight: "600" }],
        "4xl": ["36px", { lineHeight: "40px", letterSpacing: "-0.02em", fontWeight: "600" }],
      },
      spacing: {
        xs: "4px",
        sm: "8px",
        md: "16px",
        lg: "24px",
        xl: "32px",
        "2xl": "40px",
        "3xl": "48px",
      },
    },
  },
  plugins: [],
};

export default config;
