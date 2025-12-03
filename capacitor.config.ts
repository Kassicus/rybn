import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "app.rybn.ios",
  appName: "Rybn",
  webDir: "out",
  server: {
    // Point to your Vercel deployment
    url: "https://rybn.app",
    cleartext: false,
    // Allow navigation to auth providers
    allowNavigation: [
      "rybn.app",
      "*.rybn.app",
      "*.supabase.co",
      "accounts.google.com",
      "*.google.com",
    ],
  },
  ios: {
    scheme: "Rybn",
    preferredContentMode: "mobile",
    allowsLinkPreview: false,
    scrollEnabled: true,
  },
  plugins: {
    Camera: {
      // Use Photos framework for better performance
      presentationStyle: "popover",
    },
    Browser: {
      // Configure in-app browser for OAuth
    },
  },
};

export default config;
