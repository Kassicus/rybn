"use client";

import { useState } from "react";
import { UserPlus, X, Mail } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Heading, Text } from "@/components/ui/text";
import { sendGroupInvitation } from "@/lib/actions/invitations";

interface InviteMembersButtonProps {
  groupId: string;
  groupName: string;
}

export function InviteMembersButton({
  groupId,
  groupName,
}: InviteMembersButtonProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [isResend, setIsResend] = useState(false);

  const handleSendInvite = async () => {
    if (!email || !email.includes("@")) {
      setError("Please enter a valid email address");
      return;
    }

    setIsLoading(true);
    setError(null);
    setWarning(null);
    setSuccess(false);

    const result = await sendGroupInvitation({
      groupId,
      groupName,
      email,
    });

    if (result.error) {
      setError(result.error);
    } else {
      if (result.warning) {
        setWarning(result.warning);
      }
      setIsResend(result.isResend || false);
      setSuccess(true);
      setEmail("");
      setTimeout(() => {
        setSuccess(false);
        setWarning(null);
        setIsResend(false);
        setIsOpen(false);
      }, 4000); // Longer timeout to show warning
    }

    setIsLoading(false);
  };

  if (!isOpen) {
    return (
      <Button variant="primary" size="small" onClick={() => setIsOpen(true)}>
        <UserPlus className="w-4 h-4" />
        Invite Members
      </Button>
    );
  }

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/50 z-40"
        onClick={() => setIsOpen(false)}
      />

      {/* Modal */}
      <div className="fixed inset-0 flex items-center justify-center z-50 p-4">
        <div className="bg-light-background dark:bg-dark-background-secondary rounded-lg border border-light-border dark:border-dark-border max-w-md w-full p-6 space-y-4">
          <div className="flex items-start justify-between">
            <div>
              <Heading level="h3">Invite Members</Heading>
              <Text variant="secondary" size="sm">
                Send an email invitation to join {groupName}
              </Text>
            </div>
            <button
              onClick={() => setIsOpen(false)}
              className="text-text-secondary hover:text-text-primary dark:text-text-dark-secondary dark:hover:text-text-dark-primary"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {error && (
            <div className="p-3 rounded bg-error-light dark:bg-error-dark border border-error">
              <Text variant="error" size="sm">
                {error}
              </Text>
            </div>
          )}

          {warning && (
            <div className="p-3 rounded bg-yellow-100 dark:bg-yellow-900/20 border border-yellow-500">
              <Text size="sm" className="text-yellow-800 dark:text-yellow-200">
                ⚠️ {warning}
              </Text>
            </div>
          )}

          {success && (
            <div className="p-3 rounded bg-success-light dark:bg-success-dark border border-success">
              <Text variant="success" size="sm">
                {warning
                  ? "Invitation created (but check warning above)"
                  : isResend
                    ? "Invitation resent successfully!"
                    : "Invitation sent successfully!"}
              </Text>
            </div>
          )}

          <div>
            <label className="block mb-2">
              <Text size="sm" className="font-medium">
                Email Address
              </Text>
            </label>
            <Input
              type="email"
              placeholder="friend@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  handleSendInvite();
                }
              }}
            />
          </div>

          <div className="flex gap-3">
            <Button
              variant="secondary"
              onClick={() => setIsOpen(false)}
              className="flex-1"
            >
              Cancel
            </Button>
            <Button
              variant="primary"
              onClick={handleSendInvite}
              loading={isLoading}
              className="flex-1"
            >
              <Mail className="w-4 h-4" />
              Send Invite
            </Button>
          </div>
        </div>
      </div>
    </>
  );
}
