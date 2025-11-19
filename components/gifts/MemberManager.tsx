"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { UserPlus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Heading, Text } from "@/components/ui/text";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { getAvailableGroupMembers, addMembersToGroupGift } from "@/lib/actions/gifts";

interface Member {
  id: string;
  user_id: string;
  contribution_amount: number;
  has_paid: boolean;
  user_profiles: {
    id: string;
    username: string;
    display_name?: string | null;
    avatar_url?: string | null;
  } | null;
}

interface AvailableUser {
  id: string;
  username: string;
  display_name?: string | null;
  avatar_url?: string | null;
}

interface MemberManagerProps {
  groupGiftId: string;
  currentMembers: Member[];
  isCreator: boolean;
}

export function MemberManager({
  groupGiftId,
  currentMembers,
  isCreator,
}: MemberManagerProps) {
  const router = useRouter();
  const [showAddModal, setShowAddModal] = useState(false);
  const [availableUsers, setAvailableUsers] = useState<AvailableUser[]>([]);
  const [selectedUserIds, setSelectedUserIds] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadAvailableUsers = useCallback(async () => {
    const result = await getAvailableGroupMembers(groupGiftId);
    if (result.error) {
      setError(result.error);
    } else {
      setAvailableUsers(result.data || []);
    }
  }, [groupGiftId]);

  useEffect(() => {
    if (showAddModal && isCreator) {
      loadAvailableUsers();
    }
  }, [showAddModal, isCreator, loadAvailableUsers]);

  const handleToggleUser = (userId: string) => {
    setSelectedUserIds((prev) =>
      prev.includes(userId)
        ? prev.filter((id) => id !== userId)
        : [...prev, userId]
    );
  };

  const handleAddMembers = async () => {
    if (selectedUserIds.length === 0) return;

    setIsLoading(true);
    setError(null);

    const result = await addMembersToGroupGift(groupGiftId, selectedUserIds);

    if (result.error) {
      setError(result.error);
      setIsLoading(false);
    } else {
      setShowAddModal(false);
      setSelectedUserIds([]);
      router.refresh();
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <Heading level="h4">
          Members ({currentMembers.length})
        </Heading>
        {isCreator && (
          <Button
            variant="secondary"
            size="small"
            onClick={() => setShowAddModal(true)}
          >
            <UserPlus className="w-4 h-4" />
            Add Members
          </Button>
        )}
      </div>

      {/* Current Members List */}
      <div className="space-y-2">
        {currentMembers.map((member) => {
          const profile = member.user_profiles;
          const displayName = profile?.display_name || profile?.username || "Unknown User";
          const initials = displayName.charAt(0).toUpperCase();

          return (
            <div
              key={member.id}
              className="flex items-center gap-3 p-3 rounded-lg border border-light-border bg-light-background"
            >
              <Avatar>
                {profile?.avatar_url && <AvatarImage src={profile.avatar_url} />}
                <AvatarFallback>{initials}</AvatarFallback>
              </Avatar>
              <div className="flex-1">
                <Text className="font-medium">{displayName}</Text>
                {profile?.username && profile.display_name && (
                  <Text size="sm" variant="secondary">
                    @{profile.username}
                  </Text>
                )}
              </div>
              <div className="text-right">
                {member.contribution_amount > 0 && (
                  <Text size="sm" className="font-semibold text-primary">
                    ${member.contribution_amount.toFixed(2)}
                  </Text>
                )}
                {member.has_paid && (
                  <Text size="sm" className="text-success">
                    ✓ Paid
                  </Text>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Add Members Modal */}
      {showAddModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50">
          <div className="w-full max-w-md rounded-lg border border-light-border bg-light-background p-6 shadow-xl">
            <div className="flex items-center justify-between mb-4">
              <Heading level="h3">Add Members</Heading>
              <button
                onClick={() => {
                  setShowAddModal(false);
                  setSelectedUserIds([]);
                  setError(null);
                }}
                className="p-1 hover:bg-light-background-hover rounded"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {error && (
              <div className="mb-4 p-3 rounded bg-error-light border border-error">
                <Text variant="error" size="sm">
                  {error}
                </Text>
              </div>
            )}

            {availableUsers.length === 0 ? (
              <div className="py-8 text-center">
                <Text variant="secondary">
                  All group members are already part of this group gift.
                </Text>
              </div>
            ) : (
              <>
                <Text size="sm" variant="secondary" className="mb-3">
                  Select group members to invite:
                </Text>

                <div className="max-h-96 overflow-y-auto space-y-2 mb-4">
                  {availableUsers.map((user) => {
                    const isSelected = selectedUserIds.includes(user.id);
                    const displayName = user.display_name || user.username;
                    const initials = displayName.charAt(0).toUpperCase();

                    return (
                      <button
                        key={user.id}
                        onClick={() => handleToggleUser(user.id)}
                        className={`w-full flex items-center gap-3 p-3 rounded-lg border transition-colors ${
                          isSelected
                            ? "border-primary bg-primary-light"
                            : "border-light-border hover:bg-light-background-hover"
                        }`}
                      >
                        <Avatar>
                          {user.avatar_url && <AvatarImage src={user.avatar_url} />}
                          <AvatarFallback>{initials}</AvatarFallback>
                        </Avatar>
                        <div className="flex-1 text-left">
                          <Text className="font-medium">{displayName}</Text>
                          {user.username && user.display_name && (
                            <Text size="sm" variant="secondary">
                              @{user.username}
                            </Text>
                          )}
                        </div>
                        {isSelected && (
                          <div className="w-5 h-5 rounded-full bg-primary flex items-center justify-center">
                            <span className="text-white text-xs">✓</span>
                          </div>
                        )}
                      </button>
                    );
                  })}
                </div>

                <div className="flex gap-3">
                  <Button
                    variant="secondary"
                    onClick={() => {
                      setShowAddModal(false);
                      setSelectedUserIds([]);
                      setError(null);
                    }}
                    disabled={isLoading}
                    className="flex-1"
                  >
                    Cancel
                  </Button>
                  <Button
                    variant="primary"
                    onClick={handleAddMembers}
                    disabled={selectedUserIds.length === 0}
                    loading={isLoading}
                    className="flex-1"
                  >
                    Add {selectedUserIds.length > 0 && `(${selectedUserIds.length})`}
                  </Button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
