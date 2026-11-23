import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/**
 * The group gift actions, with Supabase faked. A group gift's rows are read and written with the service-role
 * client; who is in which group is read with the caller's own client. Every test here is about one rule: a gift
 * says who it is for, those people are never told of it, and every read of a gift goes through one check.
 *
 * The sentences are written out rather than imported from lib/gifts/sentences.ts: if the wording there changes,
 * these assertions fail -- which is the intent.
 */
const NOT_THERE = "Group gift not found";
const CHOOSE_WHO = "Choose who this gift is for.";
const NOT_ALLOWED = "Choose people you share a group with.";
const TOO_MANY = "A gift can be for up to 20 people.";
const NOT_IN_GROUP = "You must be a member of this group to create a group gift";
const NAME_MISSING = "Give the gift a name.";
const NAME_TOO_LONG = "Keep the name to 200 characters or fewer.";
const DESCRIPTION_TOO_LONG = "Keep the description to 1000 characters or fewer.";
const AMOUNT = "Enter an amount from 0 to 1,000,000.";
const CHARACTERS = "That has characters Rybn can't save. Try typing it again.";
const CREATE_FAILED = "Failed to create group gift. Please try again.";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const getUserId = vi.fn();

vi.mock("@/lib/auth/require-auth", () => ({
  getUserId: () => getUserId(),
}));

/**
 * Every query, as `(table, "from")` and then `(table, method, ...args)` for each chain call: `query` for the
 * caller's own client, `adminQuery` for the service-role client.
 */
const query = vi.fn();
const adminQuery = vi.fn();

/**
 * Supabase's query builder is thenable, so `await from().select().eq()` resolves without a terminal call while
 * `.maybeSingle()` and `.single()` are their own promises. Every chain method returns the chain, and the chain
 * resolves the next scripted answer for its table.
 *
 * Answers are queued PER TABLE and taken in the order the queries are made; the service-role client's under
 * "admin:<table>". `order` holds every table asked, in the order asked.
 */
function createSupabaseMock(script: Record<string, unknown[]>) {
  const queues: Record<string, unknown[]> = {};
  for (const [table, answers] of Object.entries(script)) queues[table] = [...answers];
  const order: string[] = [];

  const client = (prefix: string, record: typeof query) => (table: string) => {
    const queued = `${prefix}${table}`;
    order.push(queued);
    record(table, "from");
    const next = () => {
      const queue = queues[queued];
      if (!queue || queue.length === 0) throw new Error(`No scripted Supabase answer left for "${queued}"`);
      return queue.shift();
    };

    const chain: Record<string, unknown> = {};
    for (const method of ["select", "insert", "update", "delete", "eq", "in", "order", "limit"]) {
      chain[method] = (...args: unknown[]) => {
        record(table, method, ...args);
        return chain;
      };
    }
    chain.maybeSingle = async () => next();
    chain.single = async () => next();
    chain.then = (resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) =>
      Promise.resolve()
        .then(next)
        .then(resolve, reject);
    return chain;
  };

  return { order, from: client("", query), adminFrom: client("admin:", adminQuery) };
}

let supabase: ReturnType<typeof createSupabaseMock>;

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ from: (table: string) => supabase.from(table) }),
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({ from: (table: string) => supabase.adminFrom(table) }),
}));

const { createGroupGift, getMyGroupGifts, getGroupGiftById, getGroupGiftChoices } = await import("./gifts");

// The contract's test world: Sam is the caller.
const SAM = "user_2abcDEF";
const MOM = "user_2momABC";
const DAD = "user_2dadABC";
const ALEX = "user_2alxABC";
const JORDAN = "user_2jrdABC";
const GRAN = "user_2grnABC";
const PRIYA = "user_2prySHA";

const PEOPLE = {
  sam: { id: SAM, username: "sam", display_name: "Sam Rivera", avatar_url: "https://img.clerk.com/abc" },
  mom: { id: MOM, username: "maria", display_name: "Mom", avatar_url: "https://img.clerk.com/mom" },
  dad: { id: DAD, username: "luis", display_name: "Dad", avatar_url: null },
  alex: { id: ALEX, username: "alex", display_name: "Alex Rivera", avatar_url: "https://img.clerk.com/alex" },
  jordan: { id: JORDAN, username: "jordan", display_name: null, avatar_url: null },
  gran: { id: GRAN, username: "gran", display_name: "Gran", avatar_url: null },
  priya: { id: PRIYA, username: "priya", display_name: "Priya Shah", avatar_url: null },
};

