"use client";

import { useState, useEffect, useRef } from "react";
import { Send, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Heading, Text } from "@/components/ui/text";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { sendMessage } from "@/lib/actions/messages";
import { createClient } from "@/lib/supabase/client";
import { formatDistanceToNow } from "date-fns";

interface Message {
  id: string;
  user_id: string;
  content: string;
  attachment_url: string | null;
  is_edited: boolean | null;
  created_at: string | null;
  user_profiles: {
    id: string;
    username: string;
    display_name: string | null;
    avatar_url: string | null;
  } | null;
}

interface ChatWindowProps {
  giftGroupId: string;
  initialMessages: Message[];
  currentUserId: string;
}

export function ChatWindow({
  giftGroupId,
  initialMessages,
  currentUserId,
}: ChatWindowProps) {
  const [messages, setMessages] = useState<Message[]>(initialMessages);
  const [newMessage, setNewMessage] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Scroll to bottom when messages change
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // Set up real-time subscription
  useEffect(() => {
    const supabase = createClient();

    const channel = supabase
      .channel(`gift-group-${giftGroupId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "messages",
          filter: `gift_group_id=eq.${giftGroupId}`,
        },
        async (payload) => {
          console.log("New message received:", payload);

          // Fetch the user profile for the new message
          const { data: profile } = await supabase
            .from("user_profiles")
            .select("id, username, display_name, avatar_url")
            .eq("id", payload.new.user_id)
            .single();

          const newMsg: Message = {
            ...payload.new,
            user_profiles: profile,
          } as Message;

          // Avoid duplicate messages
          setMessages((prev) => {
            const exists = prev.some(m => m.id === newMsg.id);
            if (exists) return prev;
            return [...prev, newMsg];
          });
        }
      )
      .subscribe((status) => {
        console.log("Subscription status:", status);
      });

    return () => {
      supabase.removeChannel(channel);
    };
  }, [giftGroupId]);

  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!newMessage.trim()) return;

    setIsSending(true);
    setError(null);

    const messageContent = newMessage.trim();
    setNewMessage(""); // Clear input immediately

    const result = await sendMessage({
      gift_group_id: giftGroupId,
      content: messageContent,
      attachment_url: null,
    });

    if (result.error) {
      setError(result.error);
      setNewMessage(messageContent); // Restore message on error
    }

    setIsSending(false);
    // The message will be added via real-time subscription
  };

  const formatMessageTime = (timestamp: string | null) => {
    if (!timestamp) return "";
    try {
      return formatDistanceToNow(new Date(timestamp), { addSuffix: true });
    } catch {
      return "";
    }
  };

  return (
    <div className="flex flex-col h-[600px] border border-light-border dark:border-dark-border rounded-lg overflow-hidden bg-light-background dark:bg-dark-background-secondary">
      {/* Header */}
      <div className="p-4 border-b border-light-border dark:border-dark-border bg-light-background-hover dark:bg-dark-background-hover">
        <Heading level="h4">Group Chat</Heading>
        <Text size="sm" variant="secondary">
          {messages.length} {messages.length === 1 ? "message" : "messages"}
        </Text>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center">
            <Text variant="secondary">No messages yet</Text>
            <Text size="sm" variant="secondary" className="mt-1">
              Start the conversation!
            </Text>
          </div>
        ) : (
          <>
            {messages.map((message, index) => {
              const isCurrentUser = message.user_id === currentUserId;
              const showAvatar =
                index === 0 ||
                messages[index - 1].user_id !== message.user_id;

              return (
                <div
                  key={message.id}
                  className={`flex gap-3 ${
                    isCurrentUser ? "flex-row-reverse" : "flex-row"
                  }`}
                >
                  {showAvatar ? (
                    <Avatar className="flex-shrink-0">
                      {message.user_profiles?.avatar_url && (
                        <AvatarImage src={message.user_profiles.avatar_url} />
                      )}
                      <AvatarFallback>
                        {(
                          message.user_profiles?.display_name ||
                          message.user_profiles?.username ||
                          "?"
                        )
                          .charAt(0)
                          .toUpperCase()}
                      </AvatarFallback>
                    </Avatar>
                  ) : (
                    <div className="w-10 flex-shrink-0" />
                  )}

                  <div
                    className={`flex-1 max-w-[70%] ${
                      isCurrentUser ? "items-end" : "items-start"
                    } flex flex-col`}
                  >
                    {showAvatar && (
                      <div
                        className={`flex items-center gap-2 mb-1 ${
                          isCurrentUser ? "flex-row-reverse" : "flex-row"
                        }`}
                      >
                        <Text size="sm" className="font-medium">
                          {message.user_profiles?.display_name ||
                            message.user_profiles?.username ||
                            "Unknown User"}
                          {isCurrentUser && (
                            <span className="text-primary ml-1">(You)</span>
                          )}
                        </Text>
                        <Text size="xs" variant="secondary">
                          {formatMessageTime(message.created_at)}
                        </Text>
                      </div>
                    )}

                    <div
                      className={`px-4 py-2 rounded-lg ${
                        isCurrentUser
                          ? "bg-primary text-white"
                          : "bg-light-background-hover dark:bg-dark-background-hover"
                      }`}
                    >
                      <Text
                        size="sm"
                        className={isCurrentUser ? "text-white" : ""}
                      >
                        {message.content}
                      </Text>
                      {message.is_edited && (
                        <Text
                          size="xs"
                          variant="secondary"
                          className={`mt-1 italic ${
                            isCurrentUser ? "text-white/70" : ""
                          }`}
                        >
                          (edited)
                        </Text>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
            <div ref={messagesEndRef} />
          </>
        )}
      </div>

      {/* Input */}
      <div className="p-4 border-t border-light-border dark:border-dark-border bg-light-background-hover dark:bg-dark-background-hover">
        {error && (
          <div className="mb-3 p-2 rounded bg-error-light border border-error">
            <Text variant="error" size="sm">
              {error}
            </Text>
          </div>
        )}

        <form onSubmit={handleSend} className="flex gap-2">
          <Input
            type="text"
            placeholder="Type a message..."
            value={newMessage}
            onChange={(e) => setNewMessage(e.target.value)}
            disabled={isSending}
            className="flex-1"
          />
          <Button
            type="submit"
            variant="primary"
            disabled={!newMessage.trim() || isSending}
          >
            {isSending ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Send className="w-4 h-4" />
            )}
          </Button>
        </form>
      </div>
    </div>
  );
}
