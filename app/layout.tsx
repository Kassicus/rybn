import type { Metadata } from "next";
import { Inter, Figtree } from "next/font/google";
import { RybnThemeProvider } from "@/components/vibe/ThemeProvider";
import "./globals.css";

// Monday.com Vibe uses Figtree (or similar modern sans-serif)
const figtree = Figtree({
  subsets: ["latin"],
  weight: ["300", "400", "500", "600", "700"],
  variable: "--font-figtree",
  display: "swap",
});

// Fallback: Inter is also excellent and similar
const inter = Inter({
  subsets: ["latin"],
  weight: ["300", "400", "500", "600", "700"],
  variable: "--font-inter",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Rybn - Tied Together",
  description: "Gift giving, beautifully wrapped",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning className={`${figtree.variable} ${inter.variable}`}>
      <body className={figtree.className}>
        <RybnThemeProvider>{children}</RybnThemeProvider>
      </body>
    </html>
  );
}
