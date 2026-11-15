import { deleteAccount } from "@/lib/actions/account";
import { databaseFailure } from "./action-response";

/**
 * Deletes the caller's account with the website's own deleteAccount, which
 * knows them from the request's sign-in and makes no profile. Deleted: null,
 * which the route answers 204. Signed out: 401. Any other failure throws, so
 * the route logs it and answers the standard 500 without the action's words;
 * the app's next try finishes what is left.
 */
export async function deleteAccountAnswer(): Promise<Response | null> {
  const result = await deleteAccount();
  return databaseFailure(result, "deleteAccount");
}
