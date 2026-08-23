"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { wishlistItemSchema, type WishlistItemFormData, PRIORITY_INFO } from "@/lib/schemas/wishlist";
import { createWishlistItem } from "@/lib/actions/wishlist";
import { fetchLinkMetadata } from "@/lib/actions/link-metadata";
import { useUser } from "@clerk/nextjs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Heading, Text } from "@/components/ui/text";
import { ImageInput } from "@/components/ui/image-input";
import { BreadcrumbSetter } from "@/components/layout/BreadcrumbSetter";
import { WishlistPrivacySelector } from "@/components/wishlist/WishlistPrivacySelector";
import { FormSection } from "@/components/profile/FormSection";
import type { PrivacyLevel } from "@/types/privacy";

export default function AddWishlistItemPage() {
  const router = useRouter();
  const { user } = useUser();
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    formState: { errors, dirtyFields },
    watch,
    setValue,
    getValues,
  } = useForm<WishlistItemFormData>({
    // @ts-expect-error - Zod resolver type inference mismatch with React Hook Form
    resolver: zodResolver(wishlistItemSchema),
    defaultValues: {
      priority: 'medium',
      visible_to_group_types: ['family', 'friends', 'work', 'custom'],
      restrict_to_group: null,
    },
  });

  const selectedPriority = watch("priority");
  const visibleToGroupTypes = watch("visible_to_group_types") || ['family', 'friends', 'work', 'custom'];
  const restrictToGroup = watch("restrict_to_group") || null;

  // --- Auto-fill from a pasted product URL -------------------------------
  //
  // Everything below is a convenience. A fetch in flight, a fetch that failed,
  // a rate-limit refusal and no URL at all must all leave the form exactly as
  // usable as it was before this feature existed, so nothing here disables an
  // input, blocks submit, or reports through `error` (which renders as a
  // validation failure). The only visible trace is one quiet line of text.
  const urlValue = watch("url");
  const [isFetchingMeta, setIsFetchingMeta] = useState(false);
  const [metaNote, setMetaNote] = useState<string | null>(null);
  const lastFetchedUrl = useRef<string | null>(null);

  // Read `dirtyFields` through a ref, not the effect's closure: RHF rebuilds it
  // as a fresh object on every form-state update, so listing it as a dependency
  // would restart the debounce on every keystroke anywhere in the form and the
  // fetch would never fire. Same reason `lib/supabase/use-supabase.ts` keeps the
  // Clerk session in a ref rather than in a dependency array.
  //
  // Destructuring `dirtyFields` from `formState` above is still REQUIRED.
  // `formState` is a Proxy and RHF only subscribes to the keys you actually
  // read, so dropping the destructure would leave `dirtyFields` permanently
  // empty -- the never-clobber rule would be off while still looking on.
  const dirtyRef = useRef(dirtyFields);
  dirtyRef.current = dirtyFields;

  useEffect(() => {
    const raw = (urlValue ?? "").trim();
    if (!raw || raw === lastFetchedUrl.current) return;
    try {
      const u = new URL(raw);
      if (u.protocol !== "http:" && u.protocol !== "https:") return;
    } catch {
      return; // still typing
    }

    // A superseded run must not write anything. Its fetch is about a URL that is
    // no longer in the field, so its answer would describe a different page than
    // the one the item links to.
    let cancelled = false;

    const timer = setTimeout(async () => {
      lastFetchedUrl.current = raw;
      setIsFetchingMeta(true);
      setMetaNote(null);
      const result = await fetchLinkMetadata(raw);
      if (cancelled) return;
      setIsFetchingMeta(false);

      if (result.error) {
        // Already a sentence written for a human -- the action never returns raw
        // error text -- and shown as a note, never as a validation failure.
        setMetaNote(result.error);
        return;
      }

      // Fill only what the user has neither typed into nor already filled.
      // dirtyFields is the record of what they touched; a slow fetch must never
      // pull text out from under someone mid-sentence.
      //
      // The value check is not redundant with the dirty check: `image_url` is
      // written through ImageInput's onChange rather than register(), so an
      // image the user uploaded themselves is not "dirty" but is very much
      // there, and only `getValues` sees it.
      //
      // Read through the ref, not the closure: dirtyFields is a fresh object on
      // every formState update, so depending on it directly would restart the
      // debounce timer on each keystroke anywhere in the form.
      const fill = <K extends "title" | "description" | "price" | "image_url">(
        field: K,
        value: string | number | undefined
      ) => {
        if (value === undefined) return;
        if (dirtyRef.current[field]) return;
        if (getValues(field)) return;
        setValue(field, value as never, { shouldValidate: true });
      };

      fill("title", result.title);
      fill("description", result.description);
      fill("price", result.price);
      fill("image_url", result.imagePath);

      if (!result.title && !result.description && !result.price && !result.imagePath) {
        setMetaNote("We could not read any details from that page — fill them in below.");
      }
    }, 600);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [urlValue, getValues, setValue]);

  const onSubmit = async (data: WishlistItemFormData) => {
    setIsLoading(true);
    setError(null);

    const result = await createWishlistItem(data);

    if (result.error) {
      setError(result.error);
      setIsLoading(false);
    } else {
      router.push("/wishlist");
      router.refresh();
    }
  };

  return (
    <div className="max-w-2xl mx-auto space-y-8 p-6">
      <BreadcrumbSetter
        items={[
          { label: "Dashboard", href: "/dashboard" },
          { label: "My Wishlist", href: "/wishlist" },
          { label: "Add Item", href: "/wishlist/add" },
        ]}
      />
      <div>
        <Heading level="h1">Add Wishlist Item</Heading>
        <Text variant="secondary">
          Add something you'd love to receive as a gift
        </Text>
      </div>

      {/* @ts-expect-error - Form submit handler type inference */}
      <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
        {error && (
          <div className="p-3 rounded bg-red-50 border border-red-200">
            <Text variant="error" size="sm">
              {error}
            </Text>
          </div>
        )}

        {/* Basic Information */}
        <FormSection title="Item Details" description="What would you like to receive?">
          <div className="space-y-4">
            <div>
              <Label required>Title</Label>
              <Input
                {...register("title")}
                type="text"
                placeholder="e.g., Nintendo Switch, Blue Sweater, Coffee Maker"
                error={errors.title?.message}
                className="mt-1"
              />
            </div>

            <div>
              <Label>Description</Label>
              <Textarea
                {...register("description")}
                placeholder="Add details like size, color, specific brand, or why you want it..."
                error={errors.description?.message}
                className="mt-1"
                rows={3}
              />
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <Label>URL</Label>
                <Input
                  {...register("url")}
                  type="url"
                  placeholder="https://example.com/product"
                  error={errors.url?.message}
                  className="mt-1"
                />
                <Text variant="secondary" size="sm" className="mt-1">
                  Link to the product online
                </Text>
                {isFetchingMeta && (
                  <Text variant="secondary" size="sm" className="mt-1">
                    Reading that page…
                  </Text>
                )}
                {metaNote && !isFetchingMeta && (
                  <Text variant="secondary" size="sm" className="mt-1">
                    {metaNote}
                  </Text>
                )}
              </div>

              <div>
                <Label>Price</Label>
                <Input
                  {...register("price", {
                    setValueAs: (v) => v === "" ? null : parseFloat(v)
                  })}
                  type="number"
                  step="0.01"
                  placeholder="0.00"
                  error={errors.price?.message}
                  className="mt-1"
                />
                <Text variant="secondary" size="sm" className="mt-1">
                  Optional price estimate
                </Text>
              </div>
            </div>

            <div>
              <Label>Category</Label>
              <Input
                {...register("category")}
                type="text"
                placeholder="e.g., Electronics, Clothing, Books"
                error={errors.category?.message}
                className="mt-1"
              />
            </div>

            <div>
              <Label>Image</Label>
              {user && (
                <ImageInput
                  value={watch("image_url")}
                  onChange={(url) => setValue("image_url", url || "")}
                  bucket="wishlist-images"
                  userId={user.id}
                  error={errors.image_url?.message}
                  className="mt-1"
                />
              )}
            </div>
          </div>
        </FormSection>

        {/* Priority */}
        <FormSection title="Priority" description="How much do you want this?">
          <div className="grid grid-cols-2 gap-3">
            {(Object.keys(PRIORITY_INFO) as Array<keyof typeof PRIORITY_INFO>).map((priority) => {
              const info = PRIORITY_INFO[priority];
              const isSelected = selectedPriority === priority;

              return (
                <button
                  key={priority}
                  type="button"
                  onClick={() => setValue("priority", priority)}
                  className={`p-4 rounded-lg border-2 transition-all text-left ${
                    isSelected
                      ? "border-primary bg-primary-50"
                      : "border-light-border hover:border-primary-200"
                  }`}
                >
                  <Text size="sm" className={`font-medium ${isSelected ? "text-primary" : ""}`}>
                    {info.label}
                  </Text>
                  <Text variant="secondary" size="sm" className="mt-1">
                    {info.description}
                  </Text>
                </button>
              );
            })}
          </div>
        </FormSection>

        {/* Privacy Settings */}
        <WishlistPrivacySelector
          visibleToGroupTypes={visibleToGroupTypes}
          restrictToGroup={restrictToGroup}
          onVisibleToGroupTypesChange={(groupTypes) => setValue("visible_to_group_types", groupTypes, { shouldDirty: true })}
          onRestrictToGroupChange={(groupId) => setValue("restrict_to_group", groupId, { shouldDirty: true })}
        />

        {/* Form actions */}
        <div className="flex gap-3 pt-4">
          <Button
            type="button"
            variant="secondary"
            onClick={() => router.push("/wishlist")}
          >
            Cancel
          </Button>
          <Button type="submit" variant="primary" loading={isLoading}>
            Add to Wishlist
          </Button>
        </div>
      </form>
    </div>
  );
}
