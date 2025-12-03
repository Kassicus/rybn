"use client";

import * as React from "react";
import { useState, useRef, useEffect } from "react";
import { Camera, ImagePlus } from "lucide-react";
import { cn } from "@/lib/utils";
import { Input } from "./input";
import { Text } from "./text";
import { Button } from "./button";
import { createClient } from "@/lib/supabase/client";
import { isNativeApp } from "@/lib/capacitor/bridge";
import { captureImage, dataUrlToFile } from "@/lib/capacitor/camera";

interface ImageInputProps {
  value?: string | null;
  onChange: (url: string | null) => void;
  bucket: "wishlist-images" | "gift-photos";
  userId: string;
  error?: string;
  className?: string;
  disabled?: boolean;
}

const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB
const ACCEPTED_TYPES = ["image/jpeg", "image/png", "image/gif", "image/webp"];

export function ImageInput({
  value,
  onChange,
  bucket,
  userId,
  error,
  className,
  disabled,
}: ImageInputProps) {
  const [isUploading, setIsUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [uploadedPreview, setUploadedPreview] = useState<string | null>(null);
  const [urlValue, setUrlValue] = useState<string>("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Determine if the current value is from an upload (supabase URL) or external URL
  const isSupabaseUrl = value?.includes("supabase.co/storage");

  // Initialize state based on current value
  useEffect(() => {
    if (value) {
      if (isSupabaseUrl) {
        setUploadedPreview(value);
        setUrlValue("");
      } else {
        setUrlValue(value);
        setUploadedPreview(null);
      }
    }
  }, []);

  const handleUrlChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const url = e.target.value;
    setUrlValue(url);
    setUploadError(null);

    // Clear uploaded preview when user types a URL
    if (url) {
      setUploadedPreview(null);
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    }

    onChange(url || null);
  };

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploadError(null);

    // Validate file type
    if (!ACCEPTED_TYPES.includes(file.type)) {
      setUploadError("Please select a valid image (JPEG, PNG, GIF, or WebP)");
      return;
    }

    // Validate file size
    if (file.size > MAX_FILE_SIZE) {
      setUploadError("Image must be less than 5MB");
      return;
    }

    // Show local preview immediately
    const localPreview = URL.createObjectURL(file);
    setUploadedPreview(localPreview);

    // Clear URL field when uploading
    setUrlValue("");

    setIsUploading(true);

    try {
      const supabase = createClient();

      // Generate unique filename
      const fileExt = file.name.split(".").pop();
      const fileName = `${userId}/${Date.now()}-${Math.random().toString(36).substring(2)}.${fileExt}`;

      // Upload to Supabase Storage
      const { data, error: uploadErr } = await supabase.storage
        .from(bucket)
        .upload(fileName, file, {
          cacheControl: "3600",
          upsert: false,
        });

      if (uploadErr) {
        throw uploadErr;
      }

      // Get public URL
      const { data: { publicUrl } } = supabase.storage
        .from(bucket)
        .getPublicUrl(data.path);

      onChange(publicUrl);
      setUploadedPreview(publicUrl);

      // Clean up local preview
      URL.revokeObjectURL(localPreview);
    } catch (err) {
      console.error("Upload error:", err);
      setUploadError(err instanceof Error ? err.message : "Failed to upload image");
      setUploadedPreview(null);
      URL.revokeObjectURL(localPreview);
    } finally {
      setIsUploading(false);
    }
  };

  const handleRemoveUpload = () => {
    onChange(null);
    setUploadedPreview(null);
    setUploadError(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  // Handle native camera capture (iOS/Android)
  const handleNativeCapture = async (source: "camera" | "photos") => {
    setUploadError(null);

    const result = await captureImage(source);
    if (!result) {
      // User cancelled or not on native platform
      return;
    }

    // Show preview immediately
    setUploadedPreview(result.dataUrl);
    setUrlValue("");
    setIsUploading(true);

    try {
      // Convert data URL to File
      const file = await dataUrlToFile(result.dataUrl, `capture-${Date.now()}`);

      // Validate file size
      if (file.size > MAX_FILE_SIZE) {
        setUploadError("Image must be less than 5MB");
        setUploadedPreview(null);
        return;
      }

      const supabase = createClient();

      // Generate unique filename
      const fileExt = result.format || "jpeg";
      const fileName = `${userId}/${Date.now()}-${Math.random().toString(36).substring(2)}.${fileExt}`;

      // Upload to Supabase Storage
      const { data, error: uploadErr } = await supabase.storage
        .from(bucket)
        .upload(fileName, file, {
          cacheControl: "3600",
          upsert: false,
        });

      if (uploadErr) {
        throw uploadErr;
      }

      // Get public URL
      const {
        data: { publicUrl },
      } = supabase.storage.from(bucket).getPublicUrl(data.path);

      onChange(publicUrl);
      setUploadedPreview(publicUrl);
    } catch (err) {
      console.error("Upload error:", err);
      setUploadError(
        err instanceof Error ? err.message : "Failed to upload image"
      );
      setUploadedPreview(null);
    } finally {
      setIsUploading(false);
    }
  };

  const displayError = uploadError || error;

  return (
    <div className={cn("space-y-4", className)}>
      {/* URL Input */}
      <div>
        <Input
          type="url"
          placeholder="https://example.com/image.jpg"
          value={urlValue}
          onChange={handleUrlChange}
          disabled={disabled || isUploading}
        />
        {urlValue && !uploadedPreview && (
          <div className="mt-3">
            <img
              src={urlValue}
              alt="Preview"
              className="w-32 h-32 object-cover rounded-lg border border-light-border"
              onError={(e) => {
                (e.target as HTMLImageElement).style.display = 'none';
              }}
              onLoad={(e) => {
                (e.target as HTMLImageElement).style.display = 'block';
              }}
            />
          </div>
        )}
      </div>

      {/* OR Divider */}
      <div className="flex items-center gap-3">
        <div className="flex-1 h-px bg-light-border" />
        <Text size="sm" variant="secondary" className="font-medium">
          OR
        </Text>
        <div className="flex-1 h-px bg-light-border" />
      </div>

      {/* Upload Area */}
      <div>
        {uploadedPreview ? (
          <div className="relative inline-block">
            <img
              src={uploadedPreview}
              alt="Uploaded preview"
              className="w-32 h-32 object-cover rounded-lg border border-light-border"
            />
            <button
              type="button"
              onClick={handleRemoveUpload}
              disabled={disabled || isUploading}
              className="absolute -top-2 -right-2 w-6 h-6 bg-error text-white rounded-full flex items-center justify-center text-sm hover:bg-error/80 transition-colors"
            >
              x
            </button>
          </div>
        ) : isNativeApp() ? (
          // Native app: Show camera and photo library buttons
          <div className="space-y-3">
            <div className="flex gap-3">
              <Button
                type="button"
                variant="secondary"
                onClick={() => handleNativeCapture("camera")}
                disabled={disabled || isUploading}
                className="flex-1"
              >
                <Camera className="w-4 h-4 mr-2" />
                Take Photo
              </Button>
              <Button
                type="button"
                variant="secondary"
                onClick={() => handleNativeCapture("photos")}
                disabled={disabled || isUploading}
                className="flex-1"
              >
                <ImagePlus className="w-4 h-4 mr-2" />
                Photo Library
              </Button>
            </div>
            {isUploading && (
              <div className="flex items-center justify-center gap-2 py-4">
                <svg
                  className="w-5 h-5 text-light-text-secondary animate-spin"
                  fill="none"
                  viewBox="0 0 24 24"
                >
                  <circle
                    className="opacity-25"
                    cx="12"
                    cy="12"
                    r="10"
                    stroke="currentColor"
                    strokeWidth="4"
                  />
                  <path
                    className="opacity-75"
                    fill="currentColor"
                    d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
                  />
                </svg>
                <Text size="sm" variant="secondary">
                  Uploading...
                </Text>
              </div>
            )}
          </div>
        ) : (
          // Web: Show file input
          <label
            className={cn(
              "flex flex-col items-center justify-center w-full h-32 border-2 border-dashed rounded-lg cursor-pointer transition-colors",
              disabled || isUploading
                ? "border-light-border bg-light-ui cursor-not-allowed"
                : "border-light-border hover:border-primary hover:bg-primary-50"
            )}
          >
            <div className="flex flex-col items-center justify-center pt-5 pb-6">
              {isUploading ? (
                <>
                  <svg
                    className="w-8 h-8 text-light-text-secondary animate-spin"
                    fill="none"
                    viewBox="0 0 24 24"
                  >
                    <circle
                      className="opacity-25"
                      cx="12"
                      cy="12"
                      r="10"
                      stroke="currentColor"
                      strokeWidth="4"
                    />
                    <path
                      className="opacity-75"
                      fill="currentColor"
                      d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
                    />
                  </svg>
                  <Text size="sm" variant="secondary" className="mt-2">
                    Uploading...
                  </Text>
                </>
              ) : (
                <>
                  <svg
                    className="w-8 h-8 text-light-text-secondary"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"
                    />
                  </svg>
                  <Text size="sm" variant="secondary" className="mt-2">
                    Click to upload image
                  </Text>
                  <Text size="sm" variant="secondary">
                    JPEG, PNG, GIF, WebP (max 5MB)
                  </Text>
                </>
              )}
            </div>
            <input
              ref={fileInputRef}
              type="file"
              className="hidden"
              accept={ACCEPTED_TYPES.join(",")}
              onChange={handleFileSelect}
              disabled={disabled || isUploading}
            />
          </label>
        )}
      </div>

      {/* Error Message */}
      {displayError && (
        <Text size="sm" variant="error">
          {displayError}
        </Text>
      )}
    </div>
  );
}
