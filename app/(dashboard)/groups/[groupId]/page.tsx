import { notFound } from "next/navigation";
import { Settings, Home, Users, Briefcase, Grid, User, Gift, PartyPopper } from "lucide-react";
import { Heading, Text } from "@/components/ui/text";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Separator } from "@/components/ui/separator";
import { BreadcrumbSetter } from "@/components/layout/BreadcrumbSetter";
import { getGroupById } from "@/lib/actions/groups";
import { getUpcomingOccasions } from "@/lib/actions/occasions";
import { occasionInvolvesAny } from "@/lib/occasions/celebrant";
import { CopyInviteCode } from "@/components/groups/CopyInviteCode";
import { InviteMembersButton } from "@/components/groups/InviteMembersButton";
import { UpcomingOccasions } from "@/components/occasions/UpcomingOccasions";
import { NewGroupDateButton } from "@/components/occasions/NewGroupDateButton";
import Link from "next/link";

import { getUserId } from "@/lib/auth/require-auth";
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
  const userId = await getUserId();

  // This IS the group's calendar, not a "coming up soon" widget -- a date
  // created for any time in the next year belongs on it the moment it
  // exists, per the plan's own done-when criterion ("Someone creates
  // 'Christmas 2026' on the family group and it appears for every member").
  // The old bare default of 30 days made that literal example (106 days out
  // from today) invisible even immediately after creation (Important 1).
  // Widening this is safe: every row is still gated by can_view_field() /
  // is_group_member() INSIDE get_upcoming_occasions() itself, so a longer
  // window grants no additional visibility, only reach.
  //
  // getUpcomingOccasions() already applies visibility -- everything below is
  // presentation-only filtering of an already-authorized list, never a
  // second authorization check.
  const { data: allOccasions = [] } = await getUpcomingOccasions(365);
  const memberIds = new Set(
    (group.group_members ?? []).map((member) => member.user_id)
  );
  const groupOccasions = allOccasions.filter((occasion) => {
    if (occasion.kind === "group_date") return occasion.groupId === groupId;
    // Derived birthdays/anniversaries carry groupId: null (Task 3 keys them
    // per celebrant, not per group), so membership is the only signal this
    // shape offers for "does this belong on THIS group's page." A celebrant
    // can surface on more than one of their groups' pages this way, which is
    // correct: the same person's birthday belongs on every group page they
    // are a member of, the same way it appears once on the dashboard
    // regardless of how many shared groups made it visible there.
    //
    // EITHER partner counts, not just the celebrant. A confirmed couple's
    // anniversary is stored under the canonical (user_a) partner, so a
    // celebrant-only test drops the couple off a group page whose only
    // member of the two is the NON-canonical partner -- the same rule as for
    // a single person, applied to both halves of a shared occasion.
    return occasionInvolvesAny(occasion, memberIds);
  });

  const Icon = groupTypeIcons[group.type as keyof typeof groupTypeIcons] || Grid;

  return (
    <div className="max-w-4xl mx-auto space-y-8">
      <BreadcrumbSetter
        items={[
          { label: "Dashboard", href: "/dashboard" },
          { label: "Groups", href: "/groups" },
          { label: group.name, href: `/groups/${group.id}` },
        ]}
      />
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

      {/* Occasions */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <Text size="sm" className="font-medium">
            Occasions
          </Text>
          <NewGroupDateButton groupId={group.id} />
        </div>
        {groupOccasions.length > 0 ? (
          <UpcomingOccasions
            occasions={groupOccasions}
            viewerId={userId}
            manageGroupDates
          />
        ) : (
          <Text variant="secondary" size="sm">
            Nothing on the calendar for this group yet.
          </Text>
        )}
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
            const isCurrentUser = userId === member.user_id;
            return (
              <div
                key={member.id}
                // Stacks on phones. Side by side, two labelled buttons plus a
                // role badge cannot share a row with a display name at 375px,
                // so they used to spill outside the card's border.
                className="flex flex-col gap-3 p-4 rounded-lg border border-light-border sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="flex min-w-0 items-center gap-3">
                  <Avatar className="shrink-0">
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
                  <div className="min-w-0">
                    <Text className="font-medium truncate">
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
                      <Text variant="secondary" size="sm" className="truncate">
                        @{member.user_profiles.username}
                      </Text>
                    )}
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-2 sm:shrink-0">
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
