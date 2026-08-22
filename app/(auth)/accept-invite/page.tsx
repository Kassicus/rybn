"use client";

import { useEffect, useState, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Users } from "lucide-react";
import { Heading, Text } from "@/components/ui/text";
import { Button } from "@/components/ui/button";
import { acceptInvitation } from "@/lib/actions/invitations";
import { useAuth, SignUp } from "@clerk/nextjs";

function AcceptInviteContent() {
  const router = useRouter();
  const { isLoaded, isSignedIn } = useAuth();
  const searchParams = useSearchParams();
  const token = searchParams.get("token");

  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isAuthenticated, setIsAuthenticated] = useState<boolean | null>(null);
  const autoAccept = searchParams.get("autoAccept") === "true";

  useEffect(() => {
    if (!token) {
      setError("Invalid invitation link");
      return;
    }

    // Wait for Clerk to hydrate before deciding
    if (!isLoaded) {
      return;
    }

    // Check if user is already authenticated
    const checkAuth = async () => {
      const isAuth = !!isSignedIn;
      setIsAuthenticated(isAuth);

      // If just signed up (autoAccept=true in URL), auto-accept the invitation
      if (isAuth && autoAccept) {
        console.log("Just signed up, auto-accepting invitation...");
        // Small delay to ensure the session is fully synced
        await new Promise(resolve => setTimeout(resolve, 500));
        await handleAccept();
      }
    };

    checkAuth();
  }, [token, autoAccept, isLoaded, isSignedIn]);

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

  // Not authenticated - sign up through Clerk, preserving the token so the
  // invitation is auto-accepted on return.
  if (!isAuthenticated) {
    return (
      <div className="space-y-6">
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

        <div className="flex justify-center">
          <SignUp
            forceRedirectUrl={`/accept-invite?token=${encodeURIComponent(
              token
            )}&autoAccept=true`}
            appearance={{
              variables: {
                colorPrimary: "#009E01",
                fontFamily: "var(--font-quicksand)",
                borderRadius: "0.75rem",
              },
            }}
          />
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
