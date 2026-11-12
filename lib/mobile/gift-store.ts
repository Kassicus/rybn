import type { GiftStatus } from "@/lib/schemas/gift-tracking";
import type { ClaimRow, RecipientRow, StoredGift } from "./gifts";

/** A gift to insert: every column the step sets. season_year is always a number, though a stored one can be null. */
export type NewGift = Omit<StoredGift, "id" | "is_archived" | "created_at" | "updated_at" | "season_year"> & { season_year: number };
/** season_year, when present, is a number, never null. */
export type GiftPatch = Partial<NewGift>;

/** The caller's own gifts, recipients and claims. Every method is scoped to the caller. */
export interface GiftStore {
  /** The caller's claims with released_at null; whether one is still held is decided by the caller. */
  activeClaims(): Promise<ClaimRow[]>;
  /** Every gift of the caller's, archived included, oldest first. */
  gifts(): Promise<StoredGift[]>;
  recipients(): Promise<RecipientRow[]>;
  insertRecipient(row: {
    name: string;
    person_id: string | null;
  }): Promise<{ ok: true; row: RecipientRow } | { ok: false; clash: "name" | "person" }>;
  insertGift(row: NewGift): Promise<{ ok: true; row: StoredGift } | { ok: false; clash: "item" }>;
  /**
   * null: no such gift of the caller's, or, with `expect`, its stored status is no longer that one (the write is
   * conditional on it, so a request that lost a race changes nothing).
   */
  updateGift(id: string, patch: GiftPatch, expect?: { status: GiftStatus }): Promise<{ ok: true; row: StoredGift } | { ok: false; clash: "item" } | null>;
  deleteGift(id: string): Promise<void>;
}