const RIVERA = "7d1e5b3c-9a2f-4c6d-8e0b-1f2a3b4c5d6e";
const BOOK_CLUB = "2b8f6c4a-1e3d-4f5a-9b7c-0d1e2f3a4b5c";
/** A group Sam is not in: someone added him to a gift of it from another group. */
const COACHES = "3c9a7d5b-2f4e-4a6b-8c0d-1e2f3a4b5c6d";

const WEEKEND = "5a1c9e2b-3d4f-4a6b-8c7d-9e0f1a2b3c4d";
const TEACHER = "6b2d0f3c-4e5a-4b7c-9d8e-0f1a2b3c4d5e";
const COACH = "7c3e1a4d-5f6b-4c8d-8e9f-1a2b3c4d5e6f";

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

const TEACHER_ROW = {
  id: TEACHER,
  group_id: BOOK_CLUB,
  name: "Teacher thank-you",
  description: null,
  target_amount: null,
  current_amount: 45,
  is_active: true,
  created_by: PRIYA,
  created_at: "2026-11-10T09:00:00+00:00",
};

const COACH_ROW = {
  id: COACH,
  group_id: COACHES,
  name: "Coach's send-off",
  description: "A card and a voucher.",
  target_amount: 200,
  current_amount: 60,
  is_active: false,
  created_by: ALEX,
  created_at: "2026-11-01T12:00:00+00:00",
};

const SAM_IN_WEEKEND = {
  id: "a0000000-0000-4000-8000-000000000001",
  group_gift_id: WEEKEND,
  user_id: SAM,
  contribution_amount: 120,
  has_paid: false,
  joined_at: "2026-11-16T18:30:00+00:00",
};
const ALEX_IN_WEEKEND = {
  id: "a0000000-0000-4000-8000-000000000003",
  group_gift_id: WEEKEND,
  user_id: ALEX,
  contribution_amount: 120,
  has_paid: true,
  joined_at: "2026-11-16T18:10:00+00:00",
};
const JORDAN_IN_WEEKEND = {
  id: "a0000000-0000-4000-8000-000000000002",
  group_gift_id: WEEKEND,
  user_id: JORDAN,
  contribution_amount: 100,
  has_paid: true,
  joined_at: "2026-11-16T18:20:00+00:00",
};

const ok = (data: unknown) => ({ data, error: null });
const failed = (message: string, code = "XX000") => ({ data: null, error: { message, code } });

/** The caller's groups as groupMates reads them: Rivera and the Book Club. */
const MY_GROUPS = ok([
  { group_id: RIVERA, groups: { id: RIVERA, name: "Rivera Family" } },
  { group_id: BOOK_CLUB, groups: { id: BOOK_CLUB, name: "Book Club" } },
]);

/** Everyone in those two groups, Sam too. */
const THEIR_MEMBERS = ok([
  ...[SAM, MOM, DAD, ALEX, JORDAN, GRAN].map((user_id) => ({ group_id: RIVERA, user_id })),
  ...[SAM, PRIYA, ALEX].map((user_id) => ({ group_id: BOOK_CLUB, user_id })),
]);

const MATES_PROFILES = ok([PEOPLE.mom, PEOPLE.dad, PEOPLE.alex, PEOPLE.jordan, PEOPLE.gran, PEOPLE.priya]);

/**
 * createGroupGift's reads and writes when everything goes: the caller's own membership of the group, then
 * groupMates (their groups, those groups' members, the members' profiles), then the gift, its names and its
 * maker's member row.
 */
function createScript(): Record<string, unknown[]> {
  return {
    group_members: [ok({ id: "b0000000-0000-4000-8000-000000000001" }), MY_GROUPS, THEIR_MEMBERS],
    user_profiles: [MATES_PROFILES],
    "admin:group_gifts": [ok(WEEKEND_ROW), ok(null)],
    "admin:group_gift_recipients": [ok(null)],
    "admin:group_gift_members": [ok(null)],
  };
}

