"use server";

import { createClient } from "@/lib/supabase/server";
import { getUserId } from "@/lib/auth/require-auth";
import { deleteSignInAccount } from "@/lib/auth/clerk-users";
import { ACCOUNT_SENTENCES } from "@/lib/account/sentences";
import type { ImageBucket } from "@/lib/supabase/signed-image";

/**
 * The buckets a person's pictures are kept in. Both upload paths file a
 * picture flat under `<userId>/` (picturePath in lib/mobile/picture.ts, and
 * components/ui/image-input.tsx), and the storage policies let a person list
 * and remove their own folder.
 */
const PICTURE_BUCKETS: readonly ImageBucket[] = ["wishlist-images", "gift-photos"];

/** The most names one list answers, and the most paths one remove is given. */
const PAGE_SIZE = 1000;

type Supabase = Awaited<ReturnType<typeof createClient>>;

/**
 * Removes everything filed under `<userId>/` in one bucket, and answers
 * whether it could. Every page of names is read before anything is removed,
 * so removing never moves a name out from under the next page.
 */
async function removePictures(
  supabase: Supabase,
  bucket: ImageBucket,
  userId: string
): Promise<boolean> {
  const storage = supabase.storage.from(bucket);

  const names: string[] = [];
  for (let offset = 0; ; offset += PAGE_SIZE) {
    const { data, error } = await storage.list(userId, { limit: PAGE_SIZE, offset });
    if (error) {
      console.error(`deleteAccount: could not list the pictures in ${bucket}`, error);
      return false;
    }
    names.push(...data.map((file) => file.name));
    if (data.length < PAGE_SIZE) break;
  }

  for (let start = 0; start < names.length; start += PAGE_SIZE) {
    const paths = names
      .slice(start, start + PAGE_SIZE)
      .map((name) => `${userId}/${name}`);
    const { error } = await storage.remove(paths);
    if (error) {
      console.error(`deleteAccount: could not remove the pictures in ${bucket}`, error);
      return false;
    }
  }

  return true;
}

/**
 * Deletes the caller's account, in steps that can be run again: their
 * pictures in both buckets, then their account in the database
 * (delete_account(), which hands each group they own to the member who has
 * been there longest), then the email telling them so, then their sign-in
 * account. A step that fails answers ACCOUNT_SENTENCES.deleteFailed and stops
 * the ones after it; the next try finds less to do and finishes the rest.
 *
 * It knows the caller from getUserId alone and never makes a profile: a try
 * after one that stopped half way finds no profile, and must not make one.
 *
 * The address is read before the database deletes the profile it is in. The
 * email is sent only when there is one, and a refused or failed email is
 * logged without the address while the deletion goes on.
 */
export async function deleteAccount(): Promise<{ success: true } | { error: string }> {
  const userId = await getUserId();
  if (!userId) {
    return { error: "Not authenticated" };
  }

  const supabase = await createClient();

  for (const bucket of PICTURE_BUCKETS) {
    if (!(await removePictures(supabase, bucket, userId))) {
      return { error: ACCOUNT_SENTENCES.deleteFailed };
    }
  }

  const { data: profile, error: readError } = await supabase
    .from("user_profiles")
    .select("email")
    .eq("id", userId)
    .maybeSingle();
  if (readError) {
    console.error("deleteAccount: could not read the profile", readError);
    return { error: ACCOUNT_SENTENCES.deleteFailed };
  }
  const email = profile?.email ?? null;

  const { error: deleteError } = await supabase.rpc("delete_account");
  if (deleteError) {
    console.error(`deleteAccount: delete_account failed (${deleteError.code})`, deleteError);
    return { error: ACCOUNT_SENTENCES.deleteFailed };
  }

  if (email) {
    try {
      // Imported here, not at module scope: lib/resend/client.ts throws on
      // load when its key is unset, and that must not stop a deletion.
      const { sendAccountDeletedEmail } = await import("@/lib/resend/send");
      // Resend answers a refused send as `{ error }` and throws only when the
      // request itself fails, so both are logged.
      const { error: sendError } = await sendAccountDeletedEmail(email);
      if (sendError) {
        console.error("deleteAccount: the email was refused", sendError);
      }
    } catch (error) {
      console.error("deleteAccount: the email failed", error);
    }
  }

  try {
    await deleteSignInAccount(userId);
  } catch (error) {
    console.error("deleteAccount: could not delete the sign-in account", error);
    return { error: ACCOUNT_SENTENCES.deleteFailed };
  }

  return { success: true };
}
