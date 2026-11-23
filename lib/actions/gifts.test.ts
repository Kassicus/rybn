import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/**
 * The group gift actions, with Supabase faked. A group gift's rows are read and written with the service-role
 * client; who is in which group is read with the caller's own client. Every test here is about one rule: a gift
 * says who it is for, those people are never told of it, and every read of a gift goes through one check.
 *
 * The sentences, and the columns each read names, are written out rather than imported: if the wording or the
 * columns change, these assertions fail -- which is the intent.
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

const GIFT_COLUMNS = "id, group_id, name, description, target_amount, current_amount, is_active, created_by, created_at";
const MEMBER_COLUMNS = "id, group_gift_id, user_id, contribution_amount, has_paid, joined_at";
const PERSON_COLUMNS = "id, username, display_name, avatar_url";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const getUserId = vi.fn();

vi.mock("@/lib/auth/require-auth", () => ({
  getUserId: () => getUserId(),
}));

/**
 * One query, recorded as a unit: which client made it ("user" is the caller's own, "admin" the service-role one),
 * of which table, and every call on its chain in order, the terminal `maybeSingle` or `single` included. A test
 * asserts the whole chain of one read: its columns, each filter, its order and its limit.
 */
interface Query {
  client: "user" | "admin";
  table: string;
  calls: unknown[][];
}

/**
 * A scripted answer: the value a query resolves to, or a function of the query that makes it (see rowsIn), for an
 * answer that should depend on what the code asked for.
 */
type Answer = unknown | ((query: Query) => unknown);

/**
 * Supabase's query builder is thenable, so `await from().select().eq()` resolves without a terminal call while
 * `.maybeSingle()` and `.single()` are their own promises. Every chain method returns the chain and is recorded on
 * the query; the chain resolves the next scripted answer for its table once the chain is complete.
 *
 * Answers are queued PER TABLE and taken in the order the queries resolve; the service-role client's are queued
 * under "admin:<table>". `queries` holds every query, in the order made. Tests added to this file later use the
 * same fake: script the answers, call the action, then read `asked()`, `tablesAsked()` or `adminInserts()`.
 */
function createSupabaseMock(script: Record<string, Answer[]>) {
  const queues: Record<string, Answer[]> = {};
  for (const [table, answers] of Object.entries(script)) queues[table] = [...answers];
  const queries: Query[] = [];

  const client = (who: Query["client"]) => (table: string) => {
    const query: Query = { client: who, table, calls: [] };
    queries.push(query);
    const queued = keyOf(query);
    const next = () => {
      const queue = queues[queued];
      if (!queue || queue.length === 0) throw new Error(`No scripted Supabase answer left for "${queued}"`);
      const answer = queue.shift();
      return typeof answer === "function" ? answer(query) : answer;
    };

    const chain: Record<string, unknown> = {};
    for (const method of [
      "select", "insert", "update", "delete",
      "eq", "neq", "in", "gt", "gte", "lt", "lte", "or", "not",
      "order", "limit", "range",
    ]) {
      chain[method] = (...args: unknown[]) => {
        query.calls.push([method, ...args]);
        return chain;
      };
    }
    chain.maybeSingle = async () => {
      query.calls.push(["maybeSingle"]);
      return next();
    };
    chain.single = async () => {
      query.calls.push(["single"]);
      return next();
    };
    chain.then = (resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) =>
      Promise.resolve()
        .then(next)
        .then(resolve, reject);
    return chain;
  };

  return { queries, from: client("user"), adminFrom: client("admin") };
}

/** A query's table as the script names it: "admin:<table>" for the service-role client. */
function keyOf(query: Query): string {
  return query.client === "admin" ? `admin:${query.table}` : query.table;
}

let supabase: ReturnType<typeof createSupabaseMock>;

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ from: (table: string) => supabase.from(table) }),
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({ from: (table: string) => supabase.adminFrom(table) }),
}));

/** Every query made, by table as the script names it, each as its chain of calls, in the order made. */
function asked(): Record<string, unknown[][][]> {
  const byTable: Record<string, unknown[][][]> = {};
  for (const query of supabase.queries) (byTable[keyOf(query)] ??= []).push(query.calls);
  return byTable;
}

