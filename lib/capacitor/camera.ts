"use client";

import { Camera, CameraResultType, CameraSource } from "@capacitor/camera";
import { isNativeApp, isPluginAvailable } from "./bridge";

export interface CapturedImage {
  dataUrl: string;
  format: string;
  blob?: Blob;
}

/**
 * Capture an image from the camera or photo library
 * Returns null if not on a native platform or if capture fails
 */
export async function captureImage(
  source: "camera" | "photos" = "camera"
): Promise<CapturedImage | null> {
  // Only use native camera on iOS/Android
  if (!isNativeApp() || !isPluginAvailable("Camera")) {
    return null;
  }

  try {
    const image = await Camera.getPhoto({
      quality: 85,
      allowEditing: false,
      resultType: CameraResultType.DataUrl,
      source: source === "camera" ? CameraSource.Camera : CameraSource.Photos,
      correctOrientation: true,
      width: 1200,
      height: 1200,
      presentationStyle: "popover",
    });

    if (image.dataUrl) {
      return {
        dataUrl: image.dataUrl,
        format: image.format || "jpeg",
      };
    }

    return null;
  } catch (error) {
    // User cancelled or permission denied
    console.error("Camera capture failed:", error);
    return null;
  }
}

/**
 * Convert a data URL to a Blob for upload
 */
export async function dataUrlToBlob(dataUrl: string): Promise<Blob> {
  const response = await fetch(dataUrl);
  return response.blob();
}

/**
 * Convert a data URL to a File for upload
 */
export async function dataUrlToFile(
  dataUrl: string,
  filename: string
): Promise<File> {
  const blob = await dataUrlToBlob(dataUrl);
  const extension = dataUrl.split(";")[0].split("/")[1] || "jpeg";
  return new File([blob], `${filename}.${extension}`, {
    type: blob.type || `image/${extension}`,
  });
}

/**
 * Check if camera permission is granted
 */
export async function checkCameraPermission(): Promise<boolean> {
  if (!isNativeApp() || !isPluginAvailable("Camera")) {
    return false;
  }

  try {
    const status = await Camera.checkPermissions();
    return status.camera === "granted" && status.photos === "granted";
  } catch {
    return false;
  }
}

/**
 * Request camera permission
 */
export async function requestCameraPermission(): Promise<boolean> {
  if (!isNativeApp() || !isPluginAvailable("Camera")) {
    return false;
  }

  try {
    const status = await Camera.requestPermissions({
      permissions: ["camera", "photos"],
    });
    return status.camera === "granted" && status.photos === "granted";
  } catch {
    return false;
  }
}
