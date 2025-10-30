import Link from "next/link";
import { Plus, Home, Users, Briefcase, Grid } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Heading, Text } from "@/components/ui/text";
import { getMyGroups } from "@/lib/actions/groups";
import JoinGroupButton from "@/components/groups/JoinGroupButton";

const groupTypeIcons = {
  family: Home,
  friends: Users,
  work: Briefcase,
  custom: Grid,
};

export default async function GroupsPage() {
  const { data: groups, error } = await getMyGroups();

  if (error) {
    return (
      <div className="space-y-4">
        <Heading level="h1">Groups</Heading>
        <div className="p-4 rounded bg-error-light dark:bg-error-dark border border-error">
          <Text variant="error">{error}</Text>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <Heading level="h1">Groups</Heading>
          <Text variant="secondary">
            Coordinate gifts with family, friends, and more
          </Text>
        </div>
        <div className="flex items-center gap-2">
          <JoinGroupButton />
          <Link href="/groups/create">
            <Button variant="primary">
              <Plus className="w-4 h-4" />
              Create Group
            </Button>
          </Link>
        </div>
      </div>

      {groups.length === 0 ? (
        <div className="text-center py-12 px-4">
          <div className="max-w-md mx-auto space-y-4">
            <div className="w-16 h-16 rounded-full bg-primary-50 dark:bg-primary-900/20 flex items-center justify-center mx-auto">
              <Users className="w-8 h-8 text-primary" />
            </div>
            <Heading level="h3">No groups yet</Heading>
            <Text variant="secondary">
              Create your first group or join an existing one to start coordinating gifts with others
            </Text>
            <div className="flex items-center justify-center gap-2">
              <JoinGroupButton />
              <Link href="/groups/create">
                <Button variant="primary" size="large">
                  <Plus className="w-4 h-4" />
                  Create Your First Group
                </Button>
              </Link>
            </div>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {groups.map((group) => {
            const Icon = groupTypeIcons[group.type as keyof typeof groupTypeIcons] || Grid;

            return (
              <Link
                key={group.id}
                href={`/groups/${group.id}`}
                className="block p-6 rounded-lg border border-light-border dark:border-dark-border hover:border-primary dark:hover:border-primary transition-colors"
              >
                <div className="flex items-start gap-3">
                  <div className="w-10 h-10 rounded-lg bg-primary-50 dark:bg-primary-900/20 flex items-center justify-center flex-shrink-0">
                    <Icon className="w-5 h-5 text-primary" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <Heading level="h4" className="truncate">
                      {group.name}
                    </Heading>
                    {group.description && (
                      <Text
                        variant="secondary"
                        size="sm"
                        className="mt-1 line-clamp-2"
                      >
                        {group.description}
                      </Text>
                    )}
                    <div className="flex items-center gap-2 mt-3">
                      <span className="px-2 py-1 rounded text-xs font-medium bg-light-background-hover dark:bg-dark-background-hover text-light-text-secondary dark:text-dark-text-secondary">
                        {group.type}
                      </span>
                      {group.myRole === "owner" && (
                        <span className="px-2 py-1 rounded text-xs font-medium bg-primary-100 dark:bg-primary-900/40 text-primary">
                          Owner
                        </span>
                      )}
                      {group.myRole === "admin" && (
                        <span className="px-2 py-1 rounded text-xs font-medium bg-primary-100 dark:bg-primary-900/40 text-primary">
                          Admin
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
