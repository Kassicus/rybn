import { updateRecipient } from "@/lib/actions/gift-tracking";
import { getSharedGroups } from "@/lib/actions/profile";
import { RECIPIENT_SENTENCES } from "@/lib/gift-tracking/sentences";
import { actionAnswer, databaseFailure } from "./action-response";
import { parseNotesBody } from "./gift-notes";
import { createGiftStore } from "./gift-store-live";
import type { GiftStore } from "./gift-store";
import type { RecipientRow } from "./gifts";
import { profiles } from "./people-live";
import { recipientFor } from "./reconcile";
import { mobileError } from "./route";

/**
 * The caller's row for this person: the one already tied to them, even after they have left the caller's groups;
 * otherwise, for someone the caller shares a group with (never the caller), the row made for them as the gifts code
 * makes it. The Response to send instead (404) when there is no such person for the caller.
 */
async function personRow(userId: string, store: GiftStore, rows: RecipientRow[], personId: string): Promise<Response | RecipientRow> {
  if (personId === userId) return mobileError("not_found");
  const tied = rows.find((r) => r.person_id === personId);
  if (tied) return tied;
  const shared = await getSharedGroups(personId);
  const failed = databaseFailure(shared, "getSharedGroups");
  if (failed) return failed;
  const groups = ("data" in shared ? shared.data : undefined) ?? [];
  if (groups.length === 0) return mobileError("not_found");
  const profile = (await profiles([personId])).get(personId);
  if (!profile) return mobileError("not_found");
  return recipientFor(store, profile);
}

/**
 * Saves the notes on one heading of the caller's gift list through the website's own action, so the website's tracker
 * shows them too. A typed name's row also takes the name sent; a person's row keeps its name. Saved: null, which the
 * route answers 204. A row that is not the caller's, a person they neither share a group with nor have a row for, the
 * caller themselves, and a key that names no heading answer 404, writing nothing. A name another of the caller's rows
 * has answers 422 with the website's sentence; signed out, 401; any other failure throws, so the route answers 500.
 */
export async function saveNotesAnswer(userId: string, raw: unknown): Promise<Response | null> {
  const parsed = parseNotesBody(raw);
  if (!parsed.ok) return "notFound" in parsed ? mobileError("not_found") : mobileError("invalid", parsed.message);
  const { target, notes, name } = parsed;

  const store = await createGiftStore(userId);
  const rows = await store.recipients();
  let result: object;
  if (target.kind === "recipient") {
    const row = rows.find((r) => r.id === target.recipientId);
    if (!row) return mobileError("not_found");
    if (name === null) throw new Error("parseNotesBody answered a typed name's heading without its name");
    result = await updateRecipient(row.id, { name, notes });
  } else {
    const row = await personRow(userId, store, rows, target.personId);
    if (row instanceof Response) return row;
    result = await updateRecipient(row.id, { notes });
  }
  return actionAnswer(result, "updateRecipient", { refusals: [RECIPIENT_SENTENCES.nameTaken] });
}
