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
  const imageValue = watch("image_url");
  const [isFetchingMeta, setIsFetchingMeta] = useState(false);
  const [metaNote, setMetaNote] = useState<string | null>(null);

  /**
   * The signed URL for an image the lookup ingested, kept next to the path it
   * belongs to.
   *
   * `image_url` holds an object PATH once the lookup fills it in, and the bucket
   * is private -- a path is not renderable and the client cannot sign one
   * (signing needs the service-role key). Without this the headline result of
   * the whole feature was the grey "Image attached (preview unavailable)" box:
   * the item saved fine and the image appeared on /wishlist afterwards, but the
   * form that fetched it could not show it.
   *
   * The URL is minted by the same server helper that signs every other image in
   * the app, and arrives on the action's result. Nothing new is invented here
   * and the bucket stays private -- this is the pattern GiftForm and
   * WishlistItemSettings already use, which is why ImageInput has taken a
   * `previewUrl` all along.
   *
   * The PATH is stored alongside so the pair can be checked before it is used.
   * A signed URL outlives the value it describes: remove the image, upload a
   * different one, paste an external URL, or run a second lookup, and this
   * preview would be of something the form no longer holds.
   */
  const [ingestedImage, setIngestedImage] = useState<{
    path: string;
    previewUrl: string;
  } | null>(null);
  const lastFetchedUrl = useRef<string | null>(null);
  const requestTicket = useRef(0);

  // Read `dirtyFields` through a ref rather than closing over it. Two reasons,
  // and the second is the substantive one:
  //
  //  1. The debounce must be keyed on the URL and nothing else. Listing form
  //     state in the dependency array would tie the timer's lifetime to an
  //     object identity RHF reassigns on paths of its own choosing (reset, field
  //     arrays) and does not document as stable. Same reason
  //     `lib/supabase/use-supabase.ts` keeps the Clerk session in a ref.
  //  2. The check that matters happens AFTER the await, so it has to see what the
  //     user has touched at the moment the fetch RESOLVED, not at the moment the
  //     effect ran -- that window is exactly when someone starts typing. This
  //     works without a re-render because RHF mutates the same dirtyFields object
  //     in place: updateTouchAndDirty does `set(_formState.dirtyFields, name,
  //     true)` on each change rather than rebuilding it.
  //
  // Destructuring `dirtyFields` from `formState` above is still REQUIRED -- but
  // NOT because the value would otherwise be empty. `_formState.dirtyFields` is
  // maintained either way; the `_proxyFormState` flag only decides whether a
  // change also triggers a render. Reading a `formState` key during render is
  // what sets that flag, and that flag is both the re-render subscription and the
  // gate on some recomputation paths (the field-array branch rebuilds dirtyFields
  // only when it is set). Reaching around the destructure would mean depending on
  // an internal that RHF has not been told anyone is watching.
  const dirtyRef = useRef(dirtyFields);
  dirtyRef.current = dirtyFields;

  useEffect(() => {
    const raw = (urlValue ?? "").trim();

    // Take a ticket. Every run of this effect supersedes the one before it, so an
    // answer that arrives for an older URL is discarded rather than filled in --
    // it describes a page this item no longer points at. A counter and not a
    // boolean, so that ownership stays unambiguous when several edits land in
    // quick succession: exactly one ticket can equal the current one.
    const ticket = ++requestTicket.current;

    // THE SPINNER AND NOTE INVARIANT, which is why both are cleared here
    // unconditionally rather than case by case. Changing the URL retires whatever
    // the previous run started, so the "Reading that page..." line and any note it
    // left go with it -- neither may outlive the URL that caused it. From this
    // point the ONLY thing that turns the spinner back on is a timer that has
    // actually begun a fetch, and that timer turns it off again on every one of
    // its own exits. So the spinner belongs to the newest run and to nothing else,
    // and there is no path on which it can stick.
    //
    // Setting state to the value it already holds is a no-op in React, so this
    // costs nothing on the runs where nothing was in flight. The one thing it
    // gives up: editing away from a URL and back to the same one drops that URL's
    // note. Silence is the right side to err on -- a note is about a specific
    // link, and a stale one is worse than none.
    setIsFetchingMeta(false);
    setMetaNote(null);

    if (!raw) return;
    try {
      const u = new URL(raw);
      if (u.protocol !== "http:" && u.protocol !== "https:") return;
    } catch {
      return; // still typing
    }
    if (raw === lastFetchedUrl.current) return;

    const timer = setTimeout(async () => {
      lastFetchedUrl.current = raw;
      setIsFetchingMeta(true);

      // A Server Action call can REJECT, not merely return an `error` field.
      // `lib/actions/link-metadata.ts` has no try/catch of its own, and the call
      // is an HTTP round trip that fails outright on an offline client, a dropped
      // connection, or a deploy that has invalidated this action's id. Left
      // unhandled that is the one path where raw error text reaches the user --
      // straight into the Next dev overlay -- and nothing after the await would
      // run, so the spinner would stay on forever.
      let result: Awaited<ReturnType<typeof fetchLinkMetadata>> | null = null;
      try {
        result = await fetchLinkMetadata(raw);
      } catch (err) {
        // Logged, never shown, the same way ImageInput handles a failed upload.
        console.error("Link metadata lookup failed:", err);
      }

      // Superseded while in flight. The newer run already owns the spinner and
      // has already cleared it, so this one writes nothing at all.
      if (ticket !== requestTicket.current) return;

      // Every remaining exit passes through this line -- rejection, server-
      // reported error, nothing found, and full success alike. That is what makes
      // "the spinner always clears" a property of the control flow rather than a
      // checklist someone has to keep in their head.
      setIsFetchingMeta(false);

      if (!result) {
        setMetaNote("We could not look that link up just now — fill the details in below.");
        return;
      }

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
      // `dirtyRef` rather than a closed-over `dirtyFields` so this reads what the
      // user has touched as of NOW, after the await -- see the note on its
      // declaration.
      // Returns whether it actually wrote, which only the image needs: its
      // preview URL describes the value that was filled in, so it must not be
      // adopted on the runs where the fill was declined.
      const fill = <K extends "title" | "description" | "price" | "image_url">(
        field: K,
        value: string | number | undefined
      ): boolean => {
        if (value === undefined) return false;
        if (dirtyRef.current[field]) return false;
        if (getValues(field)) return false;
        setValue(field, value as never, { shouldValidate: true });
        return true;
      };

      fill("title", result.title);
      fill("description", result.description);
      fill("price", result.price);
      if (fill("image_url", result.imagePath) && result.imagePreviewUrl) {
        setIngestedImage({
          path: result.imagePath!,
          previewUrl: result.imagePreviewUrl,
        });
      }

      if (!result.title && !result.description && !result.price && !result.imagePath) {
        setMetaNote("We could not read any details from that page — fill them in below.");
      }
    }, 600);

    // Only the not-yet-fired timer needs cancelling here. A fetch already in
    // flight is retired by the ticket the NEXT run takes, which is why that
    // increment sits at the top of the effect and not inside the timer.
    return () => clearTimeout(timer);
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
          Add something you&apos;d love to receive as a gift
        </Text>
      </div>

      {/* @ts-expect-error - Form submit handler type inference */}
      <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
        {error && (
          <div className="p-3 rounded bg-error-light border border-error">
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
                  value={imageValue}
                  // Only ever for the exact value the preview was minted for.
                  // Anything else the field can hold -- an image the user
                  // uploaded themselves, an external URL they pasted, a path
                  // from an earlier lookup, or nothing -- falls back to null,
                  // and ImageInput handles each of those on its own.
                  previewUrl={
                    ingestedImage && imageValue === ingestedImage.path
                      ? ingestedImage.previewUrl
                      : null
                  }
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
