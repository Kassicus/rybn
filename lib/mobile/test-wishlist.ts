// Tests only. The occasions behind the wishlist fixtures: what Sam may tag an item for, and what his items are tagged for.
import type { UpcomingOccasion } from "@/lib/occasions/display";
import type { OccasionRow } from "./occasions";
import { IDS, SAM, world } from "./test-shopping";

export const TAG_IDS: Record<"samBirthday" | "xmas2025" | "tumbler" | "mug" | "socks" | "tree", string> = {
  // Sam's birthday this year. It has its row because an item is tagged for it.
  samBirthday: "8b3d5f7a-1c2e-4d6f-9a0b-2c3d4e5f6a7b",
  // Last year's Christmas in Rivera Family: it has passed, so it is no longer among the choices.
  xmas2025: "3a7c9e1b-2d4f-4a6b-8c0d-1e2f3a4b5c6d",
  tumbler: "5f0c2a9e-8d1b-4c3e-9f6a-2b7d4e1c8a90",
  mug: "a3b9c1d2-4e5f-4a6b-8c7d-9e0f1a2b3c4d",
  socks: "c4d5e6f7-0a1b-4c2d-9e3f-4a5b6c7d8e9f",
  tree: "e6f7a8b9-1c2d-4e3f-a4b5-c6d7e8f9a0b1",
};

export const KEYS = {
  samBirthday: "birthday:user_2abcDEF:2026",
  xmas: IDS.xmasKey,
  xmas2025: `group_date:${TAG_IDS.xmas2025}`,
};

export function tagging() {
  const w = world();
  const upcoming: UpcomingOccasion[] = w.upcoming.map((o) =>
    o.kind === "birthday" && o.celebrantId === SAM ? { ...o, occasionId: TAG_IDS.samBirthday } : o);
  const occasionRows: OccasionRow[] = [
    ...w.occasionRows,
    { id: TAG_IDS.samBirthday, kind: "birthday", name: null, occasion_date: "2026-11-30", celebrant_id: SAM,
      partner_id: null, group_id: null, groups: null },
    { id: TAG_IDS.xmas2025, kind: "group_date", name: "Christmas 2025", occasion_date: "2025-12-25", celebrant_id: null,
      partner_id: null, group_id: IDS.rivera, groups: { name: "Rivera Family" } },
  ];
  // As getTagsForItems answers: in the order stored, which is not the order the app is sent.
  const tags: Record<string, string[]> = {
    [TAG_IDS.tumbler]: [IDS.xmas, TAG_IDS.samBirthday],
    [TAG_IDS.mug]: [IDS.xmas],
    [TAG_IDS.tree]: [TAG_IDS.xmas2025],
  };
  return { upcoming, occasionRows, tags };
}

/** getTagsForItems over `tags`: only the items asked for, and an untagged item absent. */
export function tagsFor(tags: Record<string, string[]>, ids: string[]): { data: Record<string, string[]> } {
  return { data: Object.fromEntries(Object.entries(tags).filter(([id]) => ids.includes(id))) };
}
