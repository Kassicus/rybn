"use client";

import { Capacitor } from "@capacitor/core";

/**
 * Check if the app is running in a native Capacitor environment
 */
export function isNativeApp(): boolean {
  return Capacitor.isNativePlatform();
}

/**
 * Get the current platform: 'ios', 'android', or 'web'
 */
export function getPlatform(): "ios" | "android" | "web" {
  return Capacitor.getPlatform() as "ios" | "android" | "web";
}

/**
 * Check if the app is running on iOS
 */
export function isIOS(): boolean {
  return Capacitor.getPlatform() === "ios";
}

/**
 * Check if the app is running on Android
 */
export function isAndroid(): boolean {
  return Capacitor.getPlatform() === "android";
}

/**
 * Check if the app is running on web
 */
export function isWeb(): boolean {
  return Capacitor.getPlatform() === "web";
}

/**
 * Check if a specific plugin is available
 */
export function isPluginAvailable(pluginName: string): boolean {
  return Capacitor.isPluginAvailable(pluginName);
}