const NEW_WEEKEND = {
  name: "Anniversary weekend away",
  description: "Two nights at the coast.",
  group_id: RIVERA,
  recipient_ids: [DAD, MOM],
  target_amount: 600,
  is_active: true,
};

type NewGift = Parameters<typeof createGroupGift>[0];

/** Every insert the service-role client made, as [table, payload], in the order made. */
const adminInserts = () =>
  adminQuery.mock.calls.filter((call) => call[1] === "insert").map((call) => [call[0], call[2]]);

/** The row the latest gift insert wrote. */
const storedGift = () => {
  const gifts = adminInserts().filter(([table]) => table === "group_gifts");
  return gifts[gifts.length - 1]?.[1] as Record<string, unknown>;
};

beforeEach(() => {
  vi.clearAllMocks();
  getUserId.mockResolvedValue(SAM);
  supabase = createSupabaseMock({});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("createGroupGift", () => {
  it("makes the gift, names who it is for, and puts its maker in it", async () => {
    supabase = createSupabaseMock(createScript());

    const result = await createGroupGift(NEW_WEEKEND);

    expect(result).toEqual({ data: WEEKEND_ROW });
    expect(adminInserts()).toEqual([
      [
        "group_gifts",
        {
          name: "Anniversary weekend away",
          description: "Two nights at the coast.",
          group_id: RIVERA,
          target_amount: 600,
          is_active: true,
          created_by: SAM,
        },
      ],
      [
        "group_gift_recipients",
        [
          { group_gift_id: WEEKEND, user_id: DAD },
          { group_gift_id: WEEKEND, user_id: MOM },
        ],
      ],
      ["group_gift_members", { group_gift_id: WEEKEND, user_id: SAM, contribution_amount: 0, has_paid: false }],
    ]);
    expect(storedGift()).not.toHaveProperty("target_user_id");
    // Who is in which group is read as the caller, never with the service-role client.
    expect(adminQuery).not.toHaveBeenCalledWith("group_members", "from");
    expect(adminQuery).not.toHaveBeenCalledWith("user_profiles", "from");
  });

  it("writes no names for someone not on Rybn", async () => {
    supabase = createSupabaseMock(createScript());

    const result = await createGroupGift({ ...NEW_WEEKEND, recipient_ids: [] });

    expect(result).toEqual({ data: WEEKEND_ROW });
    expect(adminInserts().map(([table]) => table)).toEqual(["group_gifts", "group_gift_members"]);
    expect(supabase.order).not.toContain("admin:group_gift_recipients");
  });

  it("answers Choose who this gift is for. when the list is missing", async () => {
    for (const recipient_ids of [undefined, "x", null, { 0: DAD }]) {
      supabase = createSupabaseMock(createScript());
      const result = await createGroupGift({ ...NEW_WEEKEND, recipient_ids } as unknown as NewGift);
      expect(result).toEqual({ error: CHOOSE_WHO });
      expect(supabase.order).toEqual([]);
    }
  });

  it("answers Not authenticated to nobody signed in, reading nothing", async () => {
    getUserId.mockResolvedValue(null);
    supabase = createSupabaseMock(createScript());

    expect(await createGroupGift(NEW_WEEKEND)).toEqual({ error: "Not authenticated" });
    expect(supabase.order).toEqual([]);
  });

  it("refuses someone the caller shares no group with, and the caller", async () => {
    for (const recipient_ids of [["user_stranger"], [SAM], [DAD, "user_stranger"], [DAD, 7]]) {
      supabase = createSupabaseMock(createScript());
      const result = await createGroupGift({ ...NEW_WEEKEND, recipient_ids } as unknown as NewGift);
      expect(result, JSON.stringify(recipient_ids)).toEqual({ error: NOT_ALLOWED });
      expect(adminInserts()).toEqual([]);
    }
  });

  it("counts a repeated name once and refuses a twenty-first", async () => {
    supabase = createSupabaseMock(createScript());
    await createGroupGift({ ...NEW_WEEKEND, recipient_ids: [DAD, MOM, DAD, DAD] });
    expect(adminInserts()[1]).toEqual([
      "group_gift_recipients",
      [
        { group_gift_id: WEEKEND, user_id: DAD },
        { group_gift_id: WEEKEND, user_id: MOM },
      ],
    ]);

    const twentyOne = Array.from({ length: 21 }, (_, i) => `user_${i}`);
    supabase = createSupabaseMock(createScript());
    expect(await createGroupGift({ ...NEW_WEEKEND, recipient_ids: twentyOne })).toEqual({ error: TOO_MANY });
    expect(supabase.order).toEqual([]);

    // Twenty names, each given twice, are twenty: past the count, and refused only as strangers.
    const twenty = twentyOne.slice(0, 20);
    supabase = createSupabaseMock(createScript());
    expect(await createGroupGift({ ...NEW_WEEKEND, recipient_ids: [...twenty, ...twenty] })).toEqual({
      error: NOT_ALLOWED,
    });
  });

  it("tidies the name and refuses an empty, a long or an unsavable one", async () => {
    supabase = createSupabaseMock(createScript());
    await createGroupGift({ ...NEW_WEEKEND, name: "  Dad's\n60th " });
    expect(storedGift().name).toBe("Dad's 60th");

    // A control character is made a space by the tidying, so a name never reaches the database holding one.
    supabase = createSupabaseMock(createScript());
    await createGroupGift({ ...NEW_WEEKEND, name: "Dad\u0007s 60th\u0000" });
    expect(storedGift().name).toBe("Dad s 60th");

    supabase = createSupabaseMock(createScript());
    await createGroupGift({ ...NEW_WEEKEND, name: "x".repeat(200) });
    expect(storedGift().name).toBe("x".repeat(200));

    for (const [name, sentence] of [
      ["", NAME_MISSING],
      ["   ", NAME_MISSING],
      ["\n\t", NAME_MISSING],
      [undefined, NAME_MISSING],
      ["x".repeat(201), NAME_TOO_LONG],
      [` ${"x".repeat(201)} `, NAME_TOO_LONG],
    ] as const) {
      supabase = createSupabaseMock(createScript());
      const result = await createGroupGift({ ...NEW_WEEKEND, name } as unknown as NewGift);
      expect(result, JSON.stringify(name)).toEqual({ error: sentence });
      expect(supabase.order).toEqual([]);
    }
  });

  it("trims the description, keeps its line breaks, and refuses a long or an unsavable one", async () => {
    supabase = createSupabaseMock(createScript());
    await createGroupGift({ ...NEW_WEEKEND, description: "  Two nights.\r\n\tAt the coast.  " });
    expect(storedGift().description).toBe("Two nights.\r\n\tAt the coast.");

    supabase = createSupabaseMock(createScript());
    await createGroupGift({ ...NEW_WEEKEND, description: ` ${"y".repeat(1000)} ` });
    expect(storedGift().description).toBe("y".repeat(1000));

    for (const [description, sentence] of [
      ["y".repeat(1001), DESCRIPTION_TOO_LONG],
      ["Two nights\u0007", CHARACTERS],
      ["Two\u0000nights", CHARACTERS],
      ["Two nights\u007F", CHARACTERS],
    ] as const) {
      supabase = createSupabaseMock(createScript());
      const result = await createGroupGift({ ...NEW_WEEKEND, description });
      expect(result, JSON.stringify(description)).toEqual({ error: sentence });
      expect(supabase.order).toEqual([]);
    }
  });

  it("stores a blank description and a target of 0 as none, and refuses a bad amount", async () => {
    for (const description of ["", "   \n ", null, undefined]) {
      supabase = createSupabaseMock(createScript());
      await createGroupGift({ ...NEW_WEEKEND, description });
      expect(storedGift().description, JSON.stringify(description)).toBeNull();
    }

    for (const [target_amount, stored] of [
      [0, null],
      [null, null],
      [undefined, null],
      [0.01, 0.01],
      [1000000, 1000000],
    ] as const) {
      supabase = createSupabaseMock(createScript());
      await createGroupGift({ ...NEW_WEEKEND, target_amount });
      expect(storedGift().target_amount, String(target_amount)).toBe(stored);
    }

    for (const target_amount of [-1, 1000000.01, NaN, Infinity, -Infinity, "5", ""]) {
      supabase = createSupabaseMock(createScript());
      const result = await createGroupGift({ ...NEW_WEEKEND, target_amount } as unknown as NewGift);
      expect(result, String(target_amount)).toEqual({ error: AMOUNT });
      expect(supabase.order).toEqual([]);
    }
  });

  it("refuses a group the caller is not in", async () => {
    supabase = createSupabaseMock({ ...createScript(), group_members: [ok(null)] });

    const result = await createGroupGift({ ...NEW_WEEKEND, group_id: COACHES });

    expect(result).toEqual({ error: NOT_IN_GROUP });
    expect(query).toHaveBeenCalledWith("group_members", "eq", "group_id", COACHES);
    expect(query).toHaveBeenCalledWith("group_members", "eq", "user_id", SAM);
    expect(adminQuery).not.toHaveBeenCalled();
  });

  it("deletes the gift and answers Failed to create group gift. Please try again. when a later insert fails", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

    for (const table of ["admin:group_gift_recipients", "admin:group_gift_members"]) {
      consoleError.mockClear();
      adminQuery.mockClear();
      supabase = createSupabaseMock({ ...createScript(), [table]: [failed("insert refused", "23514")] });

      const result = await createGroupGift(NEW_WEEKEND);

      expect(result, table).toEqual({ error: CREATE_FAILED });
      expect(adminQuery).toHaveBeenCalledWith("group_gifts", "delete");
      expect(adminQuery).toHaveBeenCalledWith("group_gifts", "eq", "id", WEEKEND);
      expect(consoleError).toHaveBeenCalledWith(expect.any(String), "insert refused");
      // When the names fail, the maker's member row is never written.
      if (table === "admin:group_gift_recipients") expect(supabase.order).not.toContain("admin:group_gift_members");
    }
  });
});

/** One of the caller's member rows with its gift, as getMyGroupGifts reads them. */
const myRow = (gift: typeof WEEKEND_ROW | typeof TEACHER_ROW | typeof COACH_ROW, mine: Record<string, unknown>) => ({
  group_gift_id: gift.id,
  ...mine,
  group_gifts: gift,
});

describe("getMyGroupGifts", () => {
  it("leaves out a gift the caller is named on", async () => {
    supabase = createSupabaseMock({
      "admin:group_gift_members": [
        ok([
          myRow(WEEKEND_ROW, { contribution_amount: 120, has_paid: false, joined_at: "2026-11-16T18:30:00+00:00" }),
          myRow(TEACHER_ROW, { contribution_amount: 15, has_paid: true, joined_at: "2026-11-10T09:00:00+00:00" }),
        ]),
        ok([{ group_gift_id: WEEKEND }, { group_gift_id: WEEKEND }, { group_gift_id: WEEKEND }]),
      ],
      "admin:group_gift_recipients": [
        ok([
          { group_gift_id: WEEKEND, user_id: DAD },
          { group_gift_id: WEEKEND, user_id: MOM },
          { group_gift_id: TEACHER, user_id: SAM },
        ]),
      ],
      "admin:user_profiles": [ok([PEOPLE.dad, PEOPLE.mom])],
      group_members: [ok([{ group_id: RIVERA, groups: { name: "Rivera Family" } }])],
    });

    const { data } = await getMyGroupGifts();

    expect(data.map((g) => g.id)).toEqual([WEEKEND]);
    // Everything read after the names asks about the kept gift alone.
    expect(adminQuery).toHaveBeenCalledWith("group_gift_members", "in", "group_gift_id", [WEEKEND]);
    expect(adminQuery).toHaveBeenCalledWith("user_profiles", "in", "id", [DAD, MOM]);
    expect(query).toHaveBeenCalledWith("group_members", "in", "group_id", [RIVERA]);
    expect(JSON.stringify(data)).not.toContain(TEACHER);
    expect(JSON.stringify(data)).not.toContain("Teacher");
  });

  it("answers each gift's names, count and pledge", async () => {
    supabase = createSupabaseMock({
      "admin:group_gift_members": [
        ok([myRow(WEEKEND_ROW, { contribution_amount: 120, has_paid: false, joined_at: "2026-11-16T18:30:00+00:00" })]),
        ok([{ group_gift_id: WEEKEND }, { group_gift_id: WEEKEND }, { group_gift_id: WEEKEND }]),
      ],
      // Mom was ticked first; the names come back by name.
      "admin:group_gift_recipients": [
        ok([
          { group_gift_id: WEEKEND, user_id: MOM },
          { group_gift_id: WEEKEND, user_id: DAD },
        ]),
      ],
      "admin:user_profiles": [ok([PEOPLE.mom, PEOPLE.dad])],
      group_members: [ok([{ group_id: RIVERA, groups: { name: "Rivera Family" } }])],
    });

    const result = await getMyGroupGifts();

    expect(result).toEqual({
      data: [
        {
          ...WEEKEND_ROW,
          my_contribution: 120,
          my_has_paid: false,
          my_joined_at: "2026-11-16T18:30:00+00:00",
          member_count: 3,
          recipients: [PEOPLE.dad, PEOPLE.mom],
          group_name: "Rivera Family",
        },
      ],
    });
    expect(adminQuery).toHaveBeenCalledWith("group_gift_members", "eq", "user_id", SAM);
    expect(adminQuery).toHaveBeenCalledWith("group_gift_members", "order", "joined_at", { ascending: false });
  });

  it("names the group only to someone in it", async () => {
    supabase = createSupabaseMock({
      "admin:group_gift_members": [
        ok([
          myRow(WEEKEND_ROW, { contribution_amount: 120, has_paid: false, joined_at: "2026-11-16T18:30:00+00:00" }),
          myRow(COACH_ROW, { contribution_amount: 0, has_paid: false, joined_at: "2026-11-02T08:00:00+00:00" }),
        ]),
        ok([
          { group_gift_id: WEEKEND },
          { group_gift_id: COACH },
          { group_gift_id: WEEKEND },
          { group_gift_id: COACH },
          { group_gift_id: COACH },
          { group_gift_id: WEEKEND },
        ]),
      ],
      "admin:group_gift_recipients": [ok([])],
      // Sam has a group_members row in Rivera only: none in the coaches' group.
      group_members: [ok([{ group_id: RIVERA, groups: { name: "Rivera Family" } }])],
    });

    const { data } = await getMyGroupGifts();

    expect(data.map((g) => [g.id, g.group_name, g.member_count, g.recipients])).toEqual([
      [WEEKEND, "Rivera Family", 3, []],
      [COACH, null, 3, []],
    ]);
    // The group's name is read with the caller's own client, which shows only groups they are in.
    expect(adminQuery).not.toHaveBeenCalledWith("group_members", "from");
    expect(adminQuery).not.toHaveBeenCalledWith("groups", "from");
    expect(query).toHaveBeenCalledWith("group_members", "eq", "user_id", SAM);
    // A gift that names nobody asks for no profiles.
    expect(supabase.order).not.toContain("admin:user_profiles");
  });

  it("answers nothing to nobody signed in, and the database's words when a read fails", async () => {
    getUserId.mockResolvedValue(null);
    expect(await getMyGroupGifts()).toEqual({ data: [] });
    expect(supabase.order).toEqual([]);

    getUserId.mockResolvedValue(SAM);
    supabase = createSupabaseMock({
      "admin:group_gift_members": [
        ok([myRow(WEEKEND_ROW, { contribution_amount: 120, has_paid: false, joined_at: "2026-11-16T18:30:00+00:00" })]),
      ],
      "admin:group_gift_recipients": [failed("connection reset")],
    });
    expect(await getMyGroupGifts()).toEqual({ data: [], error: "connection reset" });
  });
});

/** The three reads seeGift makes: the gift, the caller's member row in it, and whether it names the caller. */
function seenScript(gift: unknown, membership: unknown, named: unknown): Record<string, unknown[]> {
  return {
    "admin:group_gifts": [ok(gift)],
    "admin:group_gift_members": [ok(membership)],
    "admin:group_gift_recipients": [ok(named)],
  };
}

/** Everything getGroupGiftById reads for Sam's weekend away, after seeGift. */
function weekendScript(chat: { count: number; latest: unknown[] }): Record<string, unknown[]> {
  return {
    "admin:group_gifts": [ok(WEEKEND_ROW)],
    "admin:group_gift_members": [ok(SAM_IN_WEEKEND), ok([JORDAN_IN_WEEKEND, ALEX_IN_WEEKEND, SAM_IN_WEEKEND])],
    "admin:group_gift_recipients": [
      ok(null),
      ok([
        { group_gift_id: WEEKEND, user_id: MOM },
        { group_gift_id: WEEKEND, user_id: DAD },
      ]),
    ],
    "admin:messages": [{ data: null, count: chat.count, error: null }, ok(chat.latest)],
    "admin:user_profiles": [ok([PEOPLE.sam, PEOPLE.alex, PEOPLE.jordan, PEOPLE.mom, PEOPLE.dad])],
    group_members: [ok([{ group_id: RIVERA, groups: { name: "Rivera Family" } }])],
  };
}

describe("getGroupGiftById", () => {
  it("answers Group gift not found to someone not in it, to someone it is for, and for no such gift", async () => {
    supabase = createSupabaseMock(seenScript(WEEKEND_ROW, null, null));
    const notIn = await getGroupGiftById(WEEKEND);

    // The database never lets a person a gift names hold a member row in it; the check refuses them even so.
    supabase = createSupabaseMock(seenScript(WEEKEND_ROW, { ...SAM_IN_WEEKEND }, { user_id: SAM }));
    const named = await getGroupGiftById(WEEKEND);
    expect([...supabase.order].sort()).toEqual([
      "admin:group_gift_members",
      "admin:group_gift_recipients",
      "admin:group_gifts",
    ]);
    expect(adminQuery).toHaveBeenCalledWith("group_gift_recipients", "eq", "user_id", SAM);

    supabase = createSupabaseMock(seenScript(null, null, null));
    const gone = await getGroupGiftById("9f9f9f9f-0000-4000-8000-000000000000");

    expect(notIn).toStrictEqual({ error: NOT_THERE });
    expect(named).toStrictEqual(notIn);
    expect(gone).toStrictEqual(notIn);
  });

  it("puts the maker first and answers the chat's count and newest message", async () => {
    supabase = createSupabaseMock(
      weekendScript({ count: 3, latest: [{ user_id: ALEX, content: "I can book it on Friday" }] }),
    );

    const result = await getGroupGiftById(WEEKEND);

    expect(result).toEqual({
      data: {
        ...WEEKEND_ROW,
        group_gift_members: [
          { ...SAM_IN_WEEKEND, user_profiles: PEOPLE.sam },
          { ...ALEX_IN_WEEKEND, user_profiles: PEOPLE.alex },
          { ...JORDAN_IN_WEEKEND, user_profiles: PEOPLE.jordan },
        ],
        my_membership: SAM_IN_WEEKEND,
        recipients: [PEOPLE.dad, PEOPLE.mom],
        group_name: "Rivera Family",
        chat: { count: 3, latest: { name: "Alex Rivera", text: "I can book it on Friday" } },
      },
    });
    // The count is the database's own, and the newest message is the last by time, then by id.
    expect(adminQuery).toHaveBeenCalledWith("messages", "select", "id", { count: "exact", head: true });
    expect(adminQuery).toHaveBeenCalledWith("messages", "eq", "group_gift_id", WEEKEND);
    expect(adminQuery).toHaveBeenCalledWith("messages", "order", "created_at", { ascending: false });
    expect(adminQuery).toHaveBeenCalledWith("messages", "order", "id", { ascending: false });
    expect(adminQuery).toHaveBeenCalledWith("messages", "limit", 1);
  });

  it("orders members who joined at the same moment by their row's id", async () => {
    const at = "2026-11-16T18:10:00+00:00";
    supabase = createSupabaseMock({
      ...weekendScript({ count: 0, latest: [] }),
      "admin:group_gift_members": [
        ok(SAM_IN_WEEKEND),
        ok([
          { ...ALEX_IN_WEEKEND, joined_at: at },
          { ...JORDAN_IN_WEEKEND, joined_at: at },
          SAM_IN_WEEKEND,
        ]),
      ],
    });

    const result = await getGroupGiftById(WEEKEND);

    expect("data" in result && result.data?.group_gift_members.map((m) => m.user_id)).toEqual([SAM, JORDAN, ALEX]);
  });

  it("answers no newest message for an empty chat", async () => {
    supabase = createSupabaseMock(weekendScript({ count: 0, latest: [] }));

    const result = await getGroupGiftById(WEEKEND);

    expect("data" in result && result.data?.chat).toEqual({ count: 0, latest: null });
  });

  it("names the sender of the newest message even when they have left, and Someone when their profile is gone", async () => {
    supabase = createSupabaseMock({
      ...weekendScript({ count: 1, latest: [{ user_id: GRAN, content: "Count me out" }] }),
      "admin:user_profiles": [ok([PEOPLE.sam, PEOPLE.alex, PEOPLE.jordan, PEOPLE.mom, PEOPLE.dad, PEOPLE.gran])],
    });
    const left = await getGroupGiftById(WEEKEND);
    expect("data" in left && left.data?.chat.latest).toEqual({ name: "Gran", text: "Count me out" });

    supabase = createSupabaseMock(weekendScript({ count: 1, latest: [{ user_id: GRAN, content: "Count me out" }] }));
    const gone = await getGroupGiftById(WEEKEND);
    expect("data" in gone && gone.data?.chat.latest).toEqual({ name: "Someone", text: "Count me out" });
  });

  it("answers Not authenticated to nobody signed in, and the database's words when the check cannot read", async () => {
    getUserId.mockResolvedValue(null);
    expect(await getGroupGiftById(WEEKEND)).toEqual({ error: "Not authenticated" });
    expect(supabase.order).toEqual([]);

    getUserId.mockResolvedValue(SAM);
    supabase = createSupabaseMock({
      ...seenScript(WEEKEND_ROW, SAM_IN_WEEKEND, null),
      "admin:group_gift_members": [failed("connection reset")],
    });
    expect(await getGroupGiftById(WEEKEND)).toEqual({ error: "connection reset" });
  });
});

describe("getGroupGiftChoices", () => {
  it("answers the caller's groups and everyone in them but the caller, each with the groups they share", async () => {
    supabase = createSupabaseMock({ group_members: [MY_GROUPS, THEIR_MEMBERS], user_profiles: [MATES_PROFILES] });

    const result = await getGroupGiftChoices();

    expect(result).toEqual({
      data: {
        groups: [
          { id: BOOK_CLUB, name: "Book Club" },
          { id: RIVERA, name: "Rivera Family" },
        ],
        people: [
          { ...PEOPLE.alex, group_ids: [BOOK_CLUB, RIVERA] },
          { ...PEOPLE.dad, group_ids: [RIVERA] },
          { ...PEOPLE.gran, group_ids: [RIVERA] },
          { ...PEOPLE.jordan, group_ids: [RIVERA] },
          { ...PEOPLE.mom, group_ids: [RIVERA] },
          { ...PEOPLE.priya, group_ids: [BOOK_CLUB] },
        ],
      },
    });
    // The caller is never offered, so their own profile is not asked for.
    expect(query).toHaveBeenCalledWith("user_profiles", "in", "id", [MOM, DAD, ALEX, JORDAN, GRAN, PRIYA]);
    expect(query).toHaveBeenCalledWith("user_profiles", "select", "id, username, display_name, avatar_url");
    // Read as the caller, so row-level security decides what comes back.
    expect(adminQuery).not.toHaveBeenCalled();
  });

  it("answers no groups and nobody to someone in no group, and Not authenticated to nobody signed in", async () => {
    supabase = createSupabaseMock({ group_members: [ok([])] });
    expect(await getGroupGiftChoices()).toEqual({ data: { groups: [], people: [] } });
    expect(supabase.order).toEqual(["group_members"]);

    getUserId.mockResolvedValue(null);
    supabase = createSupabaseMock({});
    expect(await getGroupGiftChoices()).toEqual({ error: "Not authenticated" });
  });
});
