"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { UserPlus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Heading, Text } from "@/components/ui/text";
import { joinGroupByCode } from "@/lib/actions/invitations";

interface JoinGroupButtonProps {
  size?: "small" | "medium" | "large";
}

export default function JoinGroupButton({ size = "medium" }: JoinGroupButtonProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [inviteCode, setInviteCode] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const router = useRouter();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccess(false);
    setIsLoading(true);

    // Format the code to uppercase and add dashes if needed
    let formattedCode = inviteCode.toUpperCase().replace(/[^A-Z0-9]/g, "");

    // Add dashes if user entered code without them
    if (formattedCode.length === 9) {
      formattedCode = `${formattedCode.slice(0, 3)}-${formattedCode.slice(3, 6)}-${formattedCode.slice(6, 9)}`;
    }

    const result = await joinGroupByCode(formattedCode);

    if (result.error) {
      setError(result.error);
      setIsLoading(false);
    } else if (result.data) {
      setSuccess(true);
      setIsLoading(false);

      // Close modal and redirect after a brief delay
      setTimeout(() => {
        setIsOpen(false);
        setInviteCode("");
        router.push(`/groups/${result.data.id}`);
        router.refresh();
      }, 1500);
    }
  };

  const handleClose = () => {
    if (!isLoading) {
      setIsOpen(false);
      setInviteCode("");
      setError(null);
      setSuccess(false);
    }
  };

  if (!isOpen) {
    return (
      <Button variant="secondary" size={size} onClick={() => setIsOpen(true)}>
        <UserPlus className="w-4 h-4" />
        Join Group
      </Button>
    );
  }

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/50 z-40"
        onClick={handleClose}
      />

      {/* Modal */}
      <div className="fixed inset-0 flex items-center justify-center z-50 p-4">
        <div className="bg-light-background rounded-lg border border-light-border max-w-md w-full p-6 space-y-4">
          <div className="flex items-start justify-between">
            <div>
              <Heading level="h3">Join a Group</Heading>
              <Text variant="secondary" size="sm">
                Enter the invite code to join an existing group
              </Text>
            </div>
            <button
              onClick={handleClose}
              className="text-light-text-secondary hover:text-light-text-primary"
              disabled={isLoading}
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {error && (
            <div className="p-3 rounded bg-error-light border border-error">
              <Text variant="error" size="sm">
                {error}
              </Text>
            </div>
          )}

          {success && (
            <div className="p-3 rounded bg-success-light border border-success">
              <Text variant="success" size="sm">
                Successfully joined group! Redirecting...
              </Text>
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block mb-2">
                <Text size="sm" className="font-medium">
                  Invite Code
                </Text>
              </label>
              <Input
                type="text"
                placeholder="ABC-DEF-GHI"
                value={inviteCode}
                onChange={(e) => setInviteCode(e.target.value)}
                className="uppercase"
                disabled={isLoading}
                maxLength={11}
                required
              />
              <Text variant="secondary" size="sm" className="mt-1">
                Format: ABC-DEF-GHI (9 characters with dashes)
              </Text>
            </div>

            <div className="flex gap-3">
              <Button
                type="button"
                variant="secondary"
                onClick={handleClose}
                disabled={isLoading}
                className="flex-1"
              >
                Cancel
              </Button>
              <Button
                type="submit"
                variant="primary"
                loading={isLoading}
                disabled={!inviteCode.trim()}
                className="flex-1"
              >
                <UserPlus className="w-4 h-4" />
                Join Group
              </Button>
            </div>
          </form>
        </div>
      </div>
    </>
  );
}
