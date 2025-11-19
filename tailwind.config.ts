import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        // Rybn brand colors
        primary: {
          DEFAULT: "#009E01",
          hover: "#00B501",
          selected: "#007A01",
          50: "#E6F9E6",
          100: "#CCFACC",
          200: "#99F099",
          300: "#66E666",
          400: "#33D133",
          500: "#009E01",
          600: "#007A01",
          700: "#006001",
          800: "#004701",
          900: "#002D01",
        },
        success: {
          DEFAULT: "#00C875",
          hover: "#00B36B",
          light: "#E6FCF5",
          dark: "#003D2E",
        },
        error: {
          DEFAULT: "#E2445C",
          hover: "#D63A52",
          light: "#FFEBEE",
          dark: "#3D0A15",
        },
        warning: {
          DEFAULT: "#FDAB3D",
          hover: "#FC9D26",
          light: "#FFF4E5",
          dark: "#3D2810",
        },
        // Rybn light mode colors
        light: {
          background: "#FFFFFF",
          "background-secondary": "#F6F7FB",
          "background-hover": "#F5F6F8",
          border: "#D0D4E4",
          "text-primary": "#323338",
          "text-secondary": "#676879",
          "text-tertiary": "#9699A6",
        },
      },
      borderRadius: {
        sm: "6px",
        DEFAULT: "12px",
        md: "16px",
        lg: "20px",
        xl: "24px",
        "2xl": "32px",
      },
      boxShadow: {
        sm: "0px 4px 6px rgba(0, 0, 0, 0.04)",
        DEFAULT: "0px 6px 20px rgba(0, 158, 1, 0.08)",
        md: "0px 8px 24px rgba(0, 158, 1, 0.12)",
        lg: "0px 12px 32px rgba(0, 158, 1, 0.16)",
        "gift": "0px 8px 32px rgba(0, 158, 1, 0.15)",
      },
      fontFamily: {
        sans: [
          "var(--font-quicksand)",
          "-apple-system",
          "BlinkMacSystemFont",
          "Segoe UI",
          "Roboto",
          "Helvetica Neue",
          "Arial",
          "sans-serif",
        ],
        heading: [
          "Playwrite DE SAS",
          "cursive",
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
