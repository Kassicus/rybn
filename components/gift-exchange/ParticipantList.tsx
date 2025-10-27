import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Heading, Text } from "@/components/ui/text";
import { CheckCircle2, Circle, Gift } from "lucide-react";

interface Participant {
  id: string;
  user_id: string;
  opted_in: boolean;
  wishlist_shared: boolean;
  gift_sent: boolean;
  gift_received: boolean;
  joined_at: string;
  user_profiles: {
    id: string;
    username: string;
    display_name: string | null;
    avatar_url: string | null;
  } | null;
}

interface ParticipantListProps {
  participants: Participant[];
  currentUserId: string;
  showAssignmentStatus?: boolean;
}

export function ParticipantList({
  participants,
  currentUserId,
  showAssignmentStatus = false,
}: ParticipantListProps) {
  const activeParticipants = participants.filter((p) => p.opted_in);
  const inactiveParticipants = participants.filter((p) => !p.opted_in);

  const renderParticipant = (participant: Participant) => {
    const isCurrentUser = participant.user_id === currentUserId;

    return (
      <div
        key={participant.id}
        className="flex items-center justify-between p-4 rounded-lg border border-light-border dark:border-dark-border"
      >
        <div className="flex items-center gap-3">
          <Avatar>
            {participant.user_profiles?.avatar_url && (
              <AvatarImage src={participant.user_profiles.avatar_url} />
            )}
            <AvatarFallback>
              {(
                participant.user_profiles?.display_name ||
                participant.user_profiles?.username ||
                "?"
              )
                .charAt(0)
                .toUpperCase()}
            </AvatarFallback>
          </Avatar>
          <div>
            <Text className="font-medium">
              {participant.user_profiles?.display_name ||
                participant.user_profiles?.username ||
                "Unknown User"}
              {isCurrentUser && (
                <span className="text-primary ml-1">(You)</span>
              )}
            </Text>
            {participant.user_profiles?.username &&
              participant.user_profiles?.display_name && (
                <Text variant="secondary" size="sm">
                  @{participant.user_profiles.username}
                </Text>
              )}
          </div>
        </div>

        {showAssignmentStatus && (
          <div className="flex items-center gap-3">
            {participant.wishlist_shared && (
              <div className="flex items-center gap-1">
                <Gift className="w-4 h-4 text-primary" />
                <Text size="sm" variant="secondary">
                  Wishlist
                </Text>
              </div>
            )}
            <div className="flex items-center gap-1">
              {participant.gift_sent ? (
                <CheckCircle2 className="w-4 h-4 text-success" />
              ) : (
                <Circle className="w-4 h-4 text-light-text-secondary dark:text-dark-text-secondary" />
              )}
              <Text size="sm" variant="secondary">
                Sent
              </Text>
            </div>
            <div className="flex items-center gap-1">
              {participant.gift_received ? (
                <CheckCircle2 className="w-4 h-4 text-success" />
              ) : (
                <Circle className="w-4 h-4 text-light-text-secondary dark:text-dark-text-secondary" />
              )}
              <Text size="sm" variant="secondary">
                Received
              </Text>
            </div>
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="space-y-4">
      {activeParticipants.length > 0 && (
        <div>
          <Heading level="h4" className="mb-3">
            Participants ({activeParticipants.length})
          </Heading>
          <div className="space-y-2">
            {activeParticipants.map(renderParticipant)}
          </div>
        </div>
      )}

      {inactiveParticipants.length > 0 && (
        <div>
          <Heading level="h4" className="mb-3">
            Opted Out ({inactiveParticipants.length})
          </Heading>
          <div className="space-y-2">
            {inactiveParticipants.map((participant) => (
              <div
                key={participant.id}
                className="flex items-center gap-3 p-4 rounded-lg border border-light-border dark:border-dark-border opacity-50"
              >
                <Avatar>
                  {participant.user_profiles?.avatar_url && (
                    <AvatarImage src={participant.user_profiles.avatar_url} />
                  )}
                  <AvatarFallback>
                    {(
                      participant.user_profiles?.display_name ||
                      participant.user_profiles?.username ||
                      "?"
                    )
                      .charAt(0)
                      .toUpperCase()}
                  </AvatarFallback>
                </Avatar>
                <div>
                  <Text className="font-medium">
                    {participant.user_profiles?.display_name ||
                      participant.user_profiles?.username ||
                      "Unknown User"}
                  </Text>
                  <Text variant="secondary" size="sm">
                    Not participating
                  </Text>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
