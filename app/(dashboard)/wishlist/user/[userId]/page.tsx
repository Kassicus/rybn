import { redirect, notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getUserWishlist } from "@/lib/actions/wishlist";
import { getSharedGroups } from "@/lib/actions/profile";
import { Heading, Text } from "@/components/ui/text";
import { BreadcrumbSetter } from "@/components/layout/BreadcrumbSetter";
import { SortableWishlistItems } from "@/components/wishlist/SortableWishlistItems";
import { Gift, Eye, Users, Lock } from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";

export default async function UserWishlistPage({
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

  // Don't allow viewing your own wishlist through this route
  if (user.id === userId) {
    redirect("/wishlist");
  }

  // Get the target user's profile
  const { data: targetUser } = await supabase
    .from("user_profiles")
    .select("id, username, display_name, avatar_url")
    .eq("id", userId)
    .single();

  if (!targetUser) {
    notFound();
  }

  // Get shared groups
  const { data: sharedGroups } = await getSharedGroups(userId);

  // Check if we have any shared groups
  if (!sharedGroups || sharedGroups.length === 0) {
    return (
      <div className="max-w-4xl mx-auto space-y-6 p-6">
        <div className="flex items-center gap-4 mb-6">
          <Avatar className="w-16 h-16">
            {targetUser.avatar_url && <AvatarImage src={targetUser.avatar_url} />}
            <AvatarFallback>
              {(targetUser.display_name || targetUser.username || "?")
                .charAt(0)
                .toUpperCase()}
            </AvatarFallback>
          </Avatar>
          <div>
            <Heading level="h1">
              {targetUser.display_name || targetUser.username || "User"}'s Wishlist
            </Heading>
            {targetUser.username && targetUser.display_name && (
              <Text variant="secondary">@{targetUser.username}</Text>
            )}
          </div>
        </div>

        <div className="p-6 rounded-lg border border-light-border bg-light-background-hover">
          <div className="flex items-center gap-2 mb-3">
            <Lock className="w-5 h-5" />
            <Text className="font-medium">No Shared Groups</Text>
          </div>
          <Text variant="secondary">
            You don't share any groups with this user, so you cannot view their wishlist.
          </Text>
        </div>
      </div>
    );
  }

  // Get the user's wishlist (RLS will filter based on privacy)
  const { data: items, error } = await getUserWishlist(userId);

  if (error) {
    return (
      <div className="max-w-4xl mx-auto p-6">
        <p className="text-error">Error loading wishlist: {error}</p>
      </div>
    );
  }

  const displayName = targetUser.display_name || targetUser.username || "User";

  return (
    <div className="max-w-4xl mx-auto space-y-6 p-6">
      <BreadcrumbSetter
        items={[
          { label: "Dashboard", href: "/dashboard" },
          { label: `${displayName}'s Wishlist`, href: `/wishlist/user/${userId}` },
        ]}
      />
      {/* User Header */}
      <div className="flex items-center gap-4">
        <Avatar className="w-16 h-16">
          {targetUser.avatar_url && <AvatarImage src={targetUser.avatar_url} />}
          <AvatarFallback>
            {(targetUser.display_name || targetUser.username || "?")
              .charAt(0)
              .toUpperCase()}
          </AvatarFallback>
        </Avatar>
        <div>
          <Heading level="h1">
            {displayName}'s Wishlist
          </Heading>
          {targetUser.username && targetUser.display_name && (
            <Text variant="secondary">@{targetUser.username}</Text>
          )}
        </div>
      </div>

      {/* Visibility indicator */}
      <div className="p-3 rounded bg-blue-50 border border-blue-200">
        <div className="flex items-center gap-2">
          <Eye className="w-4 h-4" />
          <Text size="sm">
            You are viewing this wishlist as a member of {sharedGroups.length} shared group(s)
          </Text>
        </div>
      </div>

      {/* Shared Groups */}
      {sharedGroups && sharedGroups.length > 0 && (
        <div className="p-4 rounded-lg border border-light-border">
          <div className="flex items-center gap-2 mb-2">
            <Users className="w-4 h-4" />
            <Text className="font-medium">Shared Groups</Text>
          </div>
          <div className="flex flex-wrap gap-2">
            {sharedGroups.map((group: any) => (
              <span
                key={group.id}
                className="px-2 py-1 rounded text-xs bg-light-background-hover"
              >
                {group.name}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Empty state */}
      {items && items.length === 0 && (
        <div className="text-center py-16">
          <Gift className="w-16 h-16 mx-auto text-light-text-secondary mb-4" />
          <Heading level="h3" className="mb-2">No wishlist items</Heading>
          <Text variant="secondary">
            This user hasn't added any wishlist items you can see yet.
          </Text>
        </div>
      )}

      {/* Wishlist items */}
      {items && items.length > 0 && (
        <SortableWishlistItems items={items as any} />
      )}
    </div>
  );
}
