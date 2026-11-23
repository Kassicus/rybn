import { describe, expect, it } from "vitest";
import { GIFT_SENTENCES } from "@/lib/gifts/sentences";
import type { ActionAnswers } from "./action-response";
import {
  GROUP_GIFT_ROUTE_ANSWERS,
  giftChoices,
  groupGiftPage,
  groupGiftSummary,
  money,
  parseNewGroupGiftBody,
} from "./group-gifts";
import { fixture } from "./test-fixtures";
import { groupMateRows, myGroupGifts, seenWeekend } from "./test-group-gifts";
import { SAM } from "./test-shopping";
import { RULES } from "./wishlist";

const ALEX = "user_2alxABC";

/** Columns a database row can carry that an answer must never send. */
const EXTRA = { email: "sam@example.com", target_user_id: "user_2momABC", secret_column: "kept" };

/** Every key of every object in an answer. */
function keysOf(value: unknown): Set<string> {
  const keys = new Set<string>();
  const walk = (v: unknown) => {
    if (Array.isArray(v)) v.forEach(walk);
    else if (typeof v === "object" && v !== null) {
      for (const [k, inner] of Object.entries(v)) {
        keys.add(k);
        walk(inner);
      }
    }
  };
  walk(value);
  return keys;
}

describe("the group gift shapes", () => {
  it("shapes the list answer as the fixture", () => {
    expect(myGroupGifts().map((g) => groupGiftSummary(g, SAM))).toEqual(fixture("group-gifts").groupGifts);
  });

  it("shapes one gift as the fixture", () => {
    expect(groupGiftPage(seenWeekend(), SAM)).toEqual(fixture("group-gift").groupGift);
  });

  it("keeps the order the action answers a gift's recipients in", () => {
    const gift = { ...myGroupGifts()[0], recipients: [...myGroupGifts()[0].recipients].reverse() };
    expect(groupGiftSummary(gift, SAM).recipients.map((p) => p.name)).toEqual(["Mom", "Dad"]);
    const seen = { ...seenWeekend(), recipients: [...seenWeekend().recipients].reverse() };
    expect(groupGiftPage(seen, SAM).recipients.map((p) => p.name)).toEqual(["Mom", "Dad"]);
  });

  it("sends named fields only", () => {
    const rows = myGroupGifts().map((g) => ({
      ...g, ...EXTRA, recipients: g.recipients.map((p) => ({ ...p, ...EXTRA })),
    }));
    const seen = seenWeekend();
    const page = {
      ...seen, ...EXTRA,
      my_membership: { ...seen.my_membership, ...EXTRA },
      recipients: seen.recipients.map((p) => ({ ...p, ...EXTRA })),
      group_gift_members: seen.group_gift_members.map((m) => ({
        ...m, ...EXTRA, user_profiles: m.user_profiles && { ...m.user_profiles, ...EXTRA },
      })),
      chat: { ...seen.chat, ...EXTRA, latest: seen.chat.latest && { ...seen.chat.latest, ...EXTRA } },
    };
    const answers = [...rows.map((g) => groupGiftSummary(g, SAM)), groupGiftPage(page, SAM)];
    const json = JSON.stringify(answers);
    for (const word of ["email", "target_user_id", "created_by", "secret_column", "sam@example.com"]) {
      expect(json).not.toContain(word);
    }
    const allowed = new Set([
      "id", "name", "description", "groupName", "recipients", "targetAmount", "pledged", "memberCount", "myPledge",
      "myPaid", "isMaker", "active", "members", "chat", "canAddPeople", "canDelete", "username", "avatarUrl", "person",
      "pledge", "paid", "isYou", "count", "latest", "text",
    ]);
    expect([...keysOf(answers)].filter((k) => !allowed.has(k))).toEqual([]);
    expect(answers).toEqual([...fixture("group-gifts").groupGifts, fixture("group-gift").groupGift]);
  });

  it("sends named fields only from the choices", () => {
    const data = groupMateRows();
    const answer = giftChoices({
      groups: data.groups.map((g) => ({ ...g, ...EXTRA })),
      people: data.people.map((p) => ({ ...p, ...EXTRA })),
    });
    expect(JSON.stringify(answer)).not.toMatch(/email|target_user_id|secret_column/);
    expect(answer).toEqual(fixture("group-gift-choices"));
  });

  it("writes money to the cent", () => {
    expect(money(0.1 + 0.2)).toBe(0.3);
    expect(money(19.999)).toBe(20);
    expect(money(null)).toBe(0);
    expect(money(undefined)).toBe(0);
    expect(money(Number.NaN)).toBe(0);
    expect(money(Number.POSITIVE_INFINITY)).toBe(0);
    const gift = { ...myGroupGifts()[0], current_amount: 0.1 + 0.2, my_contribution: 0.7 + 0.1, target_amount: 599.999 };
    expect(groupGiftSummary(gift, SAM)).toMatchObject({ pledged: 0.3, myPledge: 0.8, targetAmount: 600 });
  });

  it("answers a gift with no pledge yet as 0, not paid, and one with no target as null", () => {
    const gift = { ...myGroupGifts()[0], current_amount: null, my_contribution: null, my_has_paid: null, target_amount: null };
    expect(groupGiftSummary(gift, SAM)).toMatchObject({ pledged: 0, myPledge: 0, myPaid: false, targetAmount: null });
  });

  it("names a member with no profile Someone", () => {
    const seen = seenWeekend();
    seen.group_gift_members[1] = { ...seen.group_gift_members[1], user_profiles: null };
    const page = groupGiftPage(seen, SAM);
    expect(page.members[1]).toEqual({
      person: { id: ALEX, name: "Someone", username: null, avatarUrl: null },
      pledge: 120, paid: true, isYou: false,
    });
    expect(page.memberCount).toBe(3);
  });

  it("counts the members the page lists, and reads the caller's pledge from their own row", () => {
    const seen = seenWeekend();
    seen.group_gift_members.pop();
    seen.my_membership = { ...seen.my_membership, contribution_amount: 75, has_paid: true };
    expect(groupGiftPage(seen, SAM)).toMatchObject({ memberCount: 2, myPledge: 75, myPaid: true });
  });

  it("lets only the maker add people and delete", () => {
    const asAlex = groupGiftPage({ ...seenWeekend(), my_membership: { ...seenWeekend().my_membership, user_id: ALEX } }, ALEX);
    expect([asAlex.isMaker, asAlex.canAddPeople, asAlex.canDelete]).toEqual([false, false, false]);
    expect(asAlex.members.map((m) => m.isYou)).toEqual([false, true, false]);
    const asSam = groupGiftPage(seenWeekend(), SAM);
    expect([asSam.isMaker, asSam.canAddPeople, asSam.canDelete]).toEqual([true, true, true]);
    expect(groupGiftSummary(myGroupGifts()[1], SAM).isMaker).toBe(false);
  });

  it("answers a gift with no chat as a count of 0 and no latest message", () => {
    const seen = { ...seenWeekend(), chat: { count: 0, latest: null } };
    expect(groupGiftPage(seen, SAM).chat).toEqual({ count: 0, latest: null });
  });

  it("orders the people to choose from by name", () => {
    const data = groupMateRows();
    expect(giftChoices({ groups: data.groups, people: [...data.people].reverse() })).toEqual(fixture("group-gift-choices"));
  });

  it("orders people of one name by id", () => {
    const twin = (id: string) => ({ id, username: "twin", display_name: "Twin", avatar_url: null, group_ids: [] });
    const answer = giftChoices({ groups: [], people: [twin("user_b"), twin("user_a")] });
    expect(answer.people.map((p) => p.person.id)).toEqual(["user_a", "user_b"]);
  });
});

