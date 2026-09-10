import type { Config } from "tailwindcss";

// Every colour resolves through a CSS variable defined in app/globals.css.
// The
// `rgb(var(--x) / <alpha-value>)` wrapper is what preserves opacity modifiers
// (bg-primary/10, bg-light-background/95) -- a bare var() holding hex breaks
// them silently.
const c = (name: string) => `rgb(var(--${name}) / <alpha-value>)`;

const config: Config = {
  content: [
    "./pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        // --- Evergreen & Cranberry, semantic names for new work -------------
        ground: c("ground"),
        surface: {
          DEFAULT: c("surface"),
          hover: c("surface-hover"),
        },
        line: c("line"),
        muted: c("fill-muted"),
        ink: {
          DEFAULT: c("ink"),
          soft: c("ink-soft"),
          muted: c("ink-muted"),
        },
        accent: {
          DEFAULT: c("accent"),
          hover: c("accent-hover"),
          ink: c("accent-ink"),
          tint: c("tint-accent"),
        },
        gold: {
          DEFAULT: c("gold"),
          ink: c("gold-ink"),
          tint: c("tint-gold"),
        },
        hero: {
          DEFAULT: c("hero"),
          line: c("hero-line"),
          ink: c("hero-ink"),
          soft: c("hero-ink-soft"),
          stat: c("hero-stat"),
        },
        control: {
          line: c("control-line"),
        },

        // --- Existing names, repointed at the new palette -------------------
        // 600+ usages across the app read these, so they are remapped rather
        // than renamed: every screen picks up the new palette and dark mode
        // without being touched. The `light.*` prefix is now a misnomer (it
        // flips with the theme) and is worth renaming in a later pass.
        primary: {
          DEFAULT: c("primary"),
          hover: c("primary-hover"),
          selected: c("primary-600"),
          50: c("primary-50"),
          100: c("primary-100"),
          200: c("primary-200"),
          300: c("primary-200"),
          400: c("primary-500"),
          500: c("primary-500"),
          600: c("primary-600"),
          700: c("primary-700"),
          800: c("primary-700"),
          900: c("primary-700"),
        },
        light: {
          background: c("surface"),
          "background-secondary": c("ground"),
          "background-hover": c("surface-hover"),
          border: c("line"),
          "text-primary": c("ink"),
          "text-secondary": c("ink-soft"),
          "text-tertiary": c("ink-muted"),
        },
        success: {
          DEFAULT: c("success"),
          hover: c("success"),
          light: c("success-tint"),
          dark: c("success"),
        },
        error: {
          DEFAULT: c("error"),
          hover: c("error"),
          light: c("error-tint"),
          dark: c("error"),
        },
        warning: {
          DEFAULT: c("warning"),
          hover: c("warning"),
          light: c("warning-tint"),
          dark: c("warning"),
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
        DEFAULT: "0px 6px 20px rgba(20, 67, 42, 0.08)",
        md: "0px 8px 24px rgba(20, 67, 42, 0.12)",
        lg: "0px 12px 32px rgba(20, 67, 42, 0.16)",
        gift: "0px 8px 32px rgba(20, 67, 42, 0.15)",
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
        // Lora carries headings and figures. Georgia is the fallback because
        // its metrics are close enough that a swap does not reflow the page.
        display: ["var(--font-lora)", "Georgia", "Times New Roman", "serif"],
        heading: ["Playwrite DE SAS", "cursive"],
      },
      fontWeight: {
        light: "300",
        normal: "400",
        medium: "500",
        semibold: "600",
        bold: "700",
      },
      fontSize: {
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
