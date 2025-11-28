"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { wishlistItemSchema, type WishlistItemFormData, PRIORITY_INFO } from "@/lib/schemas/wishlist";
import { createWishlistItem } from "@/lib/actions/wishlist";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Heading, Text } from "@/components/ui/text";
import { BreadcrumbSetter } from "@/components/layout/BreadcrumbSetter";
import { WishlistPrivacySelector } from "@/components/wishlist/WishlistPrivacySelector";
import { FormSection } from "@/components/profile/FormSection";
import type { PrivacyLevel } from "@/types/privacy";

export default function AddWishlistItemPage() {
  const router = useRouter();
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
      priority: 'medium',
      visible_to_group_types: ['family', 'friends', 'work', 'custom'],
      restrict_to_group: null,
    },
  });

  const selectedPriority = watch("priority");
  const visibleToGroupTypes = watch("visible_to_group_types") || ['family', 'friends', 'work', 'custom'];
  const restrictToGroup = watch("restrict_to_group") || null;

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

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <Label>Image URL</Label>
                <Input
                  {...register("image_url")}
                  type="url"
                  placeholder="https://example.com/image.jpg"
                  error={errors.image_url?.message}
                  className="mt-1"
                />
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
