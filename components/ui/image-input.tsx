"use client";

import * as React from "react";
import { useState, useRef, useEffect } from "react";
import { cn } from "@/lib/utils";
import { Input } from "./input";
import { Text } from "./text";
import { useSupabase } from "@/lib/supabase/use-supabase";
import { isExternalImageUrl } from "@/lib/storage/image-value";

/**
 * Two fields, two jobs.
 *
 * `value` is what gets STORED: either an external image URL the user pasted, or
 * an object path inside a private bucket (`<clerk id>/<file>`). It is what
 * onChange emits and what the server writes to the row.
 *
 * `previewUrl` is what gets RENDERED when `value` is a path: a short-lived
 * signed URL minted by the server action that returned this row. A private
 * object has no stable URL, so the component cannot derive one -- and must not
 * try, because signing needs the service-role key.
 *
 * Immediately after an upload neither applies: the file is in the browser
 * already, so the preview is a local object URL and stays that way until the
 * component unmounts or the value is replaced. That is why the upload no longer
 * revokes it on success -- it is now the thing on screen, not a placeholder for
 * one.
 */
interface ImageInputProps {
  value?: string | null;
  previewUrl?: string | null;
  onChange: (value: string | null) => void;
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
  previewUrl,
  onChange,
  bucket,
  userId,
  error,
  className,
  disabled,
}: ImageInputProps) {
  const [isUploading, setIsUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [localPreview, setLocalPreview] = useState<string | null>(null);
  const [urlValue, setUrlValue] = useState<string>(() =>
    isExternalImageUrl(value) ? value : ""
  );
  const fileInputRef = useRef<HTMLInputElement>(null);
  const objectUrlRef = useRef<string | null>(null);
  const supabase = useSupabase();

  // The object URL is a document-lifetime resource; nothing else frees it.
  const releaseLocalPreview = () => {
    if (objectUrlRef.current) {
      URL.revokeObjectURL(objectUrlRef.current);
      objectUrlRef.current = null;
    }
  };

  useEffect(() => releaseLocalPreview, []);

  // An object path in one of our buckets, as opposed to a pasted URL.
  const storedPath = value && !isExternalImageUrl(value) ? value : null;
  const uploadPreviewSrc = localPreview ?? (storedPath ? previewUrl ?? null : null);
  const hasUpload = localPreview !== null || storedPath !== null;

  const handleUrlChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const url = e.target.value;
    setUrlValue(url);
    setUploadError(null);

    // Typing a URL replaces any upload.
    if (url) {
      releaseLocalPreview();
      setLocalPreview(null);
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

    // Show local preview immediately. It stays for the life of this form: the
    // uploaded object is private, so there is nothing to swap it for until the
    // server hands back a signed URL on the next load.
    releaseLocalPreview();
    const objectUrl = URL.createObjectURL(file);
    objectUrlRef.current = objectUrl;
    setLocalPreview(objectUrl);

    // Clear URL field when uploading
    setUrlValue("");

    setIsUploading(true);

    try {
      // Folder-scoped to the uploader, which is what the storage INSERT policy
      // requires -- (storage.foldername(name))[1] = requesting_user_id().
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

      // Store the PATH, not a URL. The bucket is private: there is no public
      // URL to store, and a signed one would expire inside the row.
      onChange(data.path);
    } catch (err) {
      console.error("Upload error:", err);
      setUploadError(err instanceof Error ? err.message : "Failed to upload image");
      releaseLocalPreview();
      setLocalPreview(null);
    } finally {
      setIsUploading(false);
    }
  };

  const handleRemoveUpload = () => {
    onChange(null);
    releaseLocalPreview();
    setLocalPreview(null);
    setUploadError(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
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
        {urlValue && !hasUpload && (
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
        {hasUpload ? (
          <div className="relative inline-block">
            {uploadPreviewSrc ? (
              <img
                src={uploadPreviewSrc}
                alt="Uploaded preview"
                className="w-32 h-32 object-cover rounded-lg border border-light-border"
              />
            ) : (
              // A stored image whose signed URL could not be minted -- expired
              // link, or the object is gone. Say so rather than rendering a
              // broken <img>, and keep the remove button reachable.
              <div className="w-32 h-32 rounded-lg border border-light-border bg-light-ui flex items-center justify-center p-2 text-center">
                <Text size="sm" variant="secondary">
                  Image attached (preview unavailable)
                </Text>
              </div>
            )}
            <button
              type="button"
              onClick={handleRemoveUpload}
              disabled={disabled || isUploading}
              className="absolute -top-2 -right-2 w-6 h-6 bg-error text-white rounded-full flex items-center justify-center text-sm hover:bg-error/80 transition-colors"
            >
              x
            </button>
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
