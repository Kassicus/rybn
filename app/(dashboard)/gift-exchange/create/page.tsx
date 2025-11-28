import { redirect } from "next/navigation";
import Link from "next/link";
import { Heading, Text } from "@/components/ui/text";
import { BreadcrumbSetter } from "@/components/layout/BreadcrumbSetter";
import { ExchangeForm } from "@/components/gift-exchange/ExchangeForm";
import { GroupSelector } from "@/components/gift-exchange/GroupSelector";
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
        <div className="p-8 rounded-lg border border-light-border text-center">
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
      <BreadcrumbSetter
        items={[
          { label: "Dashboard", href: "/dashboard" },
          { label: "Gift Exchanges", href: "/gift-exchange" },
          { label: "Create", href: "/gift-exchange/create" },
        ]}
      />
      {/* Header */}
      <div>
        <Heading level="h1">Create Gift Exchange</Heading>
        <Text variant="secondary" className="mt-1">
          Set up a Secret Santa, White Elephant, or custom gift exchange
        </Text>
      </div>

      {/* Group Selection */}
      <GroupSelector
        groups={userGroups.map((ug) => ug.groups as GroupData)}
        selectedGroupId={selectedGroupId}
      />

      {/* Form */}
      <div className="p-6 rounded-lg border border-light-border bg-light-background">
        <ExchangeForm groupId={selectedGroupId} />
      </div>
    </div>
  );
}
