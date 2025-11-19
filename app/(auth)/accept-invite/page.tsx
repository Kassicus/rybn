"use client";

import { useEffect, useState, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Users } from "lucide-react";
import { Heading, Text } from "@/components/ui/text";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { acceptInvitation } from "@/lib/actions/invitations";
import { signupFromInvitation } from "@/lib/actions/auth";
import { createClient } from "@/lib/supabase/client";

function AcceptInviteContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const token = searchParams.get("token");

  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isAuthenticated, setIsAuthenticated] = useState<boolean | null>(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [username, setUsername] = useState("");
  const autoAccept = searchParams.get("autoAccept") === "true";

  useEffect(() => {
    if (!token) {
      setError("Invalid invitation link");
      return;
    }

    // Check if user is already authenticated
    const checkAuth = async () => {
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();
      const isAuth = !!user;
      setIsAuthenticated(isAuth);

      // If just signed up (autoAccept=true in URL), auto-accept the invitation
      if (isAuth && autoAccept) {
        console.log("Just signed up, auto-accepting invitation...");
        // Small delay to ensure cookies are fully synced
        await new Promise(resolve => setTimeout(resolve, 500));
        await handleAccept();
      }
    };

    checkAuth();
  }, [token, autoAccept]);

  const handleSignup = async () => {
    if (!email || !password || !username) {
      setError("Please fill in all fields");
      return;
    }

    if (password.length < 6) {
      setError("Password must be at least 6 characters");
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      // Use server action to create user with auto-confirmed email
      const result = await signupFromInvitation({
        email,
        password,
        username,
      });

      if (result.error) {
        setError(result.error);
        setIsLoading(false);
        return;
      }

      if (result.success) {
        console.log("User created and auto-confirmed");

        // Wait a moment for the session to fully propagate
        await new Promise(resolve => setTimeout(resolve, 1000));

        // Update auth state
        setIsAuthenticated(true);

        // Directly accept the invitation now that they're authenticated
        console.log("Attempting to accept invitation with token:", token);
        await handleAccept();
      } else {
        setError("Failed to create account. Please try again.");
        setIsLoading(false);
      }
    } catch (error) {
      console.error("Exception during signup:", error);
      setError("Failed to create account. Please try again.");
      setIsLoading(false);
    }
  };

  const handleAccept = async () => {
    if (!token) return;

    setIsLoading(true);
    setError(null);

    console.log("Calling acceptInvitation with token:", token);

    try {
      const result = await acceptInvitation(token);
      console.log("acceptInvitation result:", result);

      if (result.error) {
        console.error("Error accepting invitation:", result.error);
        setError(result.error);
        setIsLoading(false);
      } else if (result.data) {
        console.log("Successfully accepted, redirecting to group:", result.data.id);
        // Redirect to the group page
        router.push(`/groups/${result.data.id}`);
        router.refresh();
      } else {
        console.error("No data or error returned from acceptInvitation");
        setError("Failed to accept invitation. Please try again.");
        setIsLoading(false);
      }
    } catch (error) {
      console.error("Exception accepting invitation:", error);
      setError("An unexpected error occurred. Please try again.");
      setIsLoading(false);
    }
  };

  if (!token) {
    return (
      <div className="text-center space-y-6">
        <div className="w-16 h-16 rounded-full bg-error-light flex items-center justify-center mx-auto">
          <Users className="w-8 h-8 text-error" />
        </div>
        <div className="space-y-2">
          <Heading level="h1">Invalid Invitation</Heading>
          <Text variant="secondary">
            This invitation link is invalid or has expired.
          </Text>
        </div>
        <Button variant="primary" onClick={() => router.push("/")}>
          Go Home
        </Button>
      </div>
    );
  }

  // Loading auth state
  if (isAuthenticated === null) {
    return (
      <div className="text-center space-y-6">
        <div className="w-16 h-16 rounded-full bg-primary-50 flex items-center justify-center mx-auto">
          <Users className="w-8 h-8 text-primary animate-pulse" />
        </div>
        <Text variant="secondary">Loading...</Text>
      </div>
    );
  }

  // Not authenticated - show signup form
  if (!isAuthenticated) {
    return (
      <div className="max-w-md mx-auto space-y-6">
        <div className="text-center space-y-4">
          <div className="w-16 h-16 rounded-full bg-primary-50 flex items-center justify-center mx-auto">
            <Users className="w-8 h-8 text-primary" />
          </div>
          <div className="space-y-2">
            <Heading level="h1">You&apos;re Invited!</Heading>
            <Text variant="secondary">
              Create an account to join the group
            </Text>
          </div>
        </div>

        {error && (
          <div className="p-3 rounded bg-error-light border border-error">
            <Text variant="error" size="sm">
              {error}
            </Text>
          </div>
        )}

        <div className="space-y-4">
          <div>
            <label className="block mb-2">
              <Text size="sm" className="font-medium">
                Email
              </Text>
            </label>
            <Input
              type="email"
              placeholder="you@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              disabled={isLoading}
            />
          </div>

          <div>
            <label className="block mb-2">
              <Text size="sm" className="font-medium">
                Username
              </Text>
            </label>
            <Input
              type="text"
              placeholder="johndoe"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              disabled={isLoading}
            />
          </div>

          <div>
            <label className="block mb-2">
              <Text size="sm" className="font-medium">
                Password
              </Text>
            </label>
            <Input
              type="password"
              placeholder="••••••••"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              disabled={isLoading}
            />
          </div>

          <div className="flex flex-col gap-3">
            <Button
              variant="primary"
              size="large"
              onClick={handleSignup}
              loading={isLoading}
              className="w-full"
            >
              Create Account & Join Group
            </Button>
            <Button
              variant="secondary"
              onClick={() => router.push("/login")}
              className="w-full"
              disabled={isLoading}
            >
              Already have an account? Sign In
            </Button>
          </div>
        </div>
      </div>
    );
  }

  // Authenticated - show accept invitation
  return (
    <div className="text-center space-y-6">
      <div className="w-16 h-16 rounded-full bg-primary-50 flex items-center justify-center mx-auto">
        <Users className="w-8 h-8 text-primary" />
      </div>

      <div className="space-y-2">
        <Heading level="h1">Accept Group Invitation</Heading>
        <Text variant="secondary">
          You&apos;ve been invited to join a group on Rybn!
        </Text>
      </div>

      {error && (
        <div className="p-3 rounded bg-error-light border border-error">
          <Text variant="error" size="sm">
            {error}
          </Text>
        </div>
      )}

      <div className="flex flex-col gap-3 max-w-xs mx-auto">
        <Button
          variant="primary"
          size="large"
          onClick={handleAccept}
          loading={isLoading}
          className="w-full"
        >
          Accept Invitation
        </Button>
        <Button
          variant="secondary"
          onClick={() => router.push("/dashboard")}
          className="w-full"
          disabled={isLoading}
        >
          Maybe Later
        </Button>
      </div>
    </div>
  );
}

export default function AcceptInvitePage() {
  return (
    <Suspense fallback={<div>Loading...</div>}>
      <AcceptInviteContent />
    </Suspense>
  );
}
