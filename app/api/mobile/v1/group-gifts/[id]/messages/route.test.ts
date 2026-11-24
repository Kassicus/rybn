import { describe, it, expect, vi, beforeEach } from "vitest";
import { GIFT_SENTENCES } from "@/lib/gifts/sentences";
import { fixture } from "@/lib/mobile/test-fixtures";
import type { GroupGiftMocks } from "@/lib/mobile/test-group-gifts";

const holder = vi.hoisted(() => ({ current: undefined as unknown as GroupGiftMocks }));

vi.mock("@/lib/auth/ensure-profile", () => ({ ensureProfile: async () => "user_2abcDEF" }));
vi.mock("@/lib/actions/gifts", () => ({
  createGroupGift: (...a: unknown[]) => holder.current.createGroupGift(...a),
  getMyGroupGifts: (...a: unknown[]) => holder.current.getMyGroupGifts(...a),
  getGroupGiftById: (...a: unknown[]) => holder.current.getGroupGiftById(...a),
  getGroupGiftChoices: (...a: unknown[]) => holder.current.getGroupGiftChoices(...a),
  updateMyContribution: (...a: unknown[]) => holder.current.updateMyContribution(...a),
  getAvailableGroupMembers: (...a: unknown[]) => holder.current.getAvailableGroupMembers(...a),
  addMembersToGroupGift: (...a: unknown[]) => holder.current.addMembersToGroupGift(...a),
  deleteGroupGift: (...a: unknown[]) => holder.current.deleteGroupGift(...a),
}));
vi.mock("@/lib/actions/messages", () => ({
  getMessages: (...a: unknown[]) => holder.current.getMessages(...a),
  sendMessage: (...a: unknown[]) => holder.current.sendMessage(...a),
}));

const { GET, POST } = await import("./route");
const { bearer } = await import("@/lib/mobile/test-shopping-mocks");
const { GIFT_IDS, groupGiftMocks } = await import("@/lib/mobile/test-group-gifts");

const url = (id: string, query = "") => `http://localhost/api/mobile/v1/group-gifts/${id}/messages${query}`;
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
const get = (query = "", id: string = GIFT_IDS.weekend) => GET(bearer(url(id, query)), ctx(id));
const post = (body: unknown, id: string = GIFT_IDS.weekend) =>
  POST(bearer(url(id), { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }), ctx(id));
const message = async (res: Response) => [res.status, (await res.json()).error] as const;
const INVALID = { code: "invalid", message: "That request wasn't valid." };
const PLACE = "a1000000-0000-4000-8000-000000000002";

