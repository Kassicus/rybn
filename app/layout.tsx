import type { Metadata, Viewport } from "next";
import { Quicksand, Lora } from "next/font/google";
import { Analytics } from "@vercel/analytics/next";
import { ClerkProvider } from "@clerk/nextjs";
import "@fontsource/playwrite-de-sas/400.css";
import "./globals.css";
import { QueryProvider } from "@/components/providers/QueryProvider";

// Rybn brand font: Quicksand for body text
const quicksand = Quicksand({
  subsets: ["latin"],
  weight: ["300", "400", "500", "600", "700"],
  variable: "--font-quicksand",
  display: "swap",
});

// Headings and figures. Loaded here rather than per-page so the swap happens
// once; Georgia is the fallback in tailwind.config.ts because its metrics are
// close enough not to reflow.
const lora = Lora({
  subsets: ["latin"],
  weight: ["500", "600"],
  variable: "--font-lora",
  display: "swap",
});

/**
 * Declares the page as light-only.
 *
 * Without this, a browser treats the page as "works in either scheme" and
 * renders form controls, placeholder text, scroll areas and the address-bar
 * tint using the SYSTEM appearance. On a phone set to dark mode that reads as
 * a half-applied dark theme -- which is exactly what it looked like -- even
 * though the stylesheet has no dark rules at all.
 *
 * Docs: node_modules/next/dist/docs/01-app/03-api-reference/04-functions/generate-viewport.md
 */
export const viewport: Viewport = {
  colorScheme: "light",
};

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
    <html lang="en" className={`${quicksand.variable} ${lora.variable}`}>
      <body className={`${quicksand.className} overflow-x-hidden`}>
        <ClerkProvider>
          <QueryProvider>
            {children}
            <Analytics />
          </QueryProvider>
        </ClerkProvider>
      </body>
    </html>
  );
}
