"use server";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { revalidatePath } from "next/cache";
import type { MessageEditData } from "@/lib/schemas/gifts";
import { giftPeople, seeGift, type GiftPerson } from "@/lib/gifts/access";
import { GIFT_LIMITS, GIFT_SENTENCES } from "@/lib/gifts/sentences";
import { CONTROL_EXCEPT_NOTES_WHITESPACE } from "@/lib/utils/characters";

import { getUserId } from "@/lib/auth/require-auth";

/** A message's columns, named. */
const MESSAGE_COLUMNS = "id, user_id, content, attachment_url, is_edited, created_at, updated_at";

/** A message of a group gift's chat, with its sender's named columns (null when they have no profile row). */
export interface ChatRow {
  id: string;
  user_id: string;
  content: string;
  attachment_url: string | null;
  is_edited: boolean | null;
  created_at: string | null;
  updated_at: string | null;
  user_profiles: GiftPerson | null;
}

/** The words of an error a shared read threw. */
const messageOf = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** Named fields only, so an answer never carries a column it was not asked for. */
function chatRow(r: Omit<ChatRow, "user_profiles">, sender: GiftPerson | null): ChatRow {
  return {
    id: r.id,
    user_id: r.user_id,
    content: r.content,
    attachment_url: r.attachment_url,
    is_edited: r.is_edited,
    created_at: r.created_at,
    updated_at: r.updated_at,
    user_profiles: sender,
  };
}

/**
 * Send a message to a gift the caller can see (seeGift; its sentence, and nothing saved, for anyone else). Its
 * words are trimmed and may hold line breaks. Nothing but white space answers GIFT_SENTENCES.messageMissing, more
 * than 5000 UTF-16 units messageTooLong, and a control character other than tab, line feed and carriage return
 * GIFT_SENTENCES.characters; each saves nothing. A message is its words: it is saved with no attachment. Answers
 * the saved message with its sender's profile.
 */
export async function sendMessage(data: {
  group_gift_id: string;
  content: string;
}): Promise<{ data: ChatRow; error?: never } | { error: string; data?: never }> {
  const userId = await getUserId();

  if (!userId) {
    return { error: "Not authenticated" };
  }

  const adminClient = createAdminClient();

  const seen = await seeGift(adminClient, data.group_gift_id, userId);
  if (!seen.ok) return { error: seen.error };

  const content = typeof data.content === "string" ? data.content.trim() : "";
  if (content === "") return { error: GIFT_SENTENCES.messageMissing };
  if (content.length > GIFT_LIMITS.message) return { error: GIFT_SENTENCES.messageTooLong };
  if (CONTROL_EXCEPT_NOTES_WHITESPACE.test(content)) return { error: GIFT_SENTENCES.characters };

  const { data: message, error } = await adminClient
    .from("messages")
    .insert({
      group_gift_id: seen.gift.id,
      user_id: userId,
      content,
      attachment_url: null,
      is_edited: false,
    })
    .select(MESSAGE_COLUMNS)
    .single();

  if (error) {
    return { error: error.message };
  }

  revalidatePath(`/gifts/${seen.gift.id}`);

  // The message is saved by now, so a profile that cannot be read is answered as none rather than as a failure,
  // which would have the message sent again.
  let sender: GiftPerson | null = null;
  try {
    sender = (await giftPeople(adminClient, [userId])).get(userId) ?? null;
  } catch (e) {
    console.error("sendMessage: the sender's profile could not be read:", messageOf(e));
  }

  return { data: chatRow(message, sender) };
}

/** Where a page of the chat starts: a message of the gift, by when it was sent, then by its id. */
interface Place {
  id: string;
  created_at: string;
}

/**
 * The messages strictly before or after a place, as a PostgREST logic tree for `.or()`: sent earlier (later), or in
 * the same instant with a smaller (larger) id, so messages sent in one instant keep one order and no page skips or
 * repeats one. The time is in double quotes, since it holds `:` and `.`, which PostgREST reads as its own. Both
 * values are the place's own row as the database read it, never the caller's words.
 */
