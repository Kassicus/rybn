import { notFound, redirect } from "next/navigation";
import { Heading, Text } from "@/components/ui/text";
import { Separator } from "@/components/ui/separator";
import { getGroupById } from "@/lib/actions/groups";
import { LeaveGroupButton } from "@/components/groups/LeaveGroupButton";
import { DeleteGroupButton } from "@/components/groups/DeleteGroupButton";
import { createClient } from "@/lib/supabase/server";

export default async function GroupSettingsPage({
  params,
}: {
  params: Promise<{ groupId: string }>;
}) {
  const { groupId } = await params;
  const { data: group, error } = await getGroupById(groupId);

  if (error || !group) {
    notFound();
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  // Find user's role in the group
  const userMember = group.group_members?.find(
    (member) => member.user_id === user.id
  );

  const isOwner = userMember?.role === "owner";

  return (
    <div className="max-w-2xl mx-auto space-y-8">
      <div>
        <Heading level="h1">Group Settings</Heading>
        <Text variant="secondary">{group.name}</Text>
      </div>

      <Separator />

      {/* Group Information */}
      <div className="space-y-4">
        <Heading level="h3">Group Information</Heading>
        <div className="p-4 rounded-lg border border-light-border space-y-3">
          <div>
            <Text size="sm" variant="secondary">
              Name
            </Text>
            <Text className="font-medium">{group.name}</Text>
          </div>
          {group.description && (
            <div>
              <Text size="sm" variant="secondary">
                Description
              </Text>
              <Text className="font-medium">{group.description}</Text>
            </div>
          )}
          <div>
            <Text size="sm" variant="secondary">
              Type
            </Text>
            <Text className="font-medium capitalize">{group.type}</Text>
          </div>
          <div>
            <Text size="sm" variant="secondary">
              Invite Code
            </Text>
            <code className="px-2 py-1 rounded bg-light-background-hover text-primary font-mono text-sm">
              {group.invite_code}
            </code>
          </div>
        </div>
      </div>

      <Separator />

      {/* Danger Zone */}
      <div className="space-y-4">
        <div>
          <Heading level="h3" className="text-error">
            Danger Zone
          </Heading>
          <Text variant="secondary" size="sm">
            Irreversible actions
          </Text>
        </div>

        <div className="p-4 rounded-lg border border-error bg-error-light space-y-4">
          {!isOwner && (
            <div className="flex items-start justify-between">
              <div>
                <Text className="font-medium">Leave Group</Text>
                <Text variant="secondary" size="sm">
                  You will no longer be a member of this group
                </Text>
              </div>
              <LeaveGroupButton groupId={group.id} groupName={group.name} />
            </div>
          )}

          {isOwner && (
            <>
              {!isOwner && <Separator />}
              <div className="flex items-start justify-between">
                <div>
                  <Text className="font-medium">Delete Group</Text>
                  <Text variant="secondary" size="sm">
                    Permanently delete this group and all associated data
                  </Text>
                </div>
                <DeleteGroupButton groupId={group.id} groupName={group.name} />
              </div>
            </>
          )}

          {isOwner && (
            <Text variant="secondary" size="sm" className="pt-2 border-t border-error">
              As the owner, you cannot leave this group. You must either
              transfer ownership or delete the group.
            </Text>
          )}
        </div>
      </div>
    </div>
  );
}
