import { removeSignInPicture, setSignInPicture } from "@/lib/auth/clerk-users";
import { createClient } from "@/lib/supabase/server";
import { checkPicture } from "./picture";
import { mobileError } from "./route";

/**
 * The caller's profile picture. It lives on their sign-in account, and user_profiles.avatar_url keeps the address the
 * sign-in provider answers for it. The sign-in account changes first and the database second; a failure at either step
 * throws, so the route answers 500, and sending the same request again puts both right.
 */

/** Writes the address, or null, to the caller's own row with their own client. An error, or no row written, throws. */
async function saveAvatar(userId: string, avatarUrl: string | null): Promise<void> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("user_profiles")
    .update({ avatar_url: avatarUrl })
    .eq("id", userId)
    .select("id")
    .maybeSingle();
  if (error) throw new Error(`avatar_url update failed: ${error.message}`);
  if (data === null) throw new Error("avatar_url update wrote no row");
}

/**
 * The body of POST /profile/picture: the phone sends the picture's raw bytes (the route has no `body` option, which
 * would read JSON). A picture the other picture routes refuse answers 422 with their sentence, changing nothing.
 * Otherwise the picture is set on the sign-in account, as a file named `picture.jpg` or `picture.png` (the name an
 * upload form would send), the address it answers is written to avatar_url, and that address is answered.
 */
export async function setProfilePictureAnswer(userId: string, request: Request): Promise<Response | { avatarUrl: string }> {
  const bytes = new Uint8Array(await request.arrayBuffer());
  const kind = checkPicture(request.headers.get("content-type"), bytes);
  if (!kind.ok) return mobileError("invalid", kind.message);
  const file = new File([bytes], `picture.${kind.extension}`, { type: kind.contentType });
  const avatarUrl = await setSignInPicture(userId, file);
  await saveAvatar(userId, avatarUrl);
  return { avatarUrl };
}

/** The body of DELETE /profile/picture: removes the picture from the sign-in account, then clears avatar_url. Done: null (204). */
export async function removeProfilePictureAnswer(userId: string): Promise<null> {
  await removeSignInPicture(userId);
  await saveAvatar(userId, null);
  return null;
}
