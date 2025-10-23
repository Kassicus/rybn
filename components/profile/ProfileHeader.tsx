import Link from "next/link";
import { Edit } from "lucide-react";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Heading } from "@/components/ui/text";
import { Text } from "@/components/ui/text";

interface ProfileHeaderProps {
  profile: {
    username: string;
    display_name?: string | null;
    bio?: string | null;
    avatar_url?: string | null;
  };
  isOwnProfile: boolean;
}

export function ProfileHeader({ profile, isOwnProfile }: ProfileHeaderProps) {
  const displayName = profile.display_name || profile.username;
  const avatarFallback = displayName.charAt(0).toUpperCase();

  return (
    <div className="flex items-start justify-between">
      <div className="flex items-start gap-4">
        <Avatar className="w-20 h-20">
          {profile.avatar_url && <AvatarImage src={profile.avatar_url} alt={displayName} />}
          <AvatarFallback>{avatarFallback}</AvatarFallback>
        </Avatar>
        <div>
          <Heading level="h1">{displayName}</Heading>
          {profile.display_name && (
            <Text variant="secondary" className="mt-1">
              @{profile.username}
            </Text>
          )}
          {profile.bio && (
            <Text variant="secondary" className="mt-2 max-w-2xl">
              {profile.bio}
            </Text>
          )}
        </div>
      </div>
      {isOwnProfile && (
        <Link href="/profile/edit">
          <Button variant="secondary" size="small">
            <Edit className="w-4 h-4 mr-2" />
            Edit Profile
          </Button>
        </Link>
      )}
    </div>
  );
}