describe("the request fixture", () => {
  it("reads the request fixture", () => {
    const parsed = parseNewGroupGiftBody(fixture("group-gift-request"));
    expect(parsed).toEqual({ ok: true, body: fixture("group-gift-request") });
  });

  it("tidies the name, trims the description and stores a blank one as none", () => {
    const base = fixture("group-gift-request");
    expect(parseNewGroupGiftBody({ ...base, name: "  Trip\n\tfor\u0007two ", description: "  line one\nline two\t " })).toEqual({
      ok: true,
      body: { ...base, name: "Trip for two", description: "line one\nline two" },
    });
    expect(parseNewGroupGiftBody({ ...base, description: " \n " })).toMatchObject({ ok: true, body: { description: null } });
    expect(parseNewGroupGiftBody({ ...base, description: null })).toMatchObject({ ok: true, body: { description: null } });
    const { description: _d, targetAmount: _t, ...bare } = base;
    void _d; void _t;
    expect(parseNewGroupGiftBody(bare)).toMatchObject({ ok: true, body: { description: null, targetAmount: null } });
  });

  it("takes a target of 0, null or the largest amount, and a repeated id once", () => {
    const base = fixture("group-gift-request");
    expect(parseNewGroupGiftBody({ ...base, targetAmount: 0 })).toMatchObject({ ok: true, body: { targetAmount: 0 } });
    expect(parseNewGroupGiftBody({ ...base, targetAmount: null })).toMatchObject({ ok: true, body: { targetAmount: null } });
    expect(parseNewGroupGiftBody({ ...base, targetAmount: 1000000 })).toMatchObject({ ok: true, body: { targetAmount: 1000000 } });
    expect(parseNewGroupGiftBody({ ...base, recipientIds: ["user_2dadABC", "user_2dadABC"] }))
      .toMatchObject({ ok: true, body: { recipientIds: ["user_2dadABC"] } });
  });

  it("takes someone not on Rybn, an empty list", () => {
    expect(parseNewGroupGiftBody({ ...fixture("group-gift-request"), recipientIds: [] }))
      .toMatchObject({ ok: true, body: { recipientIds: [] } });
  });

  it("takes twenty distinct people, and answers the group id in lower case", () => {
    const twenty = Array.from({ length: 20 }, (_, i) => `user_${i}`);
    const upper = fixture("group-gift-request").groupId.toUpperCase();
    const parsed = parseNewGroupGiftBody({ ...fixture("group-gift-request"), recipientIds: [...twenty, ...twenty], groupId: upper });
    expect(parsed).toMatchObject({ ok: true, body: { recipientIds: twenty, groupId: fixture("group-gift-request").groupId } });
  });

  it("reads only the fields it names", () => {
    const parsed = parseNewGroupGiftBody({ ...fixture("group-gift-request"), created_by: "user_x", isActive: false });
    expect(parsed).toEqual({ ok: true, body: fixture("group-gift-request") });
  });

  const base = fixture("group-gift-request");
  const without = (key: string) => Object.fromEntries(Object.entries(base).filter(([k]) => k !== key));
  it.each([
    ["recipientIds missing", without("recipientIds"), GIFT_SENTENCES.chooseWho],
    ["recipientIds not a list", { ...base, recipientIds: "user_2dadABC" }, GIFT_SENTENCES.chooseWho],
    ["recipientIds null", { ...base, recipientIds: null }, GIFT_SENTENCES.chooseWho],
    ["a recipient that is not a string", { ...base, recipientIds: [7] }, GIFT_SENTENCES.recipientNotAllowed],
    ["a recipient that is not an id", { ...base, recipientIds: ["not an id"] }, GIFT_SENTENCES.recipientNotAllowed],
    ["a recipient that is empty", { ...base, recipientIds: [""] }, GIFT_SENTENCES.recipientNotAllowed],
    ["twenty-one people", { ...base, recipientIds: Array.from({ length: 21 }, (_, i) => `user_${i}`) }, GIFT_SENTENCES.tooManyRecipients],
    ["a group id that is not a UUID", { ...base, groupId: "rivera" }, GIFT_SENTENCES.notInGroup],
    ["no group id", without("groupId"), GIFT_SENTENCES.notInGroup],
    ["a group id that is a number", { ...base, groupId: 4 }, GIFT_SENTENCES.notInGroup],
    ["no name", without("name"), GIFT_SENTENCES.nameMissing],
    ["a name of white space and control characters", { ...base, name: " \n\u0007\t " }, GIFT_SENTENCES.nameMissing],
    ["a name that is not text", { ...base, name: 5 }, GIFT_SENTENCES.nameMissing],
    ["a name of 201 characters", { ...base, name: "x".repeat(201) }, GIFT_SENTENCES.nameTooLong],
    ["a description of 1001 characters", { ...base, description: "x".repeat(1001) }, GIFT_SENTENCES.descriptionTooLong],
    ["a description with a control character", { ...base, description: "a\u0007b" }, GIFT_SENTENCES.characters],
    ["a target above the largest", { ...base, targetAmount: 1000000.01 }, GIFT_SENTENCES.amount],
    ["a negative target", { ...base, targetAmount: -1 }, GIFT_SENTENCES.amount],
    ["a target that is text", { ...base, targetAmount: "600" }, GIFT_SENTENCES.amount],
    ["a target that is not finite", { ...base, targetAmount: Number.POSITIVE_INFINITY }, GIFT_SENTENCES.amount],
    ["a description that is not text", { ...base, description: 5 }, RULES.request],
  ])("answers each sentence for its own fault: %s", (_what, body, message) => {
    expect(parseNewGroupGiftBody(body)).toEqual({ ok: false, message });
  });

  it("takes a name of 200 characters, and a description of 1000 with line breaks and tabs", () => {
    const description = `${"x".repeat(996)}\r\n\t`;
    expect(parseNewGroupGiftBody({ ...base, name: "x".repeat(200), description })).toMatchObject({ ok: true });
  });

  it("gives a name with a control character no sentence, as the action tidies it", () => {
    expect(parseNewGroupGiftBody({ ...base, name: "Trip\u0000for\u001Ftwo" }))
      .toMatchObject({ ok: true, body: { name: "Trip for two" } });
  });

  it("answers the first fault in the action's order", () => {
    // Who it is for, then the name, then the description, then the amount, then how many, then the group.
    const worst = { groupId: "x", recipientIds: Array.from({ length: 21 }, (_, i) => `user_${i}`), name: "", description: "x".repeat(2000), targetAmount: -1 };
    expect(parseNewGroupGiftBody(worst)).toEqual({ ok: false, message: GIFT_SENTENCES.nameMissing });
    expect(parseNewGroupGiftBody({ ...worst, name: "n" })).toEqual({ ok: false, message: GIFT_SENTENCES.descriptionTooLong });
    expect(parseNewGroupGiftBody({ ...worst, name: "n", description: "d" })).toEqual({ ok: false, message: GIFT_SENTENCES.amount });
    expect(parseNewGroupGiftBody({ ...worst, name: "n", description: "d", targetAmount: 1 }))
      .toEqual({ ok: false, message: GIFT_SENTENCES.tooManyRecipients });
    expect(parseNewGroupGiftBody({ ...worst, name: "n", description: "d", targetAmount: 1, recipientIds: ["bad id"] }))
      .toEqual({ ok: false, message: GIFT_SENTENCES.notInGroup });
  });

  it.each([[[]], ["x"], [null], [undefined], [4]])("answers %j with the plain sentence", (body) => {
    expect(parseNewGroupGiftBody(body)).toEqual({ ok: false, message: RULES.request });
  });
});