beforeEach(() => {
  holder.current = groupGiftMocks();
  vi.stubEnv("MOBILE_MIN_BUILD", "");
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("GET /api/mobile/v1/group-gifts/{id}/messages", () => {
  it("answers the newest messages and whether there are earlier ones", async () => {
    const res = await get("", GIFT_IDS.weekend.toUpperCase());
    expect([res.status, res.headers.get("cache-control")]).toEqual([200, "no-store"]);
    expect(await res.json()).toEqual(fixture("messages"));
    expect(holder.current.getMessages.mock.calls).toEqual([[GIFT_IDS.weekend, {}]]);
  });

  it("says there are earlier messages when the action does", async () => {
    holder.current.getMessages.mockImplementation(async () => ({ data: [], hasEarlier: true }));
    expect(await (await get()).json()).toEqual({ messages: [], hasEarlier: true });
  });

  it("passes a place on", async () => {
    await get(`?before=${PLACE}`);
    await get(`?after=${PLACE.toUpperCase()}`);
    expect(holder.current.getMessages.mock.calls).toEqual([
      [GIFT_IDS.weekend, { before: PLACE }],
      [GIFT_IDS.weekend, { after: PLACE }],
    ]);
  });

  it("answers 422 That request wasn't valid. for both places at once, or one that is not a UUID", async () => {
    for (const query of [`?before=${PLACE}&after=${PLACE}`, "?before=x", "?after=x", "?before=", "?after=user_2abcDEF"]) {
      expect(await message(await get(query))).toEqual([422, INVALID]);
    }
    expect(holder.current.getMessages).not.toHaveBeenCalled();
  });

  it("names a sender with no profile Someone", async () => {
    const rows = (await holder.current.getMessages()).data;
    holder.current.getMessages.mockResolvedValue({ data: [{ ...rows[0], user_profiles: null }], hasEarlier: false });
    const { messages } = await (await get()).json();
    expect(messages[0].person).toEqual({ id: "user_2alxABC", name: "Someone", username: null, avatarUrl: null });
  });

  it("answers 404 for someone the gift is for, on both methods", async () => {
    holder.current.getMessages.mockResolvedValue({ error: GIFT_SENTENCES.notThere });
    holder.current.sendMessage.mockResolvedValue({ error: GIFT_SENTENCES.notThere });
    const body = fixture("message-request");
    const [getGone, getNotUuid] = [await get(), await get("", "x")];
    const [postGone, postNotUuid] = [await post(body), await post(body, "x")];
    expect([getGone.status, getNotUuid.status, postGone.status, postNotUuid.status]).toEqual([404, 404, 404, 404]);
    expect(await getGone.text()).toBe(await getNotUuid.text());
    expect(await postGone.text()).toBe(await postNotUuid.text());
    // The two methods answer alike too.
    expect(await (await get()).text()).toBe(await (await post(body)).text());
    // The ids that are not UUIDs asked nothing: one action call per method for the real id, then one more of each.
    expect(holder.current.getMessages).toHaveBeenCalledTimes(2);
    expect(holder.current.sendMessage).toHaveBeenCalledTimes(2);
  });

  it("answers 401 without a bearer, on both methods", async () => {
    expect((await GET(new Request(url(GIFT_IDS.weekend)), ctx(GIFT_IDS.weekend))).status).toBe(401);
    const unsigned = new Request(url(GIFT_IDS.weekend), { method: "POST", body: JSON.stringify(fixture("message-request")) });
    expect((await POST(unsigned, ctx(GIFT_IDS.weekend))).status).toBe(401);
    expect(holder.current.getMessages).not.toHaveBeenCalled();
    expect(holder.current.sendMessage).not.toHaveBeenCalled();
  });

  it("answers 500 without the database's words for any other error", async () => {
    holder.current.getMessages.mockResolvedValue({ error: "connection reset" });
    const res = await get();
    const text = await res.text();
    expect(res.status).toBe(500);
    expect(text).not.toContain("connection");
  });

  it("answers 500 for a sentence that is not one of this route's", async () => {
    holder.current.getMessages.mockResolvedValue({ error: GIFT_SENTENCES.onlyMakerAdds });
    expect((await get()).status).toBe(500);
  });
});

describe("POST /api/mobile/v1/group-gifts/{id}/messages", () => {
  it("sends the request fixture and answers the message fixture", async () => {
    const res = await post(fixture("message-request"), GIFT_IDS.weekend.toUpperCase());
    expect([res.status, res.headers.get("cache-control")]).toEqual([200, "no-store"]);
    expect(await res.json()).toEqual(fixture("message"));
    expect(holder.current.sendMessage.mock.calls).toEqual([
      [{ group_gift_id: GIFT_IDS.weekend, content: "Book it. I'll sort the card." }],
    ]);
  });

  it("sends the trimmed text", async () => {
    await post({ text: "  hello\n  " });
    expect(holder.current.sendMessage.mock.calls[0][0].content).toBe("hello");
  });

  it("answers 422 with the action's sentence for an empty or a long message", async () => {
    const cases: [unknown, string][] = [
      [{ text: " \n " }, "Write a message first."],
      [{ text: "x".repeat(5001) }, "Keep the message to 5000 characters or fewer."],
      [{ text: "a\u0007b" }, "That has characters Rybn can't save. Try typing it again."],
    ];
    for (const [body, sentence] of cases) {
      expect(await message(await post(body))).toEqual([422, { code: "invalid", message: sentence }]);
    }
    expect(holder.current.sendMessage).not.toHaveBeenCalled();
  });

  it("passes on the action's own sentence for a message it refuses", async () => {
    for (const sentence of [GIFT_SENTENCES.messageMissing, GIFT_SENTENCES.messageTooLong, GIFT_SENTENCES.characters]) {
      holder.current.sendMessage.mockResolvedValue({ error: sentence });
      expect(await message(await post(fixture("message-request")))).toEqual([422, { code: "invalid", message: sentence }]);
    }
  });

  it("answers the plain sentence for a body of another shape", async () => {
    for (const body of [{}, { text: 5 }, { text: null }, [], "x", null]) {
      expect(await message(await post(body))).toEqual([422, INVALID]);
    }
    expect(holder.current.sendMessage).not.toHaveBeenCalled();
  });

  it("answers 500 without the database's words for any other error", async () => {
    holder.current.sendMessage.mockResolvedValue({ error: 'insert or update on table "messages" violates foreign key constraint' });
    const res = await post(fixture("message-request"));
    const text = await res.text();
    expect(res.status).toBe(500);
    expect(text).not.toContain("violates");
  });
});
