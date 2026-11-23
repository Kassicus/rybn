import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  createSupabaseMock,
  failed,
  ok,
  rowsIn,
  rowsWhere,
  type Answer,
  type Query,
} from "@/lib/gifts/test-supabase";

/**
 * A group gift's chat, with Supabase faked as lib/actions/gifts.test.ts fakes it. Both actions go through the one
 * check (seeGift) before anything of the chat is read or written. The chat opens on its newest messages and is read
 * a page at a time from a place in it: a message of this gift, by when it was sent and then by its id.
 *
 * The chat's reads are answered by rowsWhere from a table of messages that holds another gift's too (and, in two
 * tests, a message with no time), so a filter the code leaves out lets rows through that a test sees.
 *
 * The sentences, the columns and the filters are written out rather than imported: if they change, these
 * assertions fail -- which is the intent.
 */
const NOT_THERE = "Group gift not found";
const MESSAGE_MISSING = "Write a message first.";
const MESSAGE_TOO_LONG = "Keep the message to 5000 characters or fewer.";
const CHARACTERS = "That has characters Rybn can't save. Try typing it again.";

const GIFT_COLUMNS = "id, group_id, name, description, target_amount, current_amount, is_active, created_by, created_at";
const MEMBER_COLUMNS = "id, group_gift_id, user_id, contribution_amount, has_paid, joined_at";
const PERSON_COLUMNS = "id, username, display_name, avatar_url";
const MESSAGE_COLUMNS = "id, user_id, content, attachment_url, is_edited, created_at, updated_at";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const getUserId = vi.fn();

vi.mock("@/lib/auth/require-auth", () => ({
  getUserId: () => getUserId(),
}));

/** The fake Supabase client (lib/gifts/test-supabase.ts) this test is on now: each test makes its own. */
let supabase: ReturnType<typeof createSupabaseMock>;

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ from: (table: string) => supabase.from(table) }),
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({ from: (table: string) => supabase.adminFrom(table) }),
}));

/** Every query made, by table as the script names it, each as its chain of calls, in the order made. */
const asked = () => supabase.asked();

/** Every insert the service-role client made, as [table, payload], in the order made. */
const adminInserts = () => supabase.adminInserts();

const { getMessages, sendMessage } = await import("./messages");
const { revalidatePath } = await import("next/cache");

// The contract's test world: Sam is the caller.
const SAM = "user_2abcDEF";
const ALEX = "user_2alxABC";
const MOM = "user_2momABC";

const PEOPLE = {
  sam: { id: SAM, username: "sam", display_name: "Sam Rivera", avatar_url: "https://img.clerk.com/abc" },
  alex: { id: ALEX, username: "alex", display_name: "Alex Rivera", avatar_url: "https://img.clerk.com/alex" },
  mom: { id: MOM, username: "maria", display_name: "Mom", avatar_url: "https://img.clerk.com/mom" },
};
type Person = (typeof PEOPLE)[keyof typeof PEOPLE];

/** Every profile: rowsIn answers only those the code asks for. */
const EVERYONE = Object.values(PEOPLE);
const PERSON_BY_ID = new Map<string, Person>(EVERYONE.map((p) => [p.id, p]));

const RIVERA = "7d1e5b3c-9a2f-4c6d-8e0b-1f2a3b4c5d6e";
const WEEKEND = "5a1c9e2b-3d4f-4a6b-8c7d-9e0f1a2b3c4d";
/** Priya's gift, which Sam is not in: its messages share the table with the weekend away's. */
const TEACHER = "6b2d0f3c-4e5a-4b7c-9d8e-0f1a2b3c4d5e";

const WEEKEND_ROW = {
  id: WEEKEND,
  group_id: RIVERA,
  name: "Anniversary weekend away",
  description: "Two nights at the coast.",
  target_amount: 600,
  current_amount: 340,
  is_active: true,
  created_by: SAM,
  created_at: "2026-11-16T18:00:00+00:00",
};

const SAM_IN_WEEKEND = {
  id: "a0000000-0000-4000-8000-000000000001",
  group_gift_id: WEEKEND,
  user_id: SAM,
  contribution_amount: 120,
  has_paid: false,
  joined_at: "2026-11-16T18:30:00+00:00",
};

