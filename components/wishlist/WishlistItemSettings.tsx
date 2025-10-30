"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Settings, Trash2, X, Edit2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Heading, Text } from "@/components/ui/text";
import { WishlistPrivacySelector } from "@/components/wishlist/WishlistPrivacySelector";
import { FormSection } from "@/components/profile/FormSection";
import { deleteWishlistItem, updateWishlistItem } from "@/lib/actions/wishlist";
import { wishlistItemSchema, type WishlistItemFormData, PRIORITY_INFO } from "@/lib/schemas/wishlist";
import type { GroupType } from "@/types/privacy";

interface WishlistItemSettingsProps {
  itemId: string;
  itemTitle: string;
  item: {
    title: string;
    description?: string | null;
    url?: string | null;
    price?: number | null;
    image_url?: string | null;
    priority: 'low' | 'medium' | 'high' | 'must-have';
    category?: string | null;
    privacy_settings: {
      visibleToGroupTypes: GroupType[];
      restrictToGroup?: string | null;
    };
  };
}

export function WishlistItemSettings({
  itemId,
  itemTitle,
  item,
}: WishlistItemSettingsProps) {
  const router = useRouter();
  const [showModal, setShowModal] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [viewMode, setViewMode] = useState<'menu' | 'edit'>('menu');
  const [isDeleting, setIsDeleting] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
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
      title: item.title,
      description: item.description || undefined,
      url: item.url || undefined,
      price: item.price || undefined,
      image_url: item.image_url || undefined,
      priority: item.priority,
      category: item.category || undefined,
      visible_to_group_types: item.privacy_settings?.visibleToGroupTypes || ['family', 'friends', 'work', 'custom'],
      restrict_to_group: item.privacy_settings?.restrictToGroup || null,
    },
  });

  const selectedPriority = watch("priority");
  const visibleToGroupTypes = watch("visible_to_group_types") || ['family', 'friends', 'work', 'custom'];
  const restrictToGroup = watch("restrict_to_group") || null;

  const handleDelete = async () => {
    setIsDeleting(true);
    setError(null);

    const result = await deleteWishlistItem(itemId);

    if (result.error) {
      setError(result.error);
      setIsDeleting(false);
    } else {
      router.push("/wishlist");
      router.refresh();
    }
  };

  const onSubmit = async (data: WishlistItemFormData) => {
    setIsSaving(true);
    setError(null);

    const result = await updateWishlistItem(itemId, data);

    if (result.error) {
      setError(result.error);
      setIsSaving(false);
    } else {
      setShowModal(false);
      setViewMode('menu');
      router.refresh();
    }
  };

  const handleClose = () => {
    setShowModal(false);
    setShowDeleteConfirm(false);
    setViewMode('menu');
    setError(null);
  };

  return (
    <>
      <Button variant="secondary" size="small" onClick={() => setShowModal(true)}>
        <Settings className="w-4 h-4" />
        Settings
      </Button>

      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50">
          <div className="w-full max-w-2xl max-h-[90vh] overflow-y-auto rounded-lg border border-light-border dark:border-dark-border bg-light-background dark:bg-dark-background p-6 shadow-xl">
            <div className="flex items-center justify-between mb-6">
              <Heading level="h3">
                {viewMode === 'edit' ? 'Edit Item' : 'Item Settings'}
              </Heading>
              <button
                onClick={handleClose}
                className="p-1 hover:bg-light-background-hover dark:hover:bg-dark-background-hover rounded"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {error && (
              <div className="mb-4 p-3 rounded bg-error-light dark:bg-error-dark border border-error">
                <Text variant="error" size="sm">
                  {error}
                </Text>
              </div>
            )}

            {viewMode === 'menu' && !showDeleteConfirm && (
              <div className="space-y-4">
                {/* Edit Section */}
                <div className="p-4 rounded-lg border border-light-border dark:border-dark-border">
                  <Heading level="h4" className="mb-2">
                    Edit Item
                  </Heading>
                  <Text size="sm" variant="secondary" className="mb-3">
                    Update the details of this wishlist item
                  </Text>
                  <Button
                    variant="secondary"
                    onClick={() => setViewMode('edit')}
                  >
                    <Edit2 className="w-4 h-4" />
                    Edit Item
                  </Button>
                </div>

                {/* Danger Zone */}
                <div className="p-4 rounded-lg border border-light-border dark:border-dark-border">
                  <Heading level="h4" className="mb-2">
                    Danger Zone
                  </Heading>
                  <Text size="sm" variant="secondary" className="mb-3">
                    Deleting this item is permanent and cannot be undone.
                  </Text>
                  <Button
                    variant="destructive"
                    onClick={() => setShowDeleteConfirm(true)}
                    disabled={isDeleting}
                  >
                    <Trash2 className="w-4 h-4" />
                    Delete Item
                  </Button>
                </div>
              </div>
            )}

            {viewMode === 'menu' && showDeleteConfirm && (
              <div className="space-y-4">
                <div className="p-4 rounded-lg border-2 border-error bg-error-light dark:bg-error-dark">
                  <Heading level="h4" className="mb-2 text-error">
                    Are you absolutely sure?
                  </Heading>
                  <Text size="sm" variant="secondary" className="mb-2">
                    This will permanently delete <strong>{itemTitle}</strong>.
                  </Text>
                  <Text size="sm" variant="secondary">
                    This action cannot be undone.
                  </Text>
                </div>

                <div className="flex gap-3">
                  <Button
                    variant="secondary"
                    onClick={() => setShowDeleteConfirm(false)}
                    disabled={isDeleting}
                    className="flex-1"
                  >
                    Cancel
                  </Button>
                  <Button
                    variant="destructive"
                    onClick={handleDelete}
                    loading={isDeleting}
                    className="flex-1"
                  >
                    <Trash2 className="w-4 h-4" />
                    Yes, Delete Forever
                  </Button>
                </div>
              </div>
            )}

            {viewMode === 'edit' && (
              // @ts-expect-error - Form submit handler type inference
              <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
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
                              ? "border-primary bg-primary-50 dark:bg-primary-900/20"
                              : "border-light-border dark:border-dark-border hover:border-primary-200 dark:hover:border-primary-800"
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
                    onClick={() => setViewMode('menu')}
                    disabled={isSaving}
                  >
                    Back
                  </Button>
                  <Button type="submit" variant="primary" loading={isSaving}>
                    Save Changes
                  </Button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}
    </>
  );
}
