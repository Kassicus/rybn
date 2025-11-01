"use client";

import { useRouter } from "next/navigation";
import { Text } from "@/components/ui/text";

interface GroupData {
  id: string;
  name: string;
}

interface GroupSelectorProps {
  groups: GroupData[];
  selectedGroupId: string;
}

export function GroupSelector({ groups, selectedGroupId }: GroupSelectorProps) {
  const router = useRouter();

  return (
    <div className="p-4 rounded-lg border border-light-border dark:border-dark-border bg-light-background-hover dark:bg-dark-background-hover">
      <label className="block mb-2">
        <Text size="sm" className="font-medium">
          Select Group *
        </Text>
      </label>
      <select
        className="w-full px-3 py-2 rounded border border-light-border dark:border-dark-border bg-light-background dark:bg-dark-background-secondary text-light-text-primary dark:text-dark-text-primary focus:outline-none focus:ring-2 focus:ring-primary"
        value={selectedGroupId}
        onChange={(e) => {
          router.push(`/gift-exchange/create?groupId=${e.target.value}`);
        }}
      >
        {groups.map((group) => (
          <option key={group.id} value={group.id}>
            {group.name}
          </option>
        ))}
      </select>
      <Text variant="secondary" size="sm" className="mt-2">
        All members of the selected group will be added to the exchange
      </Text>
    </div>
  );
}