describe("GROUP_GIFT_ROUTE_ANSWERS", () => {
  it("answers 404 for a gift that is not there on every route but create, and for no other sentence", () => {
    const { create, ...rest } = GROUP_GIFT_ROUTE_ANSWERS;
    expect("notFound" in create).toBe(false);
    for (const answers of Object.values(rest)) expect(answers.notFound).toEqual([GIFT_SENTENCES.notThere]);
  });

  it("passes on each route's own refusals", () => {
    const refusals = (answers: ActionAnswers) => answers.refusals ?? [];
    const a = GROUP_GIFT_ROUTE_ANSWERS;
    expect(refusals(a.create)).toEqual([
      GIFT_SENTENCES.chooseWho, GIFT_SENTENCES.recipientNotAllowed, GIFT_SENTENCES.tooManyRecipients,
      GIFT_SENTENCES.notInGroup, GIFT_SENTENCES.nameMissing, GIFT_SENTENCES.nameTooLong,
      GIFT_SENTENCES.descriptionTooLong, GIFT_SENTENCES.amount, GIFT_SENTENCES.characters,
    ]);
    expect(refusals(a.one)).toEqual([]);
    expect(refusals(a.delete)).toEqual([GIFT_SENTENCES.onlyMakerDeletes]);
    expect(refusals(a.pledge)).toEqual([GIFT_SENTENCES.amount]);
    expect(refusals(a.people)).toEqual([GIFT_SENTENCES.onlyMakerAdds]);
    expect(refusals(a.add)).toEqual([GIFT_SENTENCES.onlyMakerAdds, GIFT_SENTENCES.cannotAdd]);
    expect(refusals(a.messages)).toEqual([]);
    expect(refusals(a.send)).toEqual([GIFT_SENTENCES.messageMissing, GIFT_SENTENCES.messageTooLong, GIFT_SENTENCES.characters]);
  });
});