/** The tables asked, as the script names them, in the order asked. */
const tablesAsked = () => supabase.queries.map(keyOf);

/** Every insert the service-role client made, as [table, payload], in the order made. */
const adminInserts = () =>
  supabase.queries
    .filter((query) => query.client === "admin")
    .flatMap((query) => query.calls.filter(([method]) => method === "insert").map((call) => [query.table, call[1]]));

/** The row the latest gift insert wrote. */
const storedGift = () => {
  const gifts = adminInserts().filter(([table]) => table === "group_gifts");
  return gifts[gifts.length - 1]?.[1] as Record<string, unknown>;
};

const ok = (data: unknown) => ({ data, error: null });
const failed = (message: string, code = "XX000") => ({ data: null, error: { message, code } });

/**
 * An answer holding only those of `rows` whose `column` is among the values the query asked for with
 * `.in(column, values)`, as the database would answer it: nobody the code did not ask for comes back.
 */
const rowsIn =
  (column: string, rows: Record<string, unknown>[]) =>
  (query: Query) => {
    const wanted = query.calls.find(([method, on]) => method === "in" && on === column)?.[2];
    return ok(rows.filter((row) => Array.isArray(wanted) && wanted.includes(row[column])));
  };

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

/** Every profile, Sam's own among them: rowsIn answers only those the code asks for. */
const EVERYONE = Object.values(PEOPLE);

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

/** groupMates' three reads, as the caller: their groups, those groups' members, then everyone but the caller. */
const MATES_READS = [
  [["select", "group_id, groups ( id, name )"], ["eq", "user_id", SAM]],
  [["select", "group_id, user_id"], ["in", "group_id", [BOOK_CLUB, RIVERA]]],
];
const MATES_PROFILES_READ = [["select", PERSON_COLUMNS], ["in", "id", [MOM, DAD, ALEX, JORDAN, GRAN, PRIYA]]];

/**
 * createGroupGift's reads and writes when everything goes: the caller's own membership of the group, then
 * groupMates (their groups, those groups' members, the members' profiles), then the gift, its names and its
 * maker's member row.
 */
