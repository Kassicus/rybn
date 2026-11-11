// Tests only. Reads the JSON contract fixtures the app's repo copies byte for byte.
import { readFileSync } from "node:fs";
import { toStored } from "@/lib/wishlist/privacy-choice";
import type { GroupRow, MobileItem, WishlistItemRow } from "./wishlist";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function fixture(name: string): any {
  return JSON.parse(readFileSync(`lib/mobile/fixtures/${name}.json`, "utf8"));
}

/** The database row for a fixture item, with the columns that must never be sent. */
export function rowFor(item: MobileItem): WishlistItemRow & Record<string, unknown> {
  return {
    id: item.id,
    title: item.title,
    description: item.description,
    url: item.url,
    price: item.price,
    image_url: item.imageUrl,
    image_path: item.imagePath,
    priority: item.priority,
    category: item.category,
    privacy_settings: toStored(item.privacy),
    created_at: item.createdAt.replace("Z", ".482913+00:00"),
    user_id: "user_2abcDEF",
    updated_at: "2026-11-12T08:00:00.000000+00:00",
    purchased: true,
    purchased_at: "2026-11-12T09:00:00.000000+00:00",
    out_of_stock_marked_by: "user_x",
    out_of_stock_marked_at: "2026-11-12T10:00:00.000000+00:00",
  };
}

/** groups.json as getMyGroups returns it: each group's columns plus the membership, in reverse order. */
export function groupRows(): GroupRow[] {
  return [...fixture("groups").groups]
    .reverse()
    .map((g: { id: string; name: string; type: string }) => ({
      ...g,
      description: null,
      invite_code: "SECRET12",
      created_at: "2026-01-01T00:00:00.000000+00:00",
      created_by: "user_2abcDEF",
      myRole: "member",
      joinedAt: "2026-01-02T00:00:00+00:00",
    })) as GroupRow[];
}
