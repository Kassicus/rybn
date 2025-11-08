"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { setUsername, isUsernameAvailable } from "@/lib/actions/profile";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Heading, Text } from "@/components/ui/text";
import { createClient } from "@/lib/supabase/client";

const usernameSchema = z.object({
  username: z
    .string()
    .min(3, "Username must be at least 3 characters")
    .max(20, "Username must be at most 20 characters")
    .regex(
      /^[a-zA-Z0-9_-]+$/,
      "Username can only contain letters, numbers, underscores, and hyphens"
    ),
});

type UsernameFormData = z.infer<typeof usernameSchema>;

export default function SetUsernamePage() {
  const router = useRouter();
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [displayName, setDisplayName] = useState<string>("");
  const [isCheckingAuth, setIsCheckingAuth] = useState(true);
  const supabase = createClient();

  const {
    register,
    handleSubmit,
    formState: { errors },
    watch,
  } = useForm<UsernameFormData>({
    resolver: zodResolver(usernameSchema),
  });

  const usernameValue = watch("username");

  useEffect(() => {
    // Check if user is authenticated and get their display name
    const checkAuth = async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!user) {
        router.push("/login");
        return;
      }

      // Get display name from metadata
      const name =
        user.user_metadata?.full_name ||
        user.user_metadata?.name ||
        user.email?.split("@")[0] ||
        "there";
      setDisplayName(name);
      setIsCheckingAuth(false);
    };

    checkAuth();
  }, [router, supabase]);

  const onSubmit = async (data: UsernameFormData) => {
    setIsLoading(true);
    setError(null);

    // Double-check availability before submitting
    const availabilityCheck = await isUsernameAvailable(data.username);
    if (availabilityCheck.error) {
      setError(availabilityCheck.error);
      setIsLoading(false);
      return;
    }

    if (!availabilityCheck.data?.available) {
      setError("Username is already taken");
      setIsLoading(false);
      return;
    }

    const result = await setUsername(data.username);

    if (result.error) {
      setError(result.error);
      setIsLoading(false);
    } else {
      router.push("/dashboard");
      router.refresh();
    }
  };

  if (isCheckingAuth) {
    return (
      <div className="space-y-6">
        <div className="text-center space-y-2">
          <Heading level="h1">Loading...</Heading>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="text-center space-y-2">
        <Heading level="h1">Welcome, {displayName}!</Heading>
        <Text variant="secondary">
          Choose a username to complete your profile
        </Text>
      </div>

      <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
        {error && (
          <div className="p-3 rounded bg-error-light border border-error">
            <Text variant="error" size="sm">
              {error}
            </Text>
          </div>
        )}

        <Input
          {...register("username")}
          type="text"
          placeholder="Username"
          error={errors.username?.message}
          autoComplete="username"
          autoFocus
        />

        <div className="text-left">
          <Text variant="secondary" size="sm">
            Your username will be visible to other users in your groups.
          </Text>
        </div>

        <Button
          type="submit"
          variant="primary"
          size="large"
          loading={isLoading}
          className="w-full"
        >
          Continue
        </Button>
      </form>
    </div>
  );
}
