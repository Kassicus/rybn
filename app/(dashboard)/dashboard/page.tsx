import Link from "next/link";
import { Plus } from "lucide-react";
import { Heading, Text } from "@/components/ui/text";
import { Button } from "@/components/ui/button";

export default function DashboardPage() {
  return (
    <div className="space-y-8">
      <div>
        <Heading level="h1">Dashboard</Heading>
        <Text variant="secondary">
          Welcome to Rybn - your gift coordination hub
        </Text>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="p-6 rounded-lg border border-light-border dark:border-dark-border">
          <Heading level="h3">Groups</Heading>
          <Text variant="secondary" size="sm" className="mt-2 mb-4">
            Create and manage your gift coordination groups
          </Text>
          <Link href="/groups/create">
            <Button variant="primary" size="small">
              <Plus className="w-4 h-4" />
              Create Group
            </Button>
          </Link>
        </div>

        <div className="p-6 rounded-lg border border-light-border dark:border-dark-border">
          <Heading level="h3">Wishlist</Heading>
          <Text variant="secondary" size="sm" className="mt-2 mb-4">
            Build your wishlist and share with groups
          </Text>
          <Button variant="primary" size="small" disabled>
            <Plus className="w-4 h-4" />
            Add Item
          </Button>
        </div>

        <div className="p-6 rounded-lg border border-light-border dark:border-dark-border">
          <Heading level="h3">Secret Santa</Heading>
          <Text variant="secondary" size="sm" className="mt-2 mb-4">
            Organize Secret Santa events for your groups
          </Text>
          <Button variant="primary" size="small" disabled>
            <Plus className="w-4 h-4" />
            Create Event
          </Button>
        </div>
      </div>

      <div className="p-6 rounded-lg bg-primary-50 dark:bg-primary-900/20 border border-primary-200 dark:border-primary-800">
        <Heading level="h3">Getting Started</Heading>
        <Text variant="secondary" size="sm" className="mt-2">
          1. Create a group for your family, friends, or coworkers
          <br />
          2. Invite members to join
          <br />
          3. Build your wishlist with privacy controls
          <br />
          4. Coordinate gifts and organize Secret Santa events
          <br />
          5. Make gift giving stress-free and tied together!
        </Text>
      </div>
    </div>
  );
}
