import { withSignedGiftPhotos } from "@/lib/supabase/signed-image";
import type { GiftStore } from "./gift-store";
import { buildGiftViews, heldItemIds, type GiftView } from "./gifts";
import { occasionFromRow } from "./occasions";
import { linkedItems, occasionRows, profiles } from "./people-live";

/**
 * The caller's gifts as the app shows them. Every occasion a gift is filed under is loaded, past ones included:
 * without its row a gift's season falls back to the year it was created and the date rule stops applying.
 * Whether the caller can still see a gift's item is decided by the database, through linkedItems.
 */
export async function loadGiftViews(userId: string, store: GiftStore, today: string): Promise<GiftView[]> {
  const [gifts, recipients, claims] = await Promise.all([store.gifts(), store.recipients(), store.activeClaims()]);
  const itemIds = gifts.flatMap((g) => (g.wishlist_item_id === null ? [] : [g.wishlist_item_id]));
  const occasionIds = gifts.flatMap((g) => (g.occasion_id === null ? [] : [g.occasion_id]));
  const [items, rows] = await Promise.all([linkedItems(itemIds, userId), occasionRows(occasionIds)]);

  const peopleIds = [
    ...[...items.values()].map((i) => i.ownerId),
    ...recipients.flatMap((r) => (r.person_id === null ? [] : [r.person_id])),
    ...rows.flatMap((r) => [r.celebrant_id, r.partner_id].filter((id): id is string => id !== null)),
  ];
  const people = await profiles(peopleIds);
  const signed = await withSignedGiftPhotos(gifts);
  return buildGiftViews(signed, {
    recipients: new Map(recipients.map((r) => [r.id, r])),
    items,
    held: heldItemIds(claims, today),
    claimedAt: new Map(claims.map((c) => [c.itemId, c.claimedAt])),
    occasions: new Map(rows.map((r) => [r.id, occasionFromRow(r, people)])),
    profiles: people,
    today,
  });
}
