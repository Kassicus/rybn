/**
 * The rules for a wishlist item's details (Size, Color, and so on): the kinds, the limits, the sentences, how what a
 * form or a request sent is cleaned and checked, and how the stored column is read back. The website's forms, its
 * server actions and the mobile routes all go through here, so they accept and refuse the same things in the same
 * words. The database's check constraint on wishlist_items.details accepts exactly the shape cleanDetails answers.
 *
 * Imports only the shared character rules: the browser's forms load it.
 */

import { CHARACTERS_REFUSED, CONTROL } from "@/lib/utils/characters";

/** Every kind, in the order they are offered. */
export const DETAIL_KINDS = ["size", "color", "style", "version", "brand", "other"] as const;
export type DetailKind = (typeof DETAIL_KINDS)[number];

/** The label shown for each named kind. `other` carries the label the person typed. */
export const DETAIL_LABELS: Record<Exclude<DetailKind, "other">, string> = {
  size: "Size",
  color: "Color",
  style: "Style",
  version: "Version or model",
  brand: "Brand",
};

/** Lengths are UTF-16 units after cleaning; `own` is the most `other` entries; `total` the most entries. */
export const DETAIL_LIMITS = { value: 100, label: 30, own: 5, total: 10 } as const;

export const DETAIL_SENTENCES = {
  valueTooLong: "Keep each detail to 100 characters or fewer.",
  labelMissing: "Give the detail a name.",
  labelTooLong: "Keep a detail's name to 30 characters or fewer.",
  refused: "That detail can't be saved. Try adding it again.",
};

/** As stored: `label` only on `other`. */
export interface StoredDetail {
  kind: DetailKind;
  value: string;
  label?: string;
}

/** As answered and as a form holds it: `label` always. */
export interface ShownDetail {
  kind: string;
  label: string;
  value: string;
}

type Cleaned = { ok: true; details: StoredDetail[] } | { ok: false; message: string };

const refuse = (message: string): Cleaned => ({ ok: false, message });

function isKind(kind: unknown): kind is DetailKind {
  return typeof kind === "string" && (DETAIL_KINDS as readonly string[]).includes(kind);
}

/** Trims, and turns every run of line breaks and tabs into one space. */
function tidy(text: string): string {
  return text.trim().replace(/[\r\n\t]+/g, " ");
}

/** What a form or a request sent, cleaned and checked: the list to store, or the sentence that says why not. */
export function cleanDetails(raw: unknown): Cleaned {
  if (!Array.isArray(raw)) return refuse(DETAIL_SENTENCES.refused);

  const details: StoredDetail[] = [];
  for (const entry of raw) {
    if (typeof entry !== "object" || entry === null || Array.isArray(entry)) {
      return refuse(DETAIL_SENTENCES.refused);
    }
    const { kind, value, label } = entry as Record<string, unknown>;
    if (!isKind(kind) || typeof value !== "string") return refuse(DETAIL_SENTENCES.refused);
    // A named kind's label is never read; an own kind's may be missing, which is its own sentence.
    if (kind === "other" && label != null && typeof label !== "string") {
      return refuse(DETAIL_SENTENCES.refused);
    }

    const text = tidy(value);
    if (text === "") continue;
    if (CONTROL.test(text)) return refuse(CHARACTERS_REFUSED);
    if (text.length > DETAIL_LIMITS.value) return refuse(DETAIL_SENTENCES.valueTooLong);

    if (kind !== "other") {
      details.push({ kind, value: text });
      continue;
    }

    const name = tidy(typeof label === "string" ? label : "");
    if (name === "") return refuse(DETAIL_SENTENCES.labelMissing);
    if (CONTROL.test(name)) return refuse(CHARACTERS_REFUSED);
    if (name.length > DETAIL_LIMITS.label) return refuse(DETAIL_SENTENCES.labelTooLong);
    details.push({ kind, label: name, value: text });
  }

  // The counting rules run on the cleaned list, after entries with no text are gone.
  if (details.length > DETAIL_LIMITS.total) return refuse(DETAIL_SENTENCES.refused);
  const named = details.filter((d) => d.kind !== "other");
  if (new Set(named.map((d) => d.kind)).size !== named.length) return refuse(DETAIL_SENTENCES.refused);
  if (details.length - named.length > DETAIL_LIMITS.own) return refuse(DETAIL_SENTENCES.refused);

  return { ok: true, details };
}

/** The column as read, for an answer or a page. Anything that is not a list of readable entries reads as []. */
export function shownDetails(stored: unknown): ShownDetail[] {
  if (!Array.isArray(stored)) return [];

  const shown: ShownDetail[] = [];
  for (const entry of stored) {
    if (typeof entry !== "object" || entry === null || Array.isArray(entry)) continue;
    const { kind, value, label } = entry as Record<string, unknown>;
    if (typeof kind !== "string" || typeof value !== "string") continue;

    let name: string;
    if (Object.hasOwn(DETAIL_LABELS, kind)) name = DETAIL_LABELS[kind as keyof typeof DETAIL_LABELS];
    else if (typeof label === "string" && label !== "") name = label;
    else name = kind === "other" ? "Other" : kind;
    shown.push({ kind, label: name, value });
  }
  return shown;
}