const strictly = (way: "lt" | "gt", place: Place) =>
  `created_at.${way}."${place.created_at}",and(created_at.eq."${place.created_at}",id.${way}.${place.id})`;

/** The one place a page was asked from: none when neither or both are given, or the one given is not text. */
function placeAsked(page: unknown): { id: string; way: "before" | "after" } | null {
  const { before, after } = (page ?? {}) as { before?: unknown; after?: unknown };
  if (before != null && after != null) return null;
  if (typeof before === "string") return { id: before, way: "before" };
  if (typeof after === "string") return { id: after, way: "after" };
  return null;
}

/**
 * A page of a gift's chat, for someone who can see the gift (seeGift; its sentence, and nothing of the chat read,
 * for anyone else). `data` is oldest first, by when each was sent, then by id; each message carries its sender's
 * profile.
 *
 * With no page: the newest GIFT_LIMITS.page messages, and hasEarlier says whether an older one exists. `before` a
 * message: the GIFT_LIMITS.page messages just before it, and hasEarlier likewise. `after` a message: every message
 * after it, oldest first, up to GIFT_LIMITS.newer, and hasEarlier false. A place that is no message of this gift
 * (it was deleted, say), both places at once, or one that is not text is answered as no page.
 */
export async function getMessages(
  groupGiftId: string,
  page: { before?: string; after?: string } = {}
): Promise<
  { data: ChatRow[]; hasEarlier: boolean; error?: never } | { error: string; data?: never; hasEarlier?: never }
> {
  const userId = await getUserId();

  if (!userId) {
    return { error: "Not authenticated" };
  }

  const adminClient = createAdminClient();

  const seen = await seeGift(adminClient, groupGiftId, userId);
  if (!seen.ok) return { error: seen.error };
  const giftId = seen.gift.id;

  const wanted = placeAsked(page);
  let place: Place | null = null;
  if (wanted) {
    const found = await adminClient
      .from("messages")
      .select("id, created_at")
      .eq("id", wanted.id)
      .eq("group_gift_id", giftId)
      .maybeSingle();
    if (found.error) return { error: found.error.message };
    place = found.data;
  }

  const chat = adminClient.from("messages").select(MESSAGE_COLUMNS).eq("group_gift_id", giftId);
  let rows: Omit<ChatRow, "user_profiles">[];
  let hasEarlier: boolean;

  if (place && wanted?.way === "after") {
    const { data, error } = await chat
      .or(strictly("gt", place))
      .order("created_at", { ascending: true })
      .order("id", { ascending: true })
      .limit(GIFT_LIMITS.newer);
    if (error) return { error: error.message };
    rows = data ?? [];
    hasEarlier = false;
  } else {
    // Newest first, one more than a page: that one only says an earlier message exists.
    const { data, error } = await (place ? chat.or(strictly("lt", place)) : chat)
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .limit(GIFT_LIMITS.page + 1);
    if (error) return { error: error.message };
    const newestFirst = data ?? [];
    hasEarlier = newestFirst.length > GIFT_LIMITS.page;
    rows = newestFirst.slice(0, GIFT_LIMITS.page).reverse();
  }

  try {
    const people = await giftPeople(adminClient, rows.map((r) => r.user_id));
    return { data: rows.map((r) => chatRow(r, people.get(r.user_id) ?? null)), hasEarlier };
  } catch (e) {
    return { error: messageOf(e) };
  }
}

/**
 * Edit a message (user can only edit their own messages)
 */
export async function editMessage(messageId: string, data: MessageEditData) {
  const supabase = await createClient();

  const userId = await getUserId();

  if (!userId) {
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

  if (message.user_id !== userId) {
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

  const userId = await getUserId();

  if (!userId) {
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

  if (message.user_id !== userId) {
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
  const adminClient = createAdminClient();

  const userId = await getUserId();

  if (!userId) {
    return false;
  }

  // Check if user is a member of the group gift using admin client to bypass RLS
  const { data: membership } = await adminClient
    .from("group_gift_members")
    .select("id")
    .eq("group_gift_id", groupGiftId)
    .eq("user_id", userId)
    .single();

  return !!membership;
}
