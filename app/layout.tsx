import type { Metadata } from "next";
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
