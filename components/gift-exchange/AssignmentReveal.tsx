"use client";

import { useState } from "react";
import { Gift, Eye, EyeOff, ExternalLink } from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Heading, Text } from "@/components/ui/text";
import Link from "next/link";

interface AssignmentRevealProps {
  assignedUser: {
    id: string;
    username: string;
    display_name: string | null;
    avatar_url: string | null;
  } | null;
  budgetRange?: string;
}

export function AssignmentReveal({
  assignedUser,
  budgetRange,
}: AssignmentRevealProps) {
  const [isRevealed, setIsRevealed] = useState(false);

  if (!assignedUser) {
    return (
      <div className="p-8 rounded-lg border border-light-border dark:border-dark-border border-dashed text-center">
        <Gift className="w-12 h-12 text-light-text-secondary dark:text-dark-text-secondary mx-auto mb-3" />
        <Heading level="h4" className="mb-2">
          No Assignment Yet
        </Heading>
        <Text variant="secondary">
          Assignments haven&apos;t been generated yet. Check back soon!
        </Text>
      </div>
    );
  }

  return (
    <div className="p-6 rounded-lg border border-primary bg-gradient-to-br from-primary-50 to-white dark:from-primary-900/20 dark:to-dark-background-secondary">
      <div className="flex items-center justify-between mb-4">
        <Heading level="h4">Your Secret Assignment</Heading>
        <Button
          variant="secondary"
          size="small"
          onClick={() => setIsRevealed(!isRevealed)}
        >
          {isRevealed ? (
            <>
              <EyeOff className="w-4 h-4" />
              Hide
            </>
          ) : (
            <>
              <Eye className="w-4 h-4" />
              Reveal
            </>
          )}
        </Button>
      </div>

      {isRevealed ? (
        <div className="space-y-4">
          <div className="flex items-center gap-4 p-4 rounded-lg bg-white dark:bg-dark-background border border-light-border dark:border-dark-border">
            <Avatar className="w-16 h-16">
              {assignedUser.avatar_url && (
                <AvatarImage src={assignedUser.avatar_url} />
              )}
              <AvatarFallback className="text-xl">
                {(assignedUser.display_name || assignedUser.username)
                  .charAt(0)
                  .toUpperCase()}
              </AvatarFallback>
            </Avatar>
            <div className="flex-1">
              <Heading level="h3">
                {assignedUser.display_name || assignedUser.username}
              </Heading>
              {assignedUser.username && assignedUser.display_name && (
                <Text variant="secondary">@{assignedUser.username}</Text>
              )}
            </div>
          </div>

          {budgetRange && (
            <div className="p-4 rounded-lg bg-white dark:bg-dark-background border border-light-border dark:border-dark-border">
              <Text size="sm" variant="secondary" className="mb-1">
                Budget Range
              </Text>
              <Heading level="h4">{budgetRange}</Heading>
            </div>
          )}

          <div className="flex gap-2">
            <Link href={`/profile/${assignedUser.id}`} className="flex-1">
              <Button variant="primary" className="w-full">
                <Gift className="w-4 h-4" />
                View Profile
              </Button>
            </Link>
            <Link href={`/wishlist/${assignedUser.id}`} className="flex-1">
              <Button variant="secondary" className="w-full">
                <ExternalLink className="w-4 h-4" />
                View Wishlist
              </Button>
            </Link>
          </div>

          <div className="p-3 rounded bg-warning-light dark:bg-warning-dark border border-warning">
            <Text size="sm" className="text-warning">
              🤫 Remember: This is a secret! Don&apos;t tell anyone who you&apos;re assigned to.
            </Text>
          </div>
        </div>
      ) : (
        <div className="p-12 rounded-lg bg-gradient-to-br from-primary-100 to-primary-50 dark:from-primary-900/40 dark:to-primary-900/20 text-center border-2 border-dashed border-primary">
          <div className="w-20 h-20 rounded-full bg-white dark:bg-dark-background flex items-center justify-center mx-auto mb-4 shadow-lg">
            <Gift className="w-10 h-10 text-primary" />
          </div>
          <Heading level="h3" className="mb-2">
            You&apos;ve Been Assigned!
          </Heading>
          <Text variant="secondary" className="mb-4">
            Click &quot;Reveal&quot; above to see who you&apos;re giving a gift to
          </Text>
          <Text size="xs" variant="secondary" className="italic">
            Make sure no one is looking over your shoulder! 👀
          </Text>
        </div>
      )}
    </div>
  );
}
