import { notFound } from "next/navigation";
import { Settings, Home, Users, Briefcase, Grid, User, Gift, PartyPopper } from "lucide-react";
import { Heading, Text } from "@/components/ui/text";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Separator } from "@/components/ui/separator";
import { getGroupById } from "@/lib/actions/groups";
import { CopyInviteCode } from "@/components/groups/CopyInviteCode";
import { InviteMembersButton } from "@/components/groups/InviteMembersButton";
import { createClient } from "@/lib/supabase/server";
import Link from "next/link";

const groupTypeIcons = {
  family: Home,
  friends: Users,
  work: Briefcase,
  custom: Grid,
};

export default async function GroupDetailPage({
  params,
}: {
  params: Promise<{ groupId: string }>;
}) {
  const { groupId } = await params;
  const { data: group, error } = await getGroupById(groupId);

  if (error || !group) {
    notFound();
  }

  // Get current user to check if viewing own profile
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const Icon = groupTypeIcons[group.type as keyof typeof groupTypeIcons] || Grid;

  return (
    <div className="max-w-4xl mx-auto space-y-8">
      {/* Group Header */}
      <div className="flex items-start justify-between">
        <div className="flex items-start gap-4">
          <div className="w-16 h-16 rounded-lg bg-primary-50 flex items-center justify-center flex-shrink-0">
            <Icon className="w-8 h-8 text-primary" />
          </div>
          <div>
            <Heading level="h1">{group.name}</Heading>
            {group.description && (
              <Text variant="secondary" className="mt-1">
                {group.description}
              </Text>
            )}
            <div className="flex items-center gap-2 mt-2">
              <span className="px-2 py-1 rounded text-xs font-medium bg-light-background-hover text-light-text-secondary">
                {group.type}
              </span>
            </div>
          </div>
        </div>
        <Link href={`/groups/${group.id}/settings`}>
          <Button variant="secondary" size="small">
            <Settings className="w-4 h-4" />
            Settings
          </Button>
        </Link>
      </div>

      {/* Invite Section */}
      <div className="p-4 rounded-lg border border-light-border bg-light-background-hover">
        <div className="flex items-center justify-between">
          <div>
            <Text size="sm" className="font-medium">
              Invite Code
            </Text>
            <div className="flex items-center gap-2 mt-1">
              <code className="px-2 py-1 rounded bg-light-background text-primary font-mono text-sm">
                {group.invite_code}
              </code>
              <CopyInviteCode inviteCode={group.invite_code} />
            </div>
          </div>
          <InviteMembersButton groupId={group.id} groupName={group.name} />
        </div>
      </div>

      {/* Gift Exchange Quick Action */}
      <div className="p-4 rounded-lg border border-light-border bg-gradient-to-r from-primary-50 to-secondary-50">
        <div className="flex items-center justify-between">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <PartyPopper className="w-5 h-5 text-primary" />
              <Text size="sm" className="font-medium">
                Gift Exchange
              </Text>
            </div>
            <Text variant="secondary" size="sm">
              Create a Secret Santa or gift exchange for this group
            </Text>
          </div>
          <Link href={`/gift-exchange/create?groupId=${group.id}`}>
            <Button variant="primary" size="small">
              <PartyPopper className="w-4 h-4" />
              Create Exchange
            </Button>
          </Link>
        </div>
      </div>

      <Separator />

      {/* Members Section */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <Heading level="h3">
            Members ({group.group_members?.length || 0})
          </Heading>
        </div>

        <div className="space-y-2">
          {group.group_members?.map((member) => {
            const isCurrentUser = user?.id === member.user_id;
            return (
              <div
                key={member.id}
                className="flex items-center justify-between p-4 rounded-lg border border-light-border"
              >
                <div className="flex items-center gap-3">
                  <Avatar>
                    {member.user_profiles?.avatar_url && (
                      <AvatarImage src={member.user_profiles.avatar_url} />
                    )}
                    <AvatarFallback>
                      {(
                        member.user_profiles?.display_name ||
                        member.user_profiles?.username ||
                        "?"
                      )
                        .charAt(0)
                        .toUpperCase()}
                    </AvatarFallback>
                  </Avatar>
                  <div>
                    <Text className="font-medium">
                      {member.user_profiles?.display_name ||
                        member.user_profiles?.username ||
                        "Unknown User"}
                      {isCurrentUser && (
                        <span className="ml-2 text-xs text-light-text-secondary">
                          (You)
                        </span>
                      )}
                    </Text>
                    {member.user_profiles?.username && member.user_profiles?.display_name && (
                      <Text variant="secondary" size="sm">
                        @{member.user_profiles.username}
                      </Text>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {/* Action buttons for other users */}
                  {!isCurrentUser && (
                    <>
                      <Link href={`/profile/${member.user_id}`}>
                        <Button variant="secondary" size="small">
                          <User className="w-4 h-4" />
                          Profile
                        </Button>
                      </Link>
                      <Link href={`/wishlist/user/${member.user_id}`}>
                        <Button variant="secondary" size="small">
                          <Gift className="w-4 h-4" />
                          Wishlist
                        </Button>
                      </Link>
                    </>
                  )}
                  <span
                    className={`px-2 py-1 rounded text-xs font-medium ${
                      member.role === "owner"
                        ? "bg-primary-100 text-primary"
                        : member.role === "admin"
                        ? "bg-primary-50 text-primary"
                        : "bg-light-background-hover text-light-text-secondary"
                    }`}
                  >
                    {member.role}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
