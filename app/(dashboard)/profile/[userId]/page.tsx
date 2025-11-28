import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getUserProfile, getSharedGroups } from "@/lib/actions/profile";
import { ProfileHeader } from "@/components/profile/ProfileHeader";
import { BreadcrumbSetter } from "@/components/layout/BreadcrumbSetter";
import { FormSection } from "@/components/profile/FormSection";
import { ProfileField } from "@/components/profile/ProfileField";
import { Separator } from "@/components/ui/separator";
import { Text } from "@/components/ui/text";
import { Eye, Users } from "lucide-react";

export default async function UserProfilePage({
  params,
}: {
  params: Promise<{ userId: string }>;
}) {
  const { userId } = await params;
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  // Don't allow viewing your own profile through this route
  if (user.id === userId) {
    redirect("/profile");
  }

  // Get profile with privacy filtering
  const { data: profileData, error } = await getUserProfile(userId);

  if (error || !profileData) {
    notFound();
  }

  // Get shared groups
  const { data: sharedGroups } = await getSharedGroups(userId);

  // Organize profile info by category
  const profileInfo = profileData.profile_info || [];
  const sizes = profileInfo.filter((item: any) => item.category === "sizes");
  const preferences = profileInfo.filter((item: any) => item.category === "preferences");
  const vehicles = profileInfo.filter((item: any) => item.category === "vehicles");
  const personal = profileInfo.filter((item: any) => item.category === "personal");
  const dates = profileInfo.filter((item: any) => item.category === "dates");

  const displayName = profileData.display_name || profileData.username || "User";

  return (
    <div className="max-w-4xl mx-auto space-y-8 p-6">
      <BreadcrumbSetter
        items={[
          { label: "Dashboard", href: "/dashboard" },
          { label: `${displayName}'s Profile`, href: `/profile/${userId}` },
        ]}
      />
      <ProfileHeader profile={profileData} isOwnProfile={false} />

      {/* Visibility indicator */}
      <div className="p-3 rounded bg-blue-50 border border-blue-200">
        <div className="flex items-center gap-2">
          <Eye className="w-4 h-4" />
          <Text size="sm">
            {sharedGroups && sharedGroups.length > 0
              ? `You are viewing this profile as a member of ${sharedGroups.length} shared group(s)`
              : "You have no shared groups with this user"}
          </Text>
        </div>
      </div>

      <Separator />

      {/* Sizes Section */}
      {sizes.length > 0 && (
        <FormSection title="Sizes" description="Clothing and accessory sizes">
          <div className="grid grid-cols-2 gap-4">
            {sizes.map((item: any) => (
              <ProfileField
                key={item.id}
                label={item.field_name.replace(/_/g, " ").replace(/\b\w/g, (l: string) => l.toUpperCase())}
                value={item.field_value}
                privacyLevel={item.privacy_settings?.default}
                isVisible={true}
              />
            ))}
          </div>
        </FormSection>
      )}

      {/* Preferences Section */}
      {preferences.length > 0 && (
        <FormSection title="Preferences" description="Likes and interests">
          <div className="grid grid-cols-1 gap-4">
            {preferences.map((item: any) => (
              <ProfileField
                key={item.id}
                label={item.field_name.replace(/_/g, " ").replace(/\b\w/g, (l: string) => l.toUpperCase())}
                value={item.field_value}
                privacyLevel={item.privacy_settings?.default}
                isVisible={true}
              />
            ))}
          </div>
        </FormSection>
      )}

      {/* Vehicles Section */}
      {vehicles.length > 0 && (
        <FormSection title="Vehicles" description="Vehicle information">
          <div className="grid grid-cols-2 gap-4">
            {vehicles.map((item: any) => (
              <ProfileField
                key={item.id}
                label={item.field_name.replace(/_/g, " ").replace(/\b\w/g, (l: string) => l.toUpperCase())}
                value={item.field_value}
                privacyLevel={item.privacy_settings?.default}
                isVisible={true}
              />
            ))}
          </div>
        </FormSection>
      )}

      {/* Personal Section */}
      {personal.length > 0 && (
        <FormSection title="Personal Information" description="Personal details">
          <div className="grid grid-cols-1 gap-4">
            {personal.map((item: any) => (
              <ProfileField
                key={item.id}
                label={item.field_name.replace(/_/g, " ").replace(/\b\w/g, (l: string) => l.toUpperCase())}
                value={item.field_value}
                privacyLevel={item.privacy_settings?.default}
                isVisible={true}
              />
            ))}
          </div>
        </FormSection>
      )}

      {/* Important Dates Section */}
      {dates.length > 0 && (
        <FormSection title="Important Dates" description="Special occasions">
          <div className="grid grid-cols-2 gap-4">
            {dates.map((item: any) => (
              <ProfileField
                key={item.id}
                label={item.field_name.replace(/_/g, " ").replace(/\b\w/g, (l: string) => l.toUpperCase())}
                value={item.field_value}
                privacyLevel={item.privacy_settings?.default}
                isVisible={true}
                isDate={true}
              />
            ))}
          </div>
        </FormSection>
      )}

      {/* Shared Groups Section */}
      {sharedGroups && sharedGroups.length > 0 && (
        <>
          <Separator />
          <FormSection
            title="Shared Groups"
            description={`You're both in ${sharedGroups.length} group(s) together`}
          >
            <div className="space-y-2">
              {sharedGroups.map((group: any) => (
                <div
                  key={group.id}
                  className="flex items-center gap-2 p-3 rounded border border-light-border"
                >
                  <Users className="w-4 h-4" />
                  <div>
                    <Text className="font-medium">{group.name}</Text>
                    {group.description && (
                      <Text variant="secondary" size="sm">
                        {group.description}
                      </Text>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </FormSection>
        </>
      )}

      {/* Empty state */}
      {profileInfo.length === 0 && (
        <div className="text-center py-12">
          <p className="text-light-text-secondary">
            This user hasn't added any profile information yet, or you don't have permission to view it.
          </p>
        </div>
      )}
    </div>
  );
}
