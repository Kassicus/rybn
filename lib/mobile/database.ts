/**
 * What lib/mobile sends to the database and reads back from it: the ids a request may carry, and the codes its errors
 * come with. One definition of each, for every file under lib/mobile.
 */

/** The SQLSTATE of every refusal the database's own functions raise (types/database.ts); anything else is a fault. */
export const REFUSED = "22023";

/** The SQLSTATE the database raises for a request with no signed-in caller. */
export const NOT_SIGNED_IN_CODE = "28000";

export type DbError = { code?: string; message: string };

/** The fault to throw for a failed query, naming the method; it keeps the SQLSTATE for whoever catches it. */
export function failure(method: string, error: DbError): Error {
  return Object.assign(new Error(`${method} failed: ${error.message}`), { code: error.code });
}

/** A UUID as the database writes it, in lower case. */
export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** Clerk ids are letters, digits and underscores; anything else cannot be a person, so it is never sent to the database. */
export const PERSON_ID = /^[A-Za-z0-9_]{1,128}$/;

/**
 * A UUID taken from a path (an item, gift or group id), lower-cased before it is compared with anything: the database
 * reads an upper-case UUID as the same row, so everything after the door must too. Null when it cannot be a UUID, which
 * then matches nothing and is never sent to the database. (A person's id is a Clerk id, whose case matters.)
 */
export function pathUuid(raw: string): string | null {
  const id = raw.toLowerCase();
  return UUID.test(id) ? id : null;
}
