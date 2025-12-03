"use client";

import { App, URLOpenListenerEvent } from "@capacitor/app";
import { Browser } from "@capacitor/browser";
import { isNativeApp } from "./bridge";

type RouterPush = (url: string) => void;

/**
 * Set up deep link handler for the Capacitor app
 * Call this in your root layout or _app component
 */
export function setupDeepLinkHandler(routerPush: RouterPush): () => void {
  if (!isNativeApp()) {
    // Return no-op cleanup function on web
    return () => {};
  }

  const handleUrlOpen = async (event: URLOpenListenerEvent) => {
    try {
      const url = new URL(event.url);

      // Handle OAuth callback
      if (url.pathname === "/auth/callback") {
        // Close the in-app browser if it's open
        try {
          await Browser.close();
        } catch {
          // Browser might not be open, ignore
        }

        // Get the auth code from the URL
        const code = url.searchParams.get("code");
        const error = url.searchParams.get("error");

        if (error) {
          console.error("OAuth error:", error);
          routerPush("/login?error=" + encodeURIComponent(error));
          return;
        }

        if (code) {
          // Navigate to the callback with the auth code
          routerPush(`/auth/callback?code=${code}`);
          return;
        }
      }

      // Handle other deep links (profile, wishlist, groups, etc.)
      const pathsToHandle = [
        "/dashboard",
        "/profile",
        "/wishlist",
        "/groups",
        "/gifts",
        "/gift-exchange",
        "/settings",
        "/accept-invite",
      ];

      for (const path of pathsToHandle) {
        if (url.pathname.startsWith(path)) {
          routerPush(url.pathname + url.search);
          return;
        }
      }

      // Default: navigate to the path
      if (url.pathname && url.pathname !== "/") {
        routerPush(url.pathname + url.search);
      }
    } catch (error) {
      console.error("Error handling deep link:", error);
    }
  };

  // Add the listener
  App.addListener("appUrlOpen", handleUrlOpen);

  // Return cleanup function
  return () => {
    App.removeAllListeners();
  };
}

/**
 * Handle app state changes (background/foreground)
 */
export function setupAppStateHandler(
  onResume?: () => void,
  onPause?: () => void
): () => void {
  if (!isNativeApp()) {
    return () => {};
  }

  if (onResume) {
    App.addListener("resume", onResume);
  }

  if (onPause) {
    App.addListener("pause", onPause);
  }

  return () => {
    App.removeAllListeners();
  };
}

/**
 * Open a URL in the in-app browser (for OAuth)
 */
export async function openInAppBrowser(url: string): Promise<void> {
  if (!isNativeApp()) {
    // On web, just navigate normally
    window.location.href = url;
    return;
  }

  await Browser.open({
    url,
    presentationStyle: "popover",
    toolbarColor: "#009E01", // Rybn primary color
  });
}

/**
 * Close the in-app browser
 */
export async function closeInAppBrowser(): Promise<void> {
  if (!isNativeApp()) {
    return;
  }

  try {
    await Browser.close();
  } catch {
    // Browser might not be open
  }
}
