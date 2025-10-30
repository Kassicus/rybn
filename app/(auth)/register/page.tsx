"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Heading, Text } from "@/components/ui/text";
import { Link } from "@/components/ui/link";
import { OAuthButton } from "@/components/auth/OAuthButton";

const registerSchema = z.object({
  email: z.string().email("Please enter a valid email address"),
  username: z
    .string()
    .min(3, "Username must be at least 3 characters")
    .max(20, "Username must be at most 20 characters")
    .regex(
      /^[a-zA-Z0-9_-]+$/,
      "Username can only contain letters, numbers, underscores, and hyphens"
    ),
  password: z
    .string()
    .min(8, "Password must be at least 8 characters")
    .regex(
      /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/,
      "Password must contain at least one uppercase letter, one lowercase letter, and one number"
    ),
  confirmPassword: z.string(),
}).refine((data) => data.password === data.confirmPassword, {
  message: "Passwords do not match",
  path: ["confirmPassword"],
});

type RegisterFormData = z.infer<typeof registerSchema>;

export default function RegisterPage() {
  const router = useRouter();
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const supabase = createClient();

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<RegisterFormData>({
    resolver: zodResolver(registerSchema),
  });

  const onSubmit = async (data: RegisterFormData) => {
    setIsLoading(true);
    setError(null);

    const { error } = await supabase.auth.signUp({
      email: data.email,
      password: data.password,
      options: {
        data: {
          username: data.username,
        },
        emailRedirectTo: `${window.location.origin}/auth/callback`,
      },
    });

    if (error) {
      setError(error.message);
      setIsLoading(false);
    } else {
      router.push("/verify-email");
    }
  };

  return (
    <div className="space-y-6">
      <div className="text-center space-y-2">
        <Heading level="h1">Create your account</Heading>
        <Text variant="secondary">
          Join Rybn and start coordinating gifts
        </Text>
      </div>

      <OAuthButton provider="google" text="Sign up with Google" />

      <div className="relative">
        <div className="absolute inset-0 flex items-center">
          <div className="w-full border-t border-neutral-300 dark:border-neutral-700"></div>
        </div>
        <div className="relative flex justify-center text-sm">
          <span className="px-2 bg-white dark:bg-neutral-900 text-neutral-500">
            or register with email
          </span>
        </div>
      </div>

      <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
        {error && (
          <div className="p-3 rounded bg-error-light dark:bg-error-dark border border-error">
            <Text variant="error" size="sm">
              {error}
            </Text>
          </div>
        )}

        <Input
          {...register("email")}
          type="email"
          placeholder="Email address"
          error={errors.email?.message}
          autoComplete="email"
        />

        <Input
          {...register("username")}
          type="text"
          placeholder="Username"
          error={errors.username?.message}
          autoComplete="username"
        />

        <Input
          {...register("password")}
          type="password"
          placeholder="Password"
          error={errors.password?.message}
          autoComplete="new-password"
        />

        <Input
          {...register("confirmPassword")}
          type="password"
          placeholder="Confirm password"
          error={errors.confirmPassword?.message}
          autoComplete="new-password"
        />

        <Button
          type="submit"
          variant="primary"
          size="large"
          loading={isLoading}
          className="w-full"
        >
          Create account
        </Button>
      </form>

      <div className="text-center">
        <Text variant="secondary" size="sm">
          Already have an account?{" "}
          <Link href="/login">Sign in</Link>
        </Text>
      </div>
    </div>
  );
}