/** The answers to the check's three reads: the gift, the caller's member row in it, and whether it names the caller. */
function seenScript(gift: unknown, membership: unknown, named: unknown): Record<string, Answer[]> {
  return {
    "admin:group_gifts": [ok(gift)],
    "admin:group_gift_members": [ok(membership)],
    "admin:group_gift_recipients": [ok(named)],
  };
}

/** The check's three reads, for Sam and this gift, and nothing else: what asked() holds when an action stops there. */
const checked = (id: string) => ({
  "admin:group_gifts": [[["select", GIFT_COLUMNS], ["eq", "id", id], ["maybeSingle"]]],
  "admin:group_gift_members": [
    [["select", MEMBER_COLUMNS], ["eq", "group_gift_id", id], ["eq", "user_id", SAM], ["maybeSingle"]],
  ],
  "admin:group_gift_recipients": [
    [["select", "user_id"], ["eq", "group_gift_id", id], ["eq", "user_id", SAM], ["maybeSingle"]],
  ],
});

/** A message's id, numbered, in the contract's form. */
const messageId = (n: number) => `a1000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

/** A time as the database writes one: `seconds` after 10:00 UTC on 16 November 2026. */
const at = (seconds: number) =>
  new Date(Date.UTC(2026, 10, 16, 10, 0, seconds)).toISOString().replace("Z", "000+00:00");

/** Three of the weekend away's messages were sent in this one instant. */
const SAME_INSTANT = "2026-11-16T18:02:11.000000+00:00";

/** Message n of a gift, as its row: Alex wrote the odd ones and Sam the even. */
const message = (n: number, sentAt: string, gift = WEEKEND) => ({
  id: messageId(n),
  group_gift_id: gift,
  user_id: n % 2 === 1 ? ALEX : SAM,
  content: `Message ${n}`,
  attachment_url: null,
  is_edited: false,
  created_at: sentAt,
  updated_at: sentAt,
});
type MessageRow = ReturnType<typeof message>;

/** The weekend away's chat of `count` messages, numbered from 1, one a second, oldest first. */
const chat = (count: number) => Array.from({ length: count }, (_, i) => message(i + 1, at(i)));

/** Priya's gift's two messages: one sent before every message of the weekend away, one after them all. */
const TEACHER_CHAT = [
  message(901, "2026-11-01T08:00:00.000000+00:00", TEACHER),
  message(902, "2026-11-30T08:00:00.000000+00:00", TEACHER),
];

/** The check passes for Sam in the weekend away, and the chat's reads are answered from `rows` as the database would. */
const chatScript = (rows: Record<string, unknown>[]): Record<string, Answer[]> => ({
  ...seenScript(WEEKEND_ROW, SAM_IN_WEEKEND, null),
  "admin:messages": [rowsWhere(rows), rowsWhere(rows)],
  "admin:user_profiles": [rowsIn("id", EVERYONE)],
});

/** A message as the chat answers it: its seven named columns, and its sender's profile. */
const answered = (row: MessageRow, sender: Person | null = PERSON_BY_ID.get(row.user_id) ?? null) => ({
  id: row.id,
  user_id: row.user_id,
  content: row.content,
  attachment_url: row.attachment_url,
  is_edited: row.is_edited,
  created_at: row.created_at,
  updated_at: row.updated_at,
  user_profiles: sender,
});

const idsOf = (result: Awaited<ReturnType<typeof getMessages>>) => result.data?.map((m) => m.id);

const NEWEST_FIRST = [
  ["order", "created_at", { ascending: false }],
  ["order", "id", { ascending: false }],
];
const OLDEST_FIRST = [
  ["order", "created_at", { ascending: true }],
  ["order", "id", { ascending: true }],
];

/** Every read of the chat leaves out a message with no time. */
const HAS_A_TIME = ["not", "created_at", "is", null];

/** The read for a chat opened without a place: this gift's newest messages, one more than a page. */
const NEWEST_READ = [
  ["select", MESSAGE_COLUMNS],
  ["eq", "group_gift_id", WEEKEND],
  HAS_A_TIME,
  ...NEWEST_FIRST,
  ["limit", 51],
];

/** Looking a place up: that message, in this gift, if it has a time. */
const placeRead = (id: string) => [
  ["select", "id, created_at"],
  ["eq", "id", id],
  ["eq", "group_gift_id", WEEKEND],
  HAS_A_TIME,
  ["maybeSingle"],
];

const profilesRead = (ids: string[]) => [["select", PERSON_COLUMNS], ["in", "id", ids]];

beforeEach(() => {
  vi.clearAllMocks();
  getUserId.mockResolvedValue(SAM);
  supabase = createSupabaseMock({});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("getMessages", () => {
  it("answers the newest fifty, oldest first, and says there are earlier ones", async () => {
    const rows = chat(51);
    // Scripted newest first, Priya's gift's among them.
    supabase = createSupabaseMock(chatScript([...TEACHER_CHAT, ...rows.slice().reverse()]));

    const result = await getMessages(WEEKEND);

    expect(result).toStrictEqual({ data: rows.slice(1).map((row) => answered(row)), hasEarlier: true });
    expect(result.data?.[0].id).toBe(messageId(2)); // the 50th newest
    expect(result.data?.[49].id).toBe(messageId(51)); // the newest
    // After the check: 51 of this gift's messages, by time then id, newest first; then their senders, once each.
    expect(asked()).toEqual({
      ...checked(WEEKEND),
      "admin:messages": [NEWEST_READ],
      "admin:user_profiles": [profilesRead([SAM, ALEX])],
    });
  });

  it("says there are no earlier ones for a short chat", async () => {
    const rows = chat(3);
    supabase = createSupabaseMock(chatScript([...rows, ...TEACHER_CHAT]));
    expect(await getMessages(WEEKEND)).toStrictEqual({ data: rows.map((row) => answered(row)), hasEarlier: false });

    // Exactly a page is no more than a page.
    const fifty = chat(50);
    supabase = createSupabaseMock(chatScript([...fifty, ...TEACHER_CHAT]));
    const page = await getMessages(WEEKEND);
    expect(idsOf(page)).toEqual(fifty.map((row) => row.id));
    expect(page.hasEarlier).toBe(false);

    // An empty chat asks for no profiles.
    supabase = createSupabaseMock(chatScript(TEACHER_CHAT));
    expect(await getMessages(WEEKEND)).toStrictEqual({ data: [], hasEarlier: false });
    expect(asked()).toEqual({ ...checked(WEEKEND), "admin:messages": [NEWEST_READ] });
  });

  it("pages back from a message without skipping or repeating one sent in the same instant", async () => {
    const rows = [1, 2, 3].map((n) => message(n, SAME_INSTANT));
    supabase = createSupabaseMock(chatScript([...rows, ...TEACHER_CHAT]));

    const result = await getMessages(WEEKEND, { before: messageId(2) });

    expect(result).toStrictEqual({ data: [answered(rows[0])], hasEarlier: false });
    // The place is looked up in this gift. The page is this gift's messages strictly before it: sent earlier, or in
    // the same instant with a smaller id. The time is in double quotes, as PostgREST needs for a value holding ":".
    expect(asked()).toEqual({
      ...checked(WEEKEND),
      "admin:messages": [
        placeRead(messageId(2)),
        [
          ["select", MESSAGE_COLUMNS],
          ["eq", "group_gift_id", WEEKEND],
          HAS_A_TIME,
          [
            "or",
            'created_at.lt."2026-11-16T18:02:11.000000+00:00",and(created_at.eq."2026-11-16T18:02:11.000000+00:00",id.lt.a1000000-0000-4000-8000-000000000002)',
          ],
          ...NEWEST_FIRST,
          ["limit", 51],
        ],
      ],
      "admin:user_profiles": [profilesRead([ALEX])],
    });

    // From the third, the first two; from the first, none.
    for (const [from, expected] of [
      [3, [1, 2]],
      [1, []],
    ] as const) {
      supabase = createSupabaseMock(chatScript([...rows, ...TEACHER_CHAT]));
      const page = await getMessages(WEEKEND, { before: messageId(from) });
      expect(idsOf(page), String(from)).toEqual(expected.map(messageId));
      expect(page.hasEarlier, String(from)).toBe(false);
    }
  });

  it("pages back fifty at a time, and says when the first message is reached", async () => {
    const rows = chat(101);

    supabase = createSupabaseMock(chatScript([...rows, ...TEACHER_CHAT]));
    const back = await getMessages(WEEKEND, { before: messageId(52) });
    expect(idsOf(back)).toEqual(rows.slice(1, 51).map((row) => row.id));
    expect(back.hasEarlier).toBe(true);

    // Exactly fifty before it: the first is among them, and there is nothing earlier.
    supabase = createSupabaseMock(chatScript([...rows, ...TEACHER_CHAT]));
    const first = await getMessages(WEEKEND, { before: messageId(51) });
    expect(idsOf(first)).toEqual(rows.slice(0, 50).map((row) => row.id));
    expect(first.hasEarlier).toBe(false);
  });

  it("compares when a message was sent first and its id second", async () => {
    // Message 9 was sent a minute before message 2.
    const rows = [message(9, at(60)), message(2, at(120))];

    supabase = createSupabaseMock(chatScript([...rows, ...TEACHER_CHAT]));
    expect(idsOf(await getMessages(WEEKEND, { before: messageId(2) }))).toEqual([messageId(9)]);

    supabase = createSupabaseMock(chatScript([...rows, ...TEACHER_CHAT]));
    expect(idsOf(await getMessages(WEEKEND, { after: messageId(9) }))).toEqual([messageId(2)]);
  });

  it("answers everything after a message, up to two hundred", async () => {
    const rows = [1, 2, 3].map((n) => message(n, SAME_INSTANT));
    supabase = createSupabaseMock(chatScript([...rows, ...TEACHER_CHAT]));

    const result = await getMessages(WEEKEND, { after: messageId(1) });

    expect(result).toStrictEqual({ data: [answered(rows[1]), answered(rows[2])], hasEarlier: false });
    // This gift's messages strictly after the place, oldest first, at most 200.
    expect(asked()).toEqual({
      ...checked(WEEKEND),
      "admin:messages": [
        placeRead(messageId(1)),
        [
          ["select", MESSAGE_COLUMNS],
          ["eq", "group_gift_id", WEEKEND],
          HAS_A_TIME,
          [
            "or",
            'created_at.gt."2026-11-16T18:02:11.000000+00:00",and(created_at.eq."2026-11-16T18:02:11.000000+00:00",id.gt.a1000000-0000-4000-8000-000000000001)',
          ],
          ...OLDEST_FIRST,
          ["limit", 200],
        ],
      ],
      "admin:user_profiles": [profilesRead([SAM, ALEX])],
    });

    // Two hundred and fifty after the place: the two hundred just after it, and still no word of earlier ones.
    const long = chat(260);
    supabase = createSupabaseMock(chatScript([...long, ...TEACHER_CHAT]));
    const newer = await getMessages(WEEKEND, { after: messageId(10) });
    expect(idsOf(newer)).toEqual(long.slice(10, 210).map((row) => row.id));
    expect(newer.hasEarlier).toBe(false);
  });

  it("answers the newest fifty when the place it was given is gone", async () => {
    const rows = chat(51);
    const gone = messageId(999);

    for (const page of [{ before: gone }, { after: gone }]) {
      supabase = createSupabaseMock(chatScript([...rows, ...TEACHER_CHAT]));
      const result = await getMessages(WEEKEND, page);
      expect(result, JSON.stringify(page)).toStrictEqual({
        data: rows.slice(1).map((row) => answered(row)),
        hasEarlier: true,
      });
      expect(asked()["admin:messages"], JSON.stringify(page)).toEqual([placeRead(gone), NEWEST_READ]);
    }
  });

  it("looks a place up in this gift only", async () => {
    const rows = chat(51);

    // Priya's gift's messages are real, and no place in the weekend away's chat.
    for (const page of [{ before: messageId(901) }, { after: messageId(902) }]) {
      supabase = createSupabaseMock(chatScript([...rows, ...TEACHER_CHAT]));
      const result = await getMessages(WEEKEND, page);
      expect(idsOf(result), JSON.stringify(page)).toEqual(rows.slice(1).map((row) => row.id));
      expect(result.hasEarlier, JSON.stringify(page)).toBe(true);
      expect(asked()["admin:messages"], JSON.stringify(page)).toEqual([
        placeRead(page.before ?? page.after ?? ""),
        NEWEST_READ,
      ]);
    }
  });

  it("leaves out a message with no time", async () => {
    const rows = chat(3);
    // A message of this gift with no time, which the newest-first order would put first.
    const undated = { ...message(4, at(3)), created_at: null };

    supabase = createSupabaseMock(chatScript([...rows, undated, ...TEACHER_CHAT]));
    expect(await getMessages(WEEKEND)).toStrictEqual({ data: rows.map((row) => answered(row)), hasEarlier: false });
    expect(asked()["admin:messages"]).toEqual([NEWEST_READ]);

    // Paging back from the newest, or on from the first, leaves it out too.
    supabase = createSupabaseMock(chatScript([...rows, undated, ...TEACHER_CHAT]));
    expect(idsOf(await getMessages(WEEKEND, { before: messageId(3) }))).toEqual([messageId(1), messageId(2)]);
    supabase = createSupabaseMock(chatScript([...rows, undated, ...TEACHER_CHAT]));
    expect(idsOf(await getMessages(WEEKEND, { after: messageId(1) }))).toEqual([messageId(2), messageId(3)]);
  });

  it("answers the newest fifty when the place it was given has no time", async () => {
    const rows = chat(51);
    const undated = { ...message(52, at(51)), created_at: null };

    for (const page of [{ before: messageId(52) }, { after: messageId(52) }]) {
      supabase = createSupabaseMock(chatScript([...rows, undated, ...TEACHER_CHAT]));
      const result = await getMessages(WEEKEND, page);
      expect(result, JSON.stringify(page)).toStrictEqual({
        data: rows.slice(1).map((row) => answered(row)),
        hasEarlier: true,
      });
      // The place is looked up among messages with a time, so it is not found, and no page is read from it.
      expect(asked()["admin:messages"], JSON.stringify(page)).toEqual([placeRead(messageId(52)), NEWEST_READ]);
    }
  });

  it("answers the newest fifty when given both places, or a place that is not text, looking neither up", async () => {
    const rows = chat(51);

    for (const page of [{ before: messageId(10), after: messageId(20) }, { before: 7 }, { after: null }, null]) {
      supabase = createSupabaseMock(chatScript([...rows, ...TEACHER_CHAT]));
      const result = await getMessages(WEEKEND, page as unknown as { before?: string; after?: string });
      expect(idsOf(result), JSON.stringify(page)).toEqual(rows.slice(1).map((row) => row.id));
      expect(asked()["admin:messages"], JSON.stringify(page)).toEqual([NEWEST_READ]);
    }
  });

  it("answers Group gift not found to someone it is for, reading no message", async () => {
    const gone = "9f9f9f9f-0000-4000-8000-000000000000";
    const answers = [];

    for (const [label, id, script] of [
      // The database never lets a person a gift names hold a member row in it; the check refuses them even so.
      ["named on it", WEEKEND, seenScript(WEEKEND_ROW, { ...SAM_IN_WEEKEND }, { user_id: SAM })],
      ["not in it", WEEKEND, seenScript(WEEKEND_ROW, null, null)],
      ["no such gift", gone, seenScript(null, null, null)],
    ] as const) {
      // The chat is there to be read: only the check keeps it unread.
      supabase = createSupabaseMock({ ...chatScript(chat(3)), ...script });
      answers.push(await getMessages(id, { before: messageId(2) }));
      // Neither the place nor a page is read.
      expect(asked(), label).toEqual(checked(id));
    }

    expect(answers[0]).toStrictEqual({ error: NOT_THERE });
    expect(answers[1]).toStrictEqual(answers[0]);
    expect(answers[2]).toStrictEqual(answers[0]);
  });

  it("gives each message its sender's profile, by named columns", async () => {
    const rows = [message(1, at(0)), message(2, at(1)), { ...message(3, at(2)), user_id: MOM }];
    supabase = createSupabaseMock({
      ...chatScript(rows),
      // A profile row holding more than a person's four columns.
      "admin:user_profiles": [rowsIn("id", [{ ...PEOPLE.alex, email: "alex@example.com" }, PEOPLE.sam, PEOPLE.mom])],
    });

    const result = await getMessages(WEEKEND);

    // Each message is its seven columns and its sender's four, and nothing more: not the gift's id its row holds,
    // not the email its sender's row holds.
    expect(result).toStrictEqual({
      data: [answered(rows[0], PEOPLE.alex), answered(rows[1], PEOPLE.sam), answered(rows[2], PEOPLE.mom)],
      hasEarlier: false,
    });
    expect(asked()["admin:user_profiles"]).toEqual([profilesRead([ALEX, SAM, MOM])]);

    // A sender with no profile row is answered as none.
    supabase = createSupabaseMock({ ...chatScript(rows), "admin:user_profiles": [rowsIn("id", [PEOPLE.sam])] });
    const missing = await getMessages(WEEKEND);
    expect(missing.data?.map((m) => m.user_profiles)).toStrictEqual([null, PEOPLE.sam, null]);
  });

  it("answers the database's words when a read fails", async () => {
    const rows = chat(3);

    for (const [label, answers] of [
      ["the place", { "admin:messages": [failed("connection reset")] }],
      ["the page", { "admin:messages": [rowsWhere(rows), failed("connection reset")] }],
      ["the senders", { "admin:user_profiles": [failed("connection reset")] }],
    ] as [string, Record<string, Answer[]>][]) {
      supabase = createSupabaseMock({ ...chatScript(rows), ...answers });
      expect(await getMessages(WEEKEND, { before: messageId(3) }), label).toStrictEqual({ error: "connection reset" });
    }
  });
});

const SENT_AT = "2026-11-18T09:20:03.000000+00:00";

/** The insert's answer: the row it wrote as the database saves it, with an id and its times. */
const savedRow = (query: Query) => {
  const row = query.calls.find(([method]) => method === "insert")?.[1] as Record<string, unknown>;
  return ok({ id: messageId(4), ...row, created_at: SENT_AT, updated_at: SENT_AT });
};

/** The check passes for Sam in the weekend away, the message is saved, and Sam's profile is there to read. */
const sendScript = (): Record<string, Answer[]> => ({
  ...seenScript(WEEKEND_ROW, SAM_IN_WEEKEND, null),
  "admin:messages": [savedRow],
  "admin:user_profiles": [rowsIn("id", EVERYONE)],
});

/** The row a message from Sam to the weekend away is saved as: its words and nothing else. */
const savedAs = (content: string) => ({
  group_gift_id: WEEKEND,
  user_id: SAM,
  content,
  attachment_url: null,
  is_edited: false,
});

type Send = Parameters<typeof sendMessage>[0];

describe("sendMessage", () => {
  it("saves the trimmed words and answers the message with its sender", async () => {
    supabase = createSupabaseMock(sendScript());

    const result = await sendMessage({ group_gift_id: WEEKEND, content: "  Book it.\n" });

    expect(result).toStrictEqual({
      data: {
        id: messageId(4),
        user_id: SAM,
        content: "Book it.",
        attachment_url: null,
        is_edited: false,
        created_at: SENT_AT,
        updated_at: SENT_AT,
        user_profiles: PEOPLE.sam,
      },
    });
    // After the check: the message, saved to this gift as the caller, then the caller's profile.
    expect(asked()).toEqual({
      ...checked(WEEKEND),
      "admin:messages": [[["insert", savedAs("Book it.")], ["select", MESSAGE_COLUMNS], ["single"]]],
      "admin:user_profiles": [profilesRead([SAM])],
    });
    expect(revalidatePath).toHaveBeenCalledWith(`/gifts/${WEEKEND}`);

    // An attachment sent with it is not saved: a message is its words.
    supabase = createSupabaseMock(sendScript());
    await sendMessage({ group_gift_id: WEEKEND, content: "Book it.", attachment_url: "https://example.com/a.png" } as Send);
    expect(adminInserts()).toEqual([["messages", savedAs("Book it.")]]);
  });

  it("keeps line breaks inside a message", async () => {
    for (const content of ["a\nb", "Line one\r\n\tLine two"]) {
      supabase = createSupabaseMock(sendScript());
      const result = await sendMessage({ group_gift_id: WEEKEND, content });
      expect(result.data?.content, JSON.stringify(content)).toBe(content);
      expect(adminInserts(), JSON.stringify(content)).toEqual([["messages", savedAs(content)]]);
    }
  });

  it("refuses nothing but white space, more than 5000 characters, and a control character", async () => {
    for (const [content, sentence] of [
      ["", MESSAGE_MISSING],
      ["   ", MESSAGE_MISSING],
      ["\n\t\r\n ", MESSAGE_MISSING],
      [undefined, MESSAGE_MISSING],
      [5, MESSAGE_MISSING],
      ["x".repeat(5001), MESSAGE_TOO_LONG],
      // Counted in UTF-16 units: 2501 faces are 5002.
      ["\u{1F600}".repeat(2501), MESSAGE_TOO_LONG],
      ["Book it\u0007", CHARACTERS],
      ["Book\u0000it", CHARACTERS],
      ["Book\u001Bit", CHARACTERS],
      ["Book it\u007F", CHARACTERS],
    ] as const) {
      supabase = createSupabaseMock(sendScript());
      const result = await sendMessage({ group_gift_id: WEEKEND, content } as unknown as Send);
      expect(result, JSON.stringify(content)).toStrictEqual({ error: sentence });
      // The check is read, and nothing is written.
      expect(asked(), JSON.stringify(content)).toEqual(checked(WEEKEND));
    }

    // Five thousand, once trimmed, is saved.
    supabase = createSupabaseMock(sendScript());
    await sendMessage({ group_gift_id: WEEKEND, content: ` ${"x".repeat(5000)}\n` });
    expect(adminInserts()).toEqual([["messages", savedAs("x".repeat(5000))]]);
  });

  it("answers Group gift not found to someone it is for, saving nothing", async () => {
    for (const [label, membership, named] of [
      // The database never lets a person a gift names hold a member row in it; the check refuses them even so.
      ["named on it", { ...SAM_IN_WEEKEND }, { user_id: SAM }],
      ["not in it", null, null],
    ] as const) {
      supabase = createSupabaseMock({ ...sendScript(), ...seenScript(WEEKEND_ROW, membership, named) });
      const result = await sendMessage({ group_gift_id: WEEKEND, content: "Book it." });
      expect(result, label).toStrictEqual({ error: NOT_THERE });
      expect(asked(), label).toEqual(checked(WEEKEND));
    }
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("answers the database's words when the message cannot be saved", async () => {
    supabase = createSupabaseMock({ ...sendScript(), "admin:messages": [failed("connection reset")] });

    expect(await sendMessage({ group_gift_id: WEEKEND, content: "Book it." })).toStrictEqual({
      error: "connection reset",
    });
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("answers the saved message without its sender when their profile cannot be read", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    supabase = createSupabaseMock({ ...sendScript(), "admin:user_profiles": [failed("connection reset")] });

    const result = await sendMessage({ group_gift_id: WEEKEND, content: "Book it." });

    // The message is saved by then: answering a failure would have it sent again.
    expect(result.data?.content).toBe("Book it.");
    expect(result.data?.user_profiles).toBeNull();
    expect(consoleError).toHaveBeenCalledWith(expect.any(String), "connection reset");
  });
});

describe("the chat", () => {
  it("answers Not authenticated to nobody signed in, reading nothing", async () => {
    getUserId.mockResolvedValue(null);

    expect(await getMessages(WEEKEND)).toStrictEqual({ error: "Not authenticated" });
    expect(await sendMessage({ group_gift_id: WEEKEND, content: "Book it." })).toStrictEqual({
      error: "Not authenticated",
    });
    expect(supabase.queries).toEqual([]);
  });
});
