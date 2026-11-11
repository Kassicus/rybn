/** What the phone may upload as a wishlist picture. Pure: no network, no Next.js. */

export const PICTURE_MAX_BYTES = 4 * 1024 * 1024;

export const PICTURE_RULES = {
  type: "Send the picture as a JPEG or PNG.",
  size: "That picture is over 4 MB.",
  bytes: "That file isn't the picture it says it is.",
} as const;

export type PictureKind =
  | { contentType: "image/jpeg"; extension: "jpg" }
  | { contentType: "image/png"; extension: "png" };

const JPEG_START = [0xff, 0xd8, 0xff];
const PNG_START = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

function startsWith(bytes: Uint8Array, prefix: number[]): boolean {
  return bytes.length >= prefix.length && prefix.every((b, i) => bytes[i] === b);
}

/** Checks, in this order: the Content-Type, then the size, then the first bytes. */
export function checkPicture(
  contentType: string | null,
  bytes: Uint8Array,
): ({ ok: true } & PictureKind) | { ok: false; message: string } {
  const type = (contentType ?? "").split(";")[0].trim().toLowerCase();
  if (type !== "image/jpeg" && type !== "image/png") return { ok: false, message: PICTURE_RULES.type };
  if (bytes.length > PICTURE_MAX_BYTES) return { ok: false, message: PICTURE_RULES.size };
  if (type === "image/jpeg") {
    return startsWith(bytes, JPEG_START)
      ? { ok: true, contentType: "image/jpeg", extension: "jpg" }
      : { ok: false, message: PICTURE_RULES.bytes };
  }
  return startsWith(bytes, PNG_START)
    ? { ok: true, contentType: "image/png", extension: "png" }
    : { ok: false, message: PICTURE_RULES.bytes };
}

export function picturePath(userId: string, extension: "jpg" | "png", now: number, random: string): string {
  return `${userId}/${now}-${random}.${extension}`;
}
