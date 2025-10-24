"use server";

import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";
import type { MessageFormData, MessageEditData } from "@/lib/schemas/gifts";

/**
 * Send a message to a gift group
 */
export async function sendMessage(data: MessageFormData) {
  const supabase = await createClient();

  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError || !user) {
    return { error: "Not authenticated" };
  }

  // Verify user is a member of the gift group
  const { data: membership } = await supabase
    .from("gift_group_members")
    .select("id")
    .eq("gift_group_id", data.gift_group_id)
    .eq("user_id", user.id)
    .single();

  if (!membership) {
    return { error: "You must be a member of this gift group to send messages" };
  }

  // Create the message
  const { data: message, error: messageError } = await supabase
    .from("messages")
    .insert({
      gift_group_id: data.gift_group_id,
      user_id: user.id,
      content: data.content,
      attachment_url: data.attachment_url || null,
      is_edited: false,
    })
    .select()
    .single();

  if (messageError) {
    return { error: messageError.message };
  }

  revalidatePath(`/gifts/${data.gift_group_id}`);

  return { data: message };
}

/**
 * Get messages for a gift group
 */
export async function getMessages(giftGroupId: string, limit = 50, offset = 0) {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { error: "Not authenticated" };
  }

  // Verify user is a member of the gift group
  const { data: membership } = await supabase
    .from("gift_group_members")
    .select("id")
    .eq("gift_group_id", giftGroupId)
    .eq("user_id", user.id)
    .single();

  if (!membership) {
    return { error: "You must be a member of this gift group to view messages" };
  }

  // Get messages
  const { data: messages, error } = await supabase
    .from("messages")
    .select("id, user_id, content, attachment_url, is_edited, created_at, updated_at")
    .eq("gift_group_id", giftGroupId)
    .order("created_at", { ascending: true })
    .range(offset, offset + limit - 1);

  if (error) {
    return { error: error.message };
  }

  // Get user profiles for message senders
  const userIds = [...new Set(messages?.map((m) => m.user_id) || [])];
  const { data: profiles } = await supabase
    .from("user_profiles")
    .select("id, username, display_name, avatar_url")
    .in("id", userIds);

  // Combine messages with sender profiles
  const messagesWithProfiles = messages?.map((message) => ({
    ...message,
    user_profiles: profiles?.find((p) => p.id === message.user_id) || null,
  })) || [];

  return { data: messagesWithProfiles };
}

/**
 * Edit a message (user can only edit their own messages)
 */
export async function editMessage(messageId: string, data: MessageEditData) {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { error: "Not authenticated" };
  }

  // Get the message to verify ownership
  const { data: message, error: fetchError } = await supabase
    .from("messages")
    .select("user_id, gift_group_id")
    .eq("id", messageId)
    .single();

  if (fetchError || !message) {
    return { error: "Message not found" };
  }

  if (message.user_id !== user.id) {
    return { error: "You can only edit your own messages" };
  }

  // Update the message
  const { error: updateError } = await supabase
    .from("messages")
    .update({
      content: data.content,
      is_edited: true,
    })
    .eq("id", messageId);

  if (updateError) {
    return { error: updateError.message };
  }

  revalidatePath(`/gifts/${message.gift_group_id}`);

  return { success: true };
}

/**
 * Delete a message (user can only delete their own messages)
 */
export async function deleteMessage(messageId: string) {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { error: "Not authenticated" };
  }

  // Get the message to verify ownership
  const { data: message, error: fetchError } = await supabase
    .from("messages")
    .select("user_id, gift_group_id")
    .eq("id", messageId)
    .single();

  if (fetchError || !message) {
    return { error: "Message not found" };
  }

  if (message.user_id !== user.id) {
    return { error: "You can only delete your own messages" };
  }

  // Delete the message
  const { error: deleteError } = await supabase
    .from("messages")
    .delete()
    .eq("id", messageId);

  if (deleteError) {
    return { error: deleteError.message };
  }

  revalidatePath(`/gifts/${message.gift_group_id}`);

  return { success: true };
}

/**
 * Subscribe to real-time messages for a gift group
 * This is a helper function that components can use with Supabase Realtime
 */
export async function canAccessGiftGroup(giftGroupId: string): Promise<boolean> {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return false;
  }

  // Check if user is a member of the gift group
  const { data: membership } = await supabase
    .from("gift_group_members")
    .select("id")
    .eq("gift_group_id", giftGroupId)
    .eq("user_id", user.id)
    .single();

  return !!membership;
}
