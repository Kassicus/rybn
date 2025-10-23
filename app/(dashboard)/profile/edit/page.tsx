"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { profileEditSchema, type ProfileEditFormData } from "@/lib/schemas/profile";
import { getMyProfile, updateProfile } from "@/lib/actions/profile";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Heading } from "@/components/ui/text";
import { Text } from "@/components/ui/text";
import { FormSection } from "@/components/profile/FormSection";
import { SizesSection } from "@/components/profile/sections/SizesSection";
import { PreferencesSection } from "@/components/profile/sections/PreferencesSection";
import { VehiclesSection } from "@/components/profile/sections/VehiclesSection";
import { PersonalInfoSection } from "@/components/profile/sections/PersonalInfoSection";
import { DatesSection } from "@/components/profile/sections/DatesSection";
import { GroupTypeSelector } from "@/components/privacy/GroupTypeSelector";
import type { GroupType } from "@/types/privacy";

export default function ProfileEditPage() {
  const router = useRouter();
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const {
    register,
    handleSubmit,
    formState: { errors, isDirty },
    reset,
    watch,
    setValue,
  } = useForm<ProfileEditFormData>({
    resolver: zodResolver(profileEditSchema),
    defaultValues: {
      visible_to_group_types: [],
    },
  });

  const visibleToGroupTypes = watch("visible_to_group_types") || [];

  // Load profile data
  useEffect(() => {
    const loadProfile = async () => {
      const { data, error } = await getMyProfile();
      if (data) {
        // Convert profile_info array to form fields
        const formData: Partial<ProfileEditFormData> = {
          username: data.username,
          display_name: data.display_name,
          bio: data.bio,
          avatar_url: data.avatar_url,
          visible_to_group_types: [],
        };

        // Try to extract privacy settings from the first field
        if (data.profile_info && Array.isArray(data.profile_info) && data.profile_info.length > 0) {
          const firstField = data.profile_info[0];
          if (firstField.privacy_settings?.visibleToGroupTypes) {
            formData.visible_to_group_types = firstField.privacy_settings.visibleToGroupTypes as GroupType[];
          }
        }

        // Map profile_info records to form fields
        if (data.profile_info && Array.isArray(data.profile_info)) {
          data.profile_info.forEach((field: any) => {
            const fieldName = field.field_name as keyof ProfileEditFormData;
            (formData as any)[fieldName] = field.field_value;
          });
        }

        reset(formData);
      }
      if (error) {
        setError("Failed to load profile");
      }
    };
    loadProfile();
  }, [reset]);

  const onSubmit = async (data: ProfileEditFormData) => {
    setIsLoading(true);
    setError(null);
    setSuccess(false);

    const result = await updateProfile(data);

    if (result.error) {
      setError(result.error);
      setIsLoading(false);
    } else {
      setSuccess(true);
      setTimeout(() => {
        router.push("/profile");
        router.refresh();
      }, 1000);
    }
  };

  return (
    <div className="max-w-2xl mx-auto space-y-8 p-6">
      <div>
        <Heading level="h1">Edit Profile</Heading>
        <Text variant="secondary" className="mt-2">
          Update your profile information
        </Text>
      </div>

      <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
        {/* Error banner */}
        {error && (
          <div className="p-3 rounded bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800">
            <Text variant="error" size="sm">
              {error}
            </Text>
          </div>
        )}

        {/* Success banner */}
        {success && (
          <div className="p-3 rounded bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800">
            <Text className="text-green-700 dark:text-green-300" size="sm">
              Profile updated successfully! Redirecting...
            </Text>
          </div>
        )}

        {/* Basic Information */}
        <FormSection title="Basic Information" description="Your public identity">
          <div className="space-y-4">
            <div>
              <Label required>Username</Label>
              <Input
                {...register("username")}
                type="text"
                placeholder="username"
                error={errors.username?.message}
                className="mt-1"
              />
              <Text variant="secondary" size="sm" className="mt-1">
                Your unique identifier on Rybn
              </Text>
            </div>

            <div>
              <Label>Display Name</Label>
              <Input
                {...register("display_name")}
                type="text"
                placeholder="Your Name"
                error={errors.display_name?.message}
                className="mt-1"
              />
              <Text variant="secondary" size="sm" className="mt-1">
                How you'd like to be called
              </Text>
            </div>

            <div>
              <Label>Avatar URL</Label>
              <Input
                {...register("avatar_url")}
                type="url"
                placeholder="https://example.com/avatar.jpg"
                error={errors.avatar_url?.message}
                className="mt-1"
              />
              <Text variant="secondary" size="sm" className="mt-1">
                Link to your profile picture (Gravatar, imgur, etc.)
              </Text>
            </div>

            <div>
              <Label>Bio</Label>
              <Textarea
                {...register("bio")}
                placeholder="Tell us about yourself..."
                error={errors.bio?.message}
                className="mt-1"
              />
              <Text variant="secondary" size="sm" className="mt-1">
                A short description about you
              </Text>
            </div>
          </div>
        </FormSection>

        {/* Privacy Settings */}
        <FormSection title="Privacy Settings" description="Choose which groups can see your profile information">
          <GroupTypeSelector
            value={visibleToGroupTypes}
            onChange={(groupTypes) => setValue("visible_to_group_types", groupTypes, { shouldDirty: true })}
            label="Who can see your profile fields?"
            description="Select which types of groups can view the information you add below. Leave all unchecked to keep everything private."
          />
        </FormSection>

        {/* Sizes Section */}
        <FormSection title="Sizes" description="Help others choose the perfect fit">
          <SizesSection register={register} errors={errors} />
        </FormSection>

        {/* Preferences Section */}
        <FormSection title="Preferences" description="Your likes, interests, and style">
          <PreferencesSection register={register} errors={errors} />
        </FormSection>

        {/* Vehicles Section */}
        <FormSection title="Vehicles" description="Your car or vehicle information">
          <VehiclesSection register={register} errors={errors} />
        </FormSection>

        {/* Personal Info Section */}
        <FormSection title="Personal Information" description="Dietary needs and favorites">
          <PersonalInfoSection register={register} errors={errors} />
        </FormSection>

        {/* Important Dates Section */}
        <FormSection title="Important Dates" description="Birthdays and anniversaries">
          <DatesSection register={register} errors={errors} />
        </FormSection>

        {/* Form actions */}
        <div className="flex gap-3 pt-4">
          <Button
            type="button"
            variant="secondary"
            onClick={() => router.push("/profile")}
          >
            Cancel
          </Button>
          <Button type="submit" variant="primary" loading={isLoading} disabled={!isDirty || isLoading}>
            Save Changes
          </Button>
        </div>
      </form>
    </div>
  );
}
