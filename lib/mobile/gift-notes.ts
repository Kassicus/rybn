import { recipientSchema } from "@/lib/schemas/gift-tracking";
import { PERSON_ID, pathUuid } from "./database";
import { CONTROL, CONTROL_EXCEPT_NOTES_WHITESPACE, RULES } from "./wishlist";

/** A heading of the gift list, as its `key` names it: a person the caller gives to, or one of their typed names. */
export type HeadingKey = { kind: "person"; personId: string } | { kind: "recipient"; recipientId: string };

const PERSON = "person:";
const RECIPIENT = "recipient:";

/** "person:" and a person's id, or "recipient:" and a UUID (lower-cased, as pathUuid reads it); anything else is null. */
export function parseHeadingKey(key: string): HeadingKey | null {
  if (key.startsWith(PERSON)) {
    const personId = key.slice(PERSON.length);
    return PERSON_ID.test(personId) ? { kind: "person", personId } : null;
  }
  if (key.startsWith(RECIPIENT)) {
    const recipientId = pathUuid(key.slice(RECIPIENT.length));
    return recipientId === null ? null : { kind: "recipient", recipientId };
  }
  return null;
}

const isObject = (raw: unknown): raw is Record<string, unknown> =>
  typeof raw === "object" && raw !== null && !Array.isArray(raw);

const firstMessage = (issues: readonly { message: string }[]) => issues[0]?.message ?? RULES.request;

/**
 * The body of PUT /gifts/notes, `{ key, notes, name? }`, checked with the website's own rules for a recipient
 * (recipientSchema) and answering its sentences. Before those, the gift door's rule for characters Rybn can't save
 * (parseGiftBody in gifts.ts, with the same patterns and RULES.characters): notes as it checks a gift's notes, which
 * may hold a tab, a line feed and a carriage return, and a typed name, once trimmed, as it checks a recipient's name.
 * A person's heading takes no name: the row tied to them keeps the name the gifts code gave it. A typed name's heading
 * must send its name, which is trimmed; the notes are kept as written, and "" clears them. A key that names no heading
 * is not found.
 */
export function parseNotesBody(raw: unknown):
  | { ok: true; target: HeadingKey; notes: string; name: string | null }
  | { ok: false; notFound: true }
  | { ok: false; message: string } {
  if (!isObject(raw) || typeof raw.key !== "string") return { ok: false, message: RULES.request };
  const target = parseHeadingKey(raw.key);
  if (target === null) return { ok: false, notFound: true };

  if (typeof raw.notes !== "string") return { ok: false, message: RULES.request };
  if (CONTROL_EXCEPT_NOTES_WHITESPACE.test(raw.notes)) return { ok: false, message: RULES.characters };
  const notes = recipientSchema.shape.notes.safeParse(raw.notes);
  if (!notes.success) return { ok: false, message: firstMessage(notes.error.issues) };

  const hasName = Object.hasOwn(raw, "name");
  if (target.kind === "person") {
    if (hasName) return { ok: false, message: RULES.request };
    return { ok: true, target, notes: raw.notes, name: null };
  }

  // No name at all is checked as an empty one, so it answers the website's own sentence for it.
  const given = hasName ? raw.name : "";
  if (typeof given !== "string") return { ok: false, message: RULES.request };
  const trimmed = given.trim();
  if (CONTROL.test(trimmed)) return { ok: false, message: RULES.characters };
  const name = recipientSchema.shape.name.safeParse(trimmed);
  if (!name.success) return { ok: false, message: firstMessage(name.error.issues) };
  return { ok: true, target, notes: raw.notes, name: name.data };
}
