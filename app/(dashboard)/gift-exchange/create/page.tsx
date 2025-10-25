import { redirect } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { Heading, Text } from "@/components/ui/text";
import { ExchangeForm } from "@/components/gift-exchange/ExchangeForm";
import { createClient } from "@/lib/supabase/server";

interface GroupData {
  id: string;
  name: string;
}

export default async function CreateGiftExchangePage({
  searchParams,
}: {
  searchParams: Promise<{ groupId?: string }>;
}) {
  const params = await searchParams;
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  // Get user's groups
  const { data: userGroups } = await supabase
    .from("group_members")
    .select("group_id, groups(id, name)")
    .eq("user_id", user.id);

  if (!userGroups || userGroups.length === 0) {
    return (
      <div className="max-w-2xl mx-auto">
        <div className="p-8 rounded-lg border border-light-border dark:border-dark-border text-center">
          <Heading level="h3" className="mb-2">
            No Groups Found
          </Heading>
          <Text variant="secondary" className="mb-4">
            You need to be a member of a group to create a gift exchange.
          </Text>
          <Link
            href="/groups/create"
            className="inline-flex items-center gap-2 text-primary hover:underline"
          >
            Create a Group First
          </Link>
        </div>
      </div>
    );
  }

  // If groupId is provided in query params, use it; otherwise use the first group
  const selectedGroupId =
    params.groupId || (userGroups[0].groups as GroupData)?.id;

  if (!selectedGroupId) {
    redirect("/groups");
  }

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      {/* Header */}
      <div>
        <Link
          href="/gift-exchange"
          className="inline-flex items-center gap-2 text-primary hover:underline mb-4"
        >
          <ArrowLeft className="w-4 h-4" />
          <Text size="sm">Back to Gift Exchanges</Text>
        </Link>

        <Heading level="h1">Create Gift Exchange</Heading>
        <Text variant="secondary" className="mt-1">
          Set up a Secret Santa, White Elephant, or custom gift exchange
        </Text>
      </div>

      {/* Group Selection (if multiple groups) */}
      {userGroups.length > 1 && (
        <div className="p-4 rounded-lg border border-light-border dark:border-dark-border bg-light-background-hover dark:bg-dark-background-hover">
          <label className="block mb-2">
            <Text size="sm" className="font-medium">
              Select Group
            </Text>
          </label>
          <select
            className="w-full px-3 py-2 rounded border border-light-border dark:border-dark-border bg-light-background dark:bg-dark-background-secondary text-light-text-primary dark:text-dark-text-primary focus:outline-none focus:ring-2 focus:ring-primary"
            value={selectedGroupId}
            onChange={(e) => {
              const newUrl = `/gift-exchange/create?groupId=${e.target.value}`;
              window.location.href = newUrl;
            }}
          >
            {userGroups.map((ug) => {
              const group = ug.groups as GroupData;
              return (
                <option key={group.id} value={group.id}>
                  {group.name}
                </option>
              );
            })}
          </select>
        </div>
      )}

      {/* Form */}
      <div className="p-6 rounded-lg border border-light-border dark:border-dark-border bg-light-background dark:bg-dark-background-secondary">
        <ExchangeForm groupId={selectedGroupId} />
      </div>
    </div>
  );
}
