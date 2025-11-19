"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Home, Users, Briefcase, Grid } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Heading, Text } from "@/components/ui/text";
import { createGroup } from "@/lib/actions/groups";

const createGroupSchema = z.object({
  name: z.string().min(1, "Group name is required").max(50, "Group name must be less than 50 characters"),
  description: z.string().max(200, "Description must be less than 200 characters").optional(),
  type: z.enum(["family", "friends", "work", "custom"]),
});

type CreateGroupFormData = z.infer<typeof createGroupSchema>;

const groupTypes = [
  {
    value: "family" as const,
    label: "Family",
    description: "For family members and relatives",
    icon: Home,
  },
  {
    value: "friends" as const,
    label: "Friends",
    description: "For your friend groups",
    icon: Users,
  },
  {
    value: "work" as const,
    label: "Work",
    description: "For coworkers and professional groups",
    icon: Briefcase,
  },
  {
    value: "custom" as const,
    label: "Custom",
    description: "For any other type of group",
    icon: Grid,
  },
];

export default function CreateGroupPage() {
  const router = useRouter();
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    setValue,
    watch,
    formState: { errors },
  } = useForm<CreateGroupFormData>({
    resolver: zodResolver(createGroupSchema),
    defaultValues: {
      type: "family",
    },
  });

  const selectedType = watch("type");

  const onSubmit = async (data: CreateGroupFormData) => {
    setIsLoading(true);
    setError(null);

    const result = await createGroup(data);

    if (result.error) {
      setError(result.error);
      setIsLoading(false);
    } else if (result.data) {
      router.push(`/groups/${result.data.id}`);
      router.refresh();
    }
  };

  return (
    <div className="max-w-2xl mx-auto space-y-8">
      <div>
        <Heading level="h1">Create a Group</Heading>
        <Text variant="secondary">
          Bring people together to coordinate gifts
        </Text>
      </div>

      <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
        {error && (
          <div className="p-3 rounded bg-error-light border border-error">
            <Text variant="error" size="sm">
              {error}
            </Text>
          </div>
        )}

        <div>
          <label className="block mb-2">
            <Text size="sm" className="font-medium">
              Group Name <span className="text-error">*</span>
            </Text>
          </label>
          <Input
            {...register("name")}
            type="text"
            placeholder="e.g., Smith Family, Work Friends, Book Club"
            error={errors.name?.message}
          />
        </div>

        <div>
          <label className="block mb-2">
            <Text size="sm" className="font-medium">
              Description (optional)
            </Text>
          </label>
          <Input
            {...register("description")}
            type="text"
            placeholder="A brief description of your group"
            error={errors.description?.message}
          />
        </div>

        <div>
          <label className="block mb-2">
            <Text size="sm" className="font-medium">
              Group Type <span className="text-error">*</span>
            </Text>
          </label>
          <div className="grid grid-cols-2 gap-4">
            {groupTypes.map((type) => {
              const Icon = type.icon;
              const isSelected = selectedType === type.value;

              return (
                <button
                  key={type.value}
                  type="button"
                  onClick={() => setValue("type", type.value)}
                  className={`p-4 rounded-lg border-2 transition-all text-left ${
                    isSelected
                      ? "border-primary bg-primary-50"
                      : "border-light-border hover:border-primary-200"
                  }`}
                >
                  <div className="flex items-start gap-3">
                    <Icon
                      className={`w-5 h-5 mt-0.5 ${
                        isSelected ? "text-primary" : "text-light-text-secondary"
                      }`}
                    />
                    <div>
                      <Text
                        size="sm"
                        className={`font-medium ${
                          isSelected ? "text-primary" : ""
                        }`}
                      >
                        {type.label}
                      </Text>
                      <Text variant="secondary" size="sm" className="mt-1">
                        {type.description}
                      </Text>
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
          {errors.type && (
            <Text variant="error" size="sm" className="mt-1">
              {errors.type.message}
            </Text>
          )}
        </div>

        <div className="flex gap-3 pt-4">
          <Button
            type="button"
            variant="secondary"
            onClick={() => router.push("/groups")}
          >
            Cancel
          </Button>
          <Button type="submit" variant="primary" loading={isLoading}>
            Create Group
          </Button>
        </div>
      </form>
    </div>
  );
}
