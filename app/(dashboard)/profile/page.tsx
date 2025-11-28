import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getMyProfile } from "@/lib/actions/profile";
import { ProfileHeader } from "@/components/profile/ProfileHeader";
import { FormSection } from "@/components/profile/FormSection";
import { ProfileField } from "@/components/profile/ProfileField";
import { BreadcrumbSetter } from "@/components/layout/BreadcrumbSetter";
import { Separator } from "@/components/ui/separator";

export default async function ProfilePage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const { data: profileData, error } = await getMyProfile();

  if (error || !profileData) {
    return (
      <div className="max-w-4xl mx-auto p-6">
        <p className="text-error">Error loading profile: {error}</p>
      </div>
    );
  }

  // Organize profile info by category
  const profileInfo = profileData.profile_info || [];
  const sizes = profileInfo.filter((item: any) => item.category === "sizes");
  const preferences = profileInfo.filter((item: any) => item.category === "preferences");
  const vehicles = profileInfo.filter((item: any) => item.category === "vehicles");
  const personal = profileInfo.filter((item: any) => item.category === "personal");
  const dates = profileInfo.filter((item: any) => item.category === "dates");

  return (
    <div className="max-w-4xl mx-auto space-y-8 p-6">
      <BreadcrumbSetter
        items={[
          { label: "Dashboard", href: "/dashboard" },
          { label: "My Profile", href: "/profile" },
        ]}
      />
      <ProfileHeader profile={profileData} isOwnProfile={true} />

      <Separator />

      {/* Sizes Section */}
      {sizes.length > 0 && (
        <FormSection title="Sizes" description="Your clothing and accessory sizes">
          <div className="grid grid-cols-2 gap-4">
            {sizes.map((item: any) => (
              <ProfileField
                key={item.id}
                label={item.field_name.replace(/_/g, " ").replace(/\b\w/g, (l: string) => l.toUpperCase())}
                value={item.field_value}
                privacyLevel={item.privacy_settings?.default}
              />
            ))}
          </div>
        </FormSection>
      )}

      {/* Preferences Section */}
      {preferences.length > 0 && (
        <FormSection title="Preferences" description="Your likes and interests">
          <div className="grid grid-cols-1 gap-4">
            {preferences.map((item: any) => (
              <ProfileField
                key={item.id}
                label={item.field_name.replace(/_/g, " ").replace(/\b\w/g, (l: string) => l.toUpperCase())}
                value={item.field_value}
                privacyLevel={item.privacy_settings?.default}
              />
            ))}
          </div>
        </FormSection>
      )}

      {/* Vehicles Section */}
      {vehicles.length > 0 && (
        <FormSection title="Vehicles" description="Your vehicle information">
          <div className="grid grid-cols-2 gap-4">
            {vehicles.map((item: any) => (
              <ProfileField
                key={item.id}
                label={item.field_name.replace(/_/g, " ").replace(/\b\w/g, (l: string) => l.toUpperCase())}
                value={item.field_value}
                privacyLevel={item.privacy_settings?.default}
              />
            ))}
          </div>
        </FormSection>
      )}

      {/* Personal Section */}
      {personal.length > 0 && (
        <FormSection title="Personal Information" description="Your personal details">
          <div className="grid grid-cols-1 gap-4">
            {personal.map((item: any) => (
              <ProfileField
                key={item.id}
                label={item.field_name.replace(/_/g, " ").replace(/\b\w/g, (l: string) => l.toUpperCase())}
                value={item.field_value}
                privacyLevel={item.privacy_settings?.default}
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
                isDate={true}
              />
            ))}
          </div>
        </FormSection>
      )}

      {/* Empty state */}
      {profileInfo.length === 0 && (
        <div className="text-center py-12">
          <p className="text-light-text-secondary mb-4">
            Your profile is empty. Add some information to help others find the perfect gift for you!
          </p>
        </div>
      )}
    </div>
  );
}
