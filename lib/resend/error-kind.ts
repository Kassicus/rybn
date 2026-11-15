/**
 * What is logged of the email service's error: its name, and its status or
 * code. Never its message, which can quote the address.
 */
export function emailErrorKind(error: unknown): string {
  if (typeof error !== "object" || error === null) return typeof error;
  const { name, statusCode, code } = error as { name?: unknown; statusCode?: unknown; code?: unknown };
  const parts = [name, statusCode ?? code].filter(
    (part) => typeof part === "string" || typeof part === "number"
  );
  return parts.length > 0 ? parts.join(", ") : "no name";
}
