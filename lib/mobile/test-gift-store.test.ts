import { describe, it, expect } from "vitest";
import { memoryGiftStore } from "./test-gift-store";
import { SAM, world } from "./test-shopping";

const store = () => memoryGiftStore(SAM, { gifts: world().gifts.map((g) => ({ ...g, user_id: SAM })) });
const SCARF = world().gifts[3]; // planned

describe("memoryGiftStore.updateGift with an expected status", () => {
  it("writes when the stored status is the expected one", async () => {
    const s = store();
    const r = await s.updateGift(SCARF.id, { status: "ordered" }, { status: "planned" });
    expect(r).toMatchObject({ ok: true, row: { status: "ordered" } });
  });
  it("answers null and writes nothing when the stored status has moved", async () => {
    const s = store();
    expect(await s.updateGift(SCARF.id, { status: "arrived" }, { status: "ordered" })).toBeNull();
    expect(s.allGifts().find((g) => g.id === SCARF.id)!.status).toBe("planned");
    expect(s.writes).toEqual([]);
  });
  it("still writes without an expectation", async () => {
    const s = store();
    expect(await s.updateGift(SCARF.id, { status: "arrived" })).toMatchObject({ ok: true });
  });
});
