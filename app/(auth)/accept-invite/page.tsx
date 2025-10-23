"use client";

import { useEffect, useState, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Users } from "lucide-react";
import { Heading, Text } from "@/components/ui/text";
import { Button } from "@/components/ui/button";
import { acceptInvitation } from "@/lib/actions/invitations";

function AcceptInviteContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const token = searchParams.get("token");

  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!token) {
      setError("Invalid invitation link");
    }
  }, [token]);

  const handleAccept = async () => {
    if (!token) return;

    setIsLoading(true);
    setError(null);

    const result = await acceptInvitation(token);

    if (result.error) {
      setError(result.error);
      setIsLoading(false);
    } else if (result.data) {
      // Redirect to the group page
      router.push(`/groups/${result.data.id}`);
      router.refresh();
    }
  };

  if (!token || error) {
    return (
      <div className="text-center space-y-6">
        <div className="w-16 h-16 rounded-full bg-error-light flex items-center justify-center mx-auto">
          <Users className="w-8 h-8 text-error" />
        </div>
        <div className="space-y-2">
          <Heading level="h1">Invalid Invitation</Heading>
          <Text variant="secondary">
            {error || "This invitation link is invalid or has expired."}
          </Text>
        </div>
        <Button variant="primary" onClick={() => router.push("/dashboard")}>
          Go to Dashboard
        </Button>
      </div>
    );
  }

  return (
    <div className="text-center space-y-6">
      <div className="w-16 h-16 rounded-full bg-primary-50 dark:bg-primary-900 flex items-center justify-center mx-auto">
        <Users className="w-8 h-8 text-primary" />
      </div>

      <div className="space-y-2">
        <Heading level="h1">Accept Group Invitation</Heading>
        <Text variant="secondary">
          You&apos;ve been invited to join a group on Rybn!
        </Text>
      </div>

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
