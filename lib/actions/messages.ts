"use server";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { revalidatePath } from "next/cache";
import type { MessageFormData, MessageEditData } from "@/lib/schemas/gifts";

/**
 * Send a message to a group gift
 */
export async function sendMessage(data: MessageFormData) {
  const supabase = await createClient();
  const adminClient = createAdminClient();

  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError || !user) {
    return { error: "Not authenticated" };
  }

  // Verify user is a member of the group gift using admin client to bypass RLS
  const { data: membership } = await adminClient
    .from("group_gift_members")
    .select("id")
    .eq("group_gift_id", data.group_gift_id)
    .eq("user_id", user.id)
    .single();

  if (!membership) {
    return { error: "You must be a member of this group gift to send messages" };
  }

  // Create the message using admin client to bypass RLS (we've already verified membership)
  const { data: message, error: messageError } = await adminClient
    .from("messages")
    .insert({
      group_gift_id: data.group_gift_id,
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

  revalidatePath(`/gifts/${data.group_gift_id}`);

  return { data: message };
}

/**
 * Get messages for a group gift
 */
export async function getMessages(groupGiftId: string, limit = 50, offset = 0) {
  const supabase = await createClient();
  const adminClient = createAdminClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { error: "Not authenticated" };
  }

  // Verify user is a member of the group gift using admin client to bypass RLS
  const { data: membership } = await adminClient
    .from("group_gift_members")
    .select("id")
    .eq("group_gift_id", groupGiftId)
    .eq("user_id", user.id)
    .single();

  if (!membership) {
    return { error: "You must be a member of this group gift to view messages" };
  }

  // Get messages using admin client to bypass RLS (we've already verified membership)
  const { data: messages, error } = await adminClient
    .from("messages")
    .select("id, user_id, content, attachment_url, is_edited, created_at, updated_at")
    .eq("group_gift_id", groupGiftId)
    .order("created_at", { ascending: true })
    .range(offset, offset + limit - 1);

  if (error) {
    return { error: error.message };
  }

  // Get user profiles for message senders using admin client
  const userIds = [...new Set(messages?.map((m) => m.user_id) || [])];
  const { data: profiles } = await adminClient
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
    .select("user_id, group_gift_id")
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

  revalidatePath(`/gifts/${message.group_gift_id}`);

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
    .select("user_id, group_gift_id")
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

  revalidatePath(`/gifts/${message.group_gift_id}`);

  return { success: true };
}

/**
 * Subscribe to real-time messages for a group gift
 * This is a helper function that components can use with Supabase Realtime
 */
export async function canAccessGroupGift(groupGiftId: string): Promise<boolean> {
  const supabase = await createClient();
  const adminClient = createAdminClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return false;
  }

  // Check if user is a member of the group gift using admin client to bypass RLS
  const { data: membership } = await adminClient
    .from("group_gift_members")
    .select("id")
    .eq("group_gift_id", groupGiftId)
    .eq("user_id", user.id)
    .single();

  return !!membership;
}
