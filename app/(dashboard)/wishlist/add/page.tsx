"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useUser } from "@clerk/nextjs";
import {
  wishlistItemSchema,
  type WishlistItemFormData,
  PRIORITY_INFO,
} from "@/lib/schemas/wishlist";
import { createWishlistItem } from "@/lib/actions/wishlist";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Heading, Text } from "@/components/ui/text";
import { ImageInput } from "@/components/ui/image-input";
import { BreadcrumbSetter } from "@/components/layout/BreadcrumbSetter";
import { WishlistPrivacySelector } from "@/components/wishlist/WishlistPrivacySelector";
import { FormSection } from "@/components/profile/FormSection";
import {
  ALL_GROUP_TYPES,
  fromStored,
  toStored,
  type PrivacyChoice,
} from "@/lib/wishlist/privacy-choice";
import { cn } from "@/lib/utils";

const PRIORITIES = Object.keys(PRIORITY_INFO) as Array<keyof typeof PRIORITY_INFO>;

export default function AddWishlistItemPage() {
  const router = useRouter();
  const { user } = useUser();
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    formState: { errors },
    watch,
    setValue,
  } = useForm<WishlistItemFormData>({
    // @ts-expect-error - Zod resolver type inference mismatch with React Hook Form
    resolver: zodResolver(wishlistItemSchema),
    defaultValues: {
      priority: "medium",
      visible_to_group_types: ALL_GROUP_TYPES,
      restrict_to_group: null,
    },
  });

  const selectedPriority = watch("priority");
  const imageValue = watch("image_url") || "";

  // The form holds the stored two-axis shape; the selector speaks in three
  // plain choices. lib/wishlist/privacy-choice.ts owns the translation and is
  // where the tests for it live.
  const privacyChoice = fromStored({
    visibleToGroupTypes: watch("visible_to_group_types") ?? [],
    restrictToGroup: watch("restrict_to_group") ?? null,
  });

  const setPrivacyChoice = (choice: PrivacyChoice) => {
    const stored = toStored(choice);
    setValue("visible_to_group_types", stored.visibleToGroupTypes, { shouldDirty: true });
    setValue("restrict_to_group", stored.restrictToGroup, { shouldDirty: true });
  };

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
    // pb-28 clears the action bar, which is fixed to the bottom on phones so
    // saving stays reachable one-handed. From sm up the bar returns to flow.
    <div className="mx-auto flex max-w-2xl flex-col gap-6 p-4 pb-28 sm:p-6 sm:pb-6">
      <BreadcrumbSetter
        items={[
          { label: "Dashboard", href: "/dashboard" },
          { label: "My Wishlist", href: "/wishlist" },
          { label: "Add Item", href: "/wishlist/add" },
        ]}
      />

      <div className="flex flex-col gap-1">
        <Heading level="h1" className="font-display">
          Add an item
        </Heading>
        <Text variant="secondary">Something you would like to receive.</Text>
      </div>

      {/* @ts-expect-error - Form submit handler type inference */}
      <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-6">
        {error && (
          <div
            role="alert"
            className="rounded-md border border-error bg-error-light p-3"
          >
            <Text variant="error" size="sm">
              {error}
            </Text>
          </div>
        )}

        <FormSection title="The item">
          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <Label required>Title</Label>
              <Input
                {...register("title")}
                type="text"
                placeholder="What is it?"
                error={errors.title?.message}
                className="h-12"
                autoFocus
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <Label>Link</Label>
              <Input
                {...register("url")}
                type="url"
                inputMode="url"
                placeholder="https://…"
                error={errors.url?.message}
                className="h-12"
              />
              <Text variant="secondary" size="sm">
                Where to find it online. Optional.
              </Text>
            </div>

            <div className="flex flex-col gap-1.5">
              <Label>Price</Label>
              <Input
                {...register("price", {
                  setValueAs: (v) => (v === "" ? null : parseFloat(v)),
                })}
                type="number"
                inputMode="decimal"
                step="0.01"
                placeholder="0.00"
                error={errors.price?.message}
                className="h-12"
              />
              <Text variant="secondary" size="sm">
                Roughly, so people know what they are committing to.
              </Text>
            </div>
          </div>
        </FormSection>

        <FormSection title="Details" description="All optional.">
          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <Label>Description</Label>
              <Textarea
                {...register("description")}
                placeholder="Size, colour, which version — anything that helps someone get the right one."
                rows={3}
                error={errors.description?.message}
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <Label>Category</Label>
              <Input
                {...register("category")}
                type="text"
                placeholder="e.g. Books, Kitchen, Cycling"
                error={errors.category?.message}
                className="h-12"
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <Label>Image</Label>
              {user && (
                <ImageInput
                  value={imageValue}
                  previewUrl={null}
                  onChange={(url) => setValue("image_url", url || "")}
                  bucket="wishlist-images"
                  userId={user.id}
                  error={errors.image_url?.message}
                />
              )}
            </div>
          </div>
        </FormSection>

        <FormSection
          title="How much you want it"
          description="Helps people choose when they are buying for several of you."
        >
          <fieldset className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <legend className="sr-only">Priority</legend>
            {PRIORITIES.map((priority) => {
              const info = PRIORITY_INFO[priority];
              const checked = selectedPriority === priority;
              return (
                <label
                  key={priority}
                  className={cn(
                    "flex cursor-pointer items-start gap-3 rounded-md border p-4 transition-colors",
                    "focus-within:ring-2 focus-within:ring-accent",
                    checked
                      ? "border-primary bg-primary-50"
                      : "border-light-border hover:bg-light-background-hover"
                  )}
                >
                  <input
                    type="radio"
                    name="wishlist-priority"
                    className="mt-1 h-4 w-4 shrink-0 accent-primary"
                    checked={checked}
                    onChange={() => setValue("priority", priority, { shouldDirty: true })}
                  />
                  <span className="flex min-w-0 flex-col gap-0.5">
                    <span className="font-semibold">{info.label}</span>
                    <Text size="sm" variant="secondary">
                      {info.description}
                    </Text>
                  </span>
                </label>
              );
            })}
          </fieldset>
        </FormSection>

        <FormSection
          title="Who can see it"
          description="You can change this at any time."
        >
          <WishlistPrivacySelector
            choice={privacyChoice}
            onChange={setPrivacyChoice}
          />
        </FormSection>

        <div className="fixed inset-x-0 bottom-0 z-30 border-t border-light-border bg-light-background/95 p-4 backdrop-blur sm:static sm:border-0 sm:bg-transparent sm:p-0 sm:backdrop-blur-none">
          <div className="mx-auto flex max-w-2xl gap-3">
            <Button
              type="button"
              variant="secondary"
              size="large"
              className="flex-1 sm:flex-none"
              onClick={() => router.push("/wishlist")}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              variant="primary"
              size="large"
              className="flex-1 sm:flex-none"
              loading={isLoading}
            >
              Add to wishlist
            </Button>
          </div>
        </div>
      </form>
    </div>
  );
}