function createScript(): Record<string, Answer[]> {
  return {
    group_members: [ok({ id: "b0000000-0000-4000-8000-000000000001" }), MY_GROUPS, THEIR_MEMBERS],
    user_profiles: [rowsIn("id", EVERYONE)],
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
    const storedRow = {
      name: "Anniversary weekend away",
      description: "Two nights at the coast.",
      group_id: RIVERA,
      target_amount: 600,
      is_active: true,
      created_by: SAM,
    };
    const names = [
      { group_gift_id: WEEKEND, user_id: DAD },
      { group_gift_id: WEEKEND, user_id: MOM },
    ];
    const makerRow = { group_gift_id: WEEKEND, user_id: SAM, contribution_amount: 0, has_paid: false };
    expect(adminInserts()).toEqual([
      ["group_gifts", storedRow],
      ["group_gift_recipients", names],
      ["group_gift_members", makerRow],
    ]);
    expect(storedGift()).not.toHaveProperty("target_user_id");
    // Who is in which group is read as the caller, never with the service-role client.
    expect(asked()).toEqual({
      group_members: [
        [["select", "id"], ["eq", "group_id", RIVERA], ["eq", "user_id", SAM], ["maybeSingle"]],
        ...MATES_READS,
      ],
      user_profiles: [MATES_PROFILES_READ],
      "admin:group_gifts": [[["insert", storedRow], ["select", GIFT_COLUMNS], ["single"]]],
      "admin:group_gift_recipients": [[["insert", names]]],
      "admin:group_gift_members": [[["insert", makerRow]]],
    });
  });

  it("writes no names for someone not on Rybn", async () => {
    supabase = createSupabaseMock(createScript());

    const result = await createGroupGift({ ...NEW_WEEKEND, recipient_ids: [] });

    expect(result).toEqual({ data: WEEKEND_ROW });
    expect(adminInserts().map(([table]) => table)).toEqual(["group_gifts", "group_gift_members"]);
    expect(tablesAsked()).not.toContain("admin:group_gift_recipients");
  });

  it("answers Choose who this gift is for. when the list is missing", async () => {
    for (const recipient_ids of [undefined, "x", null, { 0: DAD }]) {
      supabase = createSupabaseMock(createScript());
      const result = await createGroupGift({ ...NEW_WEEKEND, recipient_ids } as unknown as NewGift);
      expect(result).toEqual({ error: CHOOSE_WHO });
      expect(supabase.queries).toEqual([]);
    }
  });

  it("answers Not authenticated to nobody signed in, reading nothing", async () => {
    getUserId.mockResolvedValue(null);
    supabase = createSupabaseMock(createScript());

    expect(await createGroupGift(NEW_WEEKEND)).toEqual({ error: "Not authenticated" });
    expect(supabase.queries).toEqual([]);
  });

  it("refuses someone the caller shares no group with, and the caller", async () => {
    // Sam is in both groups' members, and his profile would come back if asked for: only leaving him out of his
    // own group-mates refuses him.
    for (const recipient_ids of [[SAM], ["user_stranger"], [DAD, "user_stranger"], [DAD, 7]]) {
      supabase = createSupabaseMock(createScript());
      const result = await createGroupGift({ ...NEW_WEEKEND, recipient_ids } as unknown as NewGift);
      expect(result, JSON.stringify(recipient_ids)).toEqual({ error: NOT_ALLOWED });
      expect(adminInserts()).toEqual([]);
      expect(asked().user_profiles, JSON.stringify(recipient_ids)).toEqual([MATES_PROFILES_READ]);
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
    expect(supabase.queries).toEqual([]);

    // Twenty names, each given twice, are twenty: past the count, and refused only as strangers.
    const twenty = twentyOne.slice(0, 20);
    supabase = createSupabaseMock(createScript());
    expect(await createGroupGift({ ...NEW_WEEKEND, recipient_ids: [...twenty, ...twenty] })).toEqual({
      error: NOT_ALLOWED,
    });
  });

  it("tidies the name and refuses an empty or a long one", async () => {
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
      expect(supabase.queries).toEqual([]);
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
      expect(supabase.queries).toEqual([]);
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
      expect(supabase.queries).toEqual([]);
    }
  });

  it("refuses a group the caller is not in", async () => {
    supabase = createSupabaseMock({ ...createScript(), group_members: [ok(null)] });

    const result = await createGroupGift({ ...NEW_WEEKEND, group_id: COACHES });

    expect(result).toEqual({ error: NOT_IN_GROUP });
    expect(asked()).toEqual({
      group_members: [[["select", "id"], ["eq", "group_id", COACHES], ["eq", "user_id", SAM], ["maybeSingle"]]],
    });
  });

  it("deletes the gift and answers Failed to create group gift. Please try again. when a later insert fails", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

    for (const table of ["admin:group_gift_recipients", "admin:group_gift_members"]) {
      consoleError.mockClear();
      supabase = createSupabaseMock({ ...createScript(), [table]: [failed("insert refused", "23514")] });

      const result = await createGroupGift(NEW_WEEKEND);

      expect(result, table).toEqual({ error: CREATE_FAILED });
      expect(asked()["admin:group_gifts"]?.[1], table).toEqual([["delete"], ["eq", "id", WEEKEND]]);
      expect(consoleError).toHaveBeenCalledWith(expect.any(String), "insert refused");
      // When the names fail, the maker's member row is never written.
      if (table === "admin:group_gift_recipients") expect(tablesAsked()).not.toContain("admin:group_gift_members");
    }
  });
});

/** One of the caller's member rows with its gift, as getMyGroupGifts reads them. */
const myRow = (gift: typeof WEEKEND_ROW | typeof TEACHER_ROW | typeof COACH_ROW, mine: Record<string, unknown>) => ({
  group_gift_id: gift.id,
  ...mine,
  group_gifts: gift,
});

