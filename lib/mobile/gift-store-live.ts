import { createClient } from "@/lib/supabase/server";
import { resolveStoredImageValue } from "@/lib/storage/image-value";
import type { GiftPatch, GiftStore, NewGift } from "./gift-store";
import type { ClaimRow, RecipientRow, StoredGift } from "./gifts";
import type { PersonRow } from "./occasions";

const GIFT_COLUMNS =
  "id, recipient_id, name, description, photo_url, product_link, price, status, wishlist_item_id, from_list, occasion_id, season_year, notes, is_archived, created_at, updated_at";
const RECIPIENT_COLUMNS = "id, name, person_id";
const CLAIM_COLUMNS =
  "item_id, occasion_id, occasions ( occasion_date ), wishlist_items ( id, user_id, title, description, url, price, image_url, purchased )";
const OWNER_COLUMNS = "id, username, display_name, avatar_url";

type DbError = { code?: string; message: string };

/** The clash an insert or update reported, by the index it names; null for anything else. */
function clashOf(error: DbError, indexes: Record<string, string>): string | null {
  if (error.code !== "23505") return null;
  for (const [index, clash] of Object.entries(indexes)) {
    if (error.message.includes(index)) return clash;
  }
  return null;
}

function failure(method: string, error: DbError): Error {
  return Object.assign(new Error(`${method} failed: ${error.message}`), { code: error.code });
}

const toGift = (r: StoredGift): StoredGift => ({
  id: r.id,
  recipient_id: r.recipient_id,
  name: r.name,
  description: r.description,
  photo_url: r.photo_url,
  product_link: r.product_link,
  price: r.price,
  status: r.status,
  wishlist_item_id: r.wishlist_item_id,
  from_list: r.from_list,
  occasion_id: r.occasion_id,
  season_year: r.season_year,
  notes: r.notes,
  is_archived: r.is_archived,
  created_at: r.created_at,
  updated_at: r.updated_at,
});

const toRecipient = (r: RecipientRow): RecipientRow => ({ id: r.id, name: r.name, person_id: r.person_id });

interface ClaimDbRow {
  item_id: string;
  occasion_id: string | null;
  occasions: { occasion_date: string } | null;
  wishlist_items: {
    id: string;
    user_id: string;
    title: string;
    description: string | null;
    url: string | null;
    price: number | null;
    image_url: string | null;
    purchased: boolean;
  } | null;
}

/** The caller's own client keeps every query to their rows under RLS; each is also filtered to them. */
export async function createGiftStore(userId: string): Promise<GiftStore> {
  const supabase = await createClient();

  /** A refusal throws: a picture value that is not an outside address or the caller's own path is never written. */
  function storedPhoto(method: string, value: string | null | undefined) {
    const r = resolveStoredImageValue(value, userId);
    if (!r.ok) throw new Error(`${method} failed: ${r.error}`);
    return r.value;
  }

  return {
    async activeClaims() {
      const { data, error } = await supabase
        .from("wishlist_claims")
        .select(CLAIM_COLUMNS)
        .eq("claimed_by", userId)
        .is("released_at", null);
      if (error) throw failure("activeClaims", error);
      const rows = (data ?? []) as unknown as ClaimDbRow[];

      const ownerIds = [...new Set(rows.flatMap((r) => (r.wishlist_items ? [r.wishlist_items.user_id] : [])))];
      const owners = new Map<string, PersonRow>();
      if (ownerIds.length > 0) {
        const { data: people, error: peopleError } = await supabase
          .from("user_profiles")
          .select(OWNER_COLUMNS)
          .in("id", ownerIds);
        if (peopleError) throw failure("activeClaims", peopleError);
        for (const p of people ?? []) {
          owners.set(p.id, { id: p.id, username: p.username, display_name: p.display_name, avatar_url: p.avatar_url });
        }
      }

      return rows.map((r): ClaimRow => {
        const item = r.wishlist_items;
        return {
          itemId: r.item_id,
          occasionId: r.occasion_id,
          occasionDate: r.occasions?.occasion_date ?? null,
          item: item
            ? {
                id: item.id,
                ownerId: item.user_id,
                title: item.title,
                description: item.description,
                url: item.url,
                price: item.price,
                imageValue: item.image_url,
                purchased: item.purchased,
              }
            : null,
          owner: item ? (owners.get(item.user_id) ?? null) : null,
        };
      });
    },

    async gifts() {
      const { data, error } = await supabase
        .from("tracked_gifts")
        .select(GIFT_COLUMNS)
        .eq("user_id", userId)
        .order("created_at", { ascending: true });
      if (error) throw failure("gifts", error);
      return (data ?? []).map(toGift);
    },

    async recipients() {
      const { data, error } = await supabase.from("gift_recipients").select(RECIPIENT_COLUMNS).eq("user_id", userId);
      if (error) throw failure("recipients", error);
      return (data ?? []).map(toRecipient);
    },

    async insertRecipient(row) {
      const { data, error } = await supabase
        .from("gift_recipients")
        .insert({ user_id: userId, name: row.name, person_id: row.person_id })
        .select(RECIPIENT_COLUMNS)
        .single();
      if (error) {
        const clash = clashOf(error, {
          gift_recipients_one_per_person: "person",
          gift_recipients_user_id_name_key: "name",
        });
        if (clash === "person" || clash === "name") return { ok: false, clash };
        throw failure("insertRecipient", error);
      }
      return { ok: true, row: toRecipient(data) };
    },

    async insertGift(row: NewGift) {
      const photo = storedPhoto("insertGift", row.photo_url);
      const { data, error } = await supabase
        .from("tracked_gifts")
        .insert({ ...row, photo_url: photo, user_id: userId })
        .select(GIFT_COLUMNS)
        .single();
      if (error) {
        if (clashOf(error, { tracked_gifts_one_per_item: "item" }) === "item") return { ok: false, clash: "item" };
        throw failure("insertGift", error);
      }
      return { ok: true, row: toGift(data) };
    },

    async updateGift(id: string, patch: GiftPatch) {
      const { photo_url: photoUrl, ...rest } = patch;
      const write = photoUrl === undefined ? rest : { ...rest, photo_url: storedPhoto("updateGift", photoUrl) };
      const { data, error } = await supabase
        .from("tracked_gifts")
        .update(write)
        .eq("id", id)
        .eq("user_id", userId)
        .select(GIFT_COLUMNS)
        .maybeSingle();
      if (error) {
        if (clashOf(error, { tracked_gifts_one_per_item: "item" }) === "item") return { ok: false, clash: "item" };
        throw failure("updateGift", error);
      }
      return data ? { ok: true, row: toGift(data) } : null;
    },

    async deleteGift(id: string) {
      const { error } = await supabase.from("tracked_gifts").delete().eq("id", id).eq("user_id", userId);
      if (error) throw failure("deleteGift", error);
    },
  };
}