/** getMyGroupGifts' first read: the caller's member rows, with each row's gift, newest first. */
const MY_MEMBER_ROWS_READ = [
  [
    "select",
    "group_gift_id, contribution_amount, has_paid, joined_at, group_gifts ( id, group_id, name, description, target_amount, current_amount, is_active, created_by, created_at )",
  ],
  ["eq", "user_id", SAM],
  ["order", "joined_at", { ascending: false }],
];

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
      "admin:user_profiles": [rowsIn("id", EVERYONE)],
      group_members: [ok([{ group_id: RIVERA, groups: { name: "Rivera Family" } }])],
    });

    const { data } = await getMyGroupGifts();

    expect(data.map((g) => g.id)).toEqual([WEEKEND]);
    // Everything read after the names asks about the kept gift alone.
    expect(asked()).toEqual({
      "admin:group_gift_members": [MY_MEMBER_ROWS_READ, [["select", "group_gift_id"], ["in", "group_gift_id", [WEEKEND]]]],
      "admin:group_gift_recipients": [[["select", "group_gift_id, user_id"], ["in", "group_gift_id", [WEEKEND, TEACHER]]]],
      "admin:user_profiles": [[["select", PERSON_COLUMNS], ["in", "id", [DAD, MOM]]]],
      group_members: [[["select", "group_id, groups ( name )"], ["eq", "user_id", SAM], ["in", "group_id", [RIVERA]]]],
    });
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
      "admin:user_profiles": [rowsIn("id", EVERYONE)],
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
    expect(asked()).toEqual({
      "admin:group_gift_members": [MY_MEMBER_ROWS_READ, [["select", "group_gift_id"], ["in", "group_gift_id", [WEEKEND]]]],
      "admin:group_gift_recipients": [[["select", "group_gift_id, user_id"], ["in", "group_gift_id", [WEEKEND]]]],
      "admin:user_profiles": [[["select", PERSON_COLUMNS], ["in", "id", [MOM, DAD]]]],
      group_members: [[["select", "group_id, groups ( name )"], ["eq", "user_id", SAM], ["in", "group_id", [RIVERA]]]],
    });
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
    // The group's name is read with the caller's own client, about the caller's own rows, which row-level
    // security shows only for groups they are in. A gift that names nobody asks for no profiles.
    expect(asked()).toEqual({
      "admin:group_gift_members": [
        MY_MEMBER_ROWS_READ,
        [["select", "group_gift_id"], ["in", "group_gift_id", [WEEKEND, COACH]]],
      ],
      "admin:group_gift_recipients": [[["select", "group_gift_id, user_id"], ["in", "group_gift_id", [WEEKEND, COACH]]]],
      group_members: [
        [["select", "group_id, groups ( name )"], ["eq", "user_id", SAM], ["in", "group_id", [RIVERA, COACHES]]],
      ],
    });
  });

  it("answers nothing to nobody signed in, and the database's words when a read fails", async () => {
    getUserId.mockResolvedValue(null);
    expect(await getMyGroupGifts()).toEqual({ data: [] });
    expect(supabase.queries).toEqual([]);

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

/** The one check's three reads for Sam and a gift: the gift, Sam's member row in it, and whether it names Sam. */
const checkGift = (id: string) => [["select", GIFT_COLUMNS], ["eq", "id", id], ["maybeSingle"]];
const checkMember = (id: string) => [
  ["select", MEMBER_COLUMNS],
  ["eq", "group_gift_id", id],
  ["eq", "user_id", SAM],
  ["maybeSingle"],
];
const checkNamed = (id: string) => [["select", "user_id"], ["eq", "group_gift_id", id], ["eq", "user_id", SAM], ["maybeSingle"]];

/** The answers to the check's three reads: the gift, the caller's member row in it, and whether it names the caller. */
function seenScript(gift: unknown, membership: unknown, named: unknown): Record<string, Answer[]> {
  return {
    "admin:group_gifts": [ok(gift)],
    "admin:group_gift_members": [ok(membership)],
    "admin:group_gift_recipients": [ok(named)],
  };
}

/** Everything getGroupGiftById reads for Sam's weekend away, after seeGift. */
function weekendScript(chat: { count: number; latest: unknown[] }): Record<string, Answer[]> {
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
    "admin:user_profiles": [rowsIn("id", EVERYONE)],
    group_members: [ok([{ group_id: RIVERA, groups: { name: "Rivera Family" } }])],
  };
}

describe("getGroupGiftById", () => {
  it("answers Group gift not found to someone not in it, to someone it is for, and for no such gift", async () => {
    const gone = "9f9f9f9f-0000-4000-8000-000000000000";
    const answers = [];

    for (const [label, id, script] of [
      ["not in it", WEEKEND, seenScript(WEEKEND_ROW, null, null)],
      // The database never lets a person a gift names hold a member row in it; the check refuses them even so.
      ["named on it", WEEKEND, seenScript(WEEKEND_ROW, { ...SAM_IN_WEEKEND }, { user_id: SAM })],
      ["no such gift", gone, seenScript(null, null, null)],
    ] as const) {
      supabase = createSupabaseMock(script);
      answers.push(await getGroupGiftById(id));
      // Each read of the check asks about this gift and this caller, and nothing more is read.
      expect(asked(), label).toEqual({
        "admin:group_gifts": [checkGift(id)],
        "admin:group_gift_members": [checkMember(id)],
        "admin:group_gift_recipients": [checkNamed(id)],
      });
    }

    expect(answers[0]).toStrictEqual({ error: NOT_THERE });
    expect(answers[1]).toStrictEqual(answers[0]);
    expect(answers[2]).toStrictEqual(answers[0]);
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
    // After the check, every read is about this gift alone: its members, its names, its chat. The count is the
    // database's own, and the newest message is the last by time, then by id.
    expect(asked()).toEqual({
      "admin:group_gifts": [checkGift(WEEKEND)],
      "admin:group_gift_members": [checkMember(WEEKEND), [["select", MEMBER_COLUMNS], ["eq", "group_gift_id", WEEKEND]]],
      "admin:group_gift_recipients": [
        checkNamed(WEEKEND),
        [["select", "group_gift_id, user_id"], ["in", "group_gift_id", [WEEKEND]]],
      ],
      "admin:messages": [
        [["select", "id", { count: "exact", head: true }], ["eq", "group_gift_id", WEEKEND]],
        [
          ["select", "user_id, content"],
          ["eq", "group_gift_id", WEEKEND],
          ["order", "created_at", { ascending: false }],
          ["order", "id", { ascending: false }],
          ["limit", 1],
        ],
      ],
      "admin:user_profiles": [[["select", PERSON_COLUMNS], ["in", "id", [SAM, ALEX, JORDAN, MOM, DAD]]]],
      group_members: [[["select", "group_id, groups ( name )"], ["eq", "user_id", SAM], ["in", "group_id", [RIVERA]]]],
    });
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
    supabase = createSupabaseMock(weekendScript({ count: 1, latest: [{ user_id: GRAN, content: "Count me out" }] }));
    const left = await getGroupGiftById(WEEKEND);
    expect("data" in left && left.data?.chat.latest).toEqual({ name: "Gran", text: "Count me out" });

    supabase = createSupabaseMock({
      ...weekendScript({ count: 1, latest: [{ user_id: GRAN, content: "Count me out" }] }),
      "admin:user_profiles": [rowsIn("id", EVERYONE.filter((p) => p.id !== GRAN))],
    });
    const gone = await getGroupGiftById(WEEKEND);
    expect("data" in gone && gone.data?.chat.latest).toEqual({ name: "Someone", text: "Count me out" });
  });

  it("answers Not authenticated to nobody signed in, and the database's words when the check cannot read", async () => {
    getUserId.mockResolvedValue(null);
    expect(await getGroupGiftById(WEEKEND)).toEqual({ error: "Not authenticated" });
    expect(supabase.queries).toEqual([]);

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
    supabase = createSupabaseMock({ group_members: [MY_GROUPS, THEIR_MEMBERS], user_profiles: [rowsIn("id", EVERYONE)] });

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
    // Read as the caller, so row-level security decides what comes back: the caller's own memberships, the members
    // of those groups alone, and everyone's profile but the caller's.
    expect(asked()).toEqual({ group_members: MATES_READS, user_profiles: [MATES_PROFILES_READ] });
  });

  it("answers no groups and nobody to someone in no group, and Not authenticated to nobody signed in", async () => {
    supabase = createSupabaseMock({ group_members: [ok([])] });
    expect(await getGroupGiftChoices()).toEqual({ data: { groups: [], people: [] } });
    expect(asked()).toEqual({ group_members: [MATES_READS[0]] });

    getUserId.mockResolvedValue(null);
    supabase = createSupabaseMock({});
    expect(await getGroupGiftChoices()).toEqual({ error: "Not authenticated" });
  });
});
