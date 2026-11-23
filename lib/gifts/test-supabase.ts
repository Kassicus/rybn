// Tests only. A fake Supabase client for the group gift and chat action tests (lib/actions/gifts.test.ts,
// lib/actions/messages.test.ts). Each test file declares its own vi.mock calls, which hand the code under test the
// fake it holds now: `from` as the caller's own client's, `adminFrom` as the service-role client's.

/**
 * One query, recorded as a unit: which client made it ("user" is the caller's own, "admin" the service-role one),
 * of which table, and every call on its chain in order, the terminal `maybeSingle` or `single` included. A test
 * asserts the whole chain of one read: its columns, each filter, its order and its limit.
 */
export interface Query {
  client: "user" | "admin";
  table: string;
  calls: unknown[][];
}

/**
 * A scripted answer: the value a query resolves to, or a function of the query that makes it (see rowsIn), for an
 * answer that should depend on what the code asked for.
 */
export type Answer = unknown | ((query: Query) => unknown);

/** A query's table as the script names it: "admin:<table>" for the service-role client. */
function keyOf(query: Query): string {
  return query.client === "admin" ? `admin:${query.table}` : query.table;
}

/**
 * Supabase's query builder is thenable, so `await from().select().eq()` resolves without a terminal call while
 * `.maybeSingle()` and `.single()` are their own promises. Every chain method returns the chain and is recorded on
 * the query; the chain resolves the next scripted answer for its table once the chain is complete.
 *
 * Answers are queued PER TABLE and taken in the order the queries resolve; the service-role client's are queued
 * under "admin:<table>". `queries` holds every query, in the order made. A test scripts the answers, calls the
 * action, then reads `asked()`, `tablesAsked()` or `adminInserts()`.
 */
export function createSupabaseMock(script: Record<string, Answer[]>) {
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

  /** Every query made, by table as the script names it, each as its chain of calls, in the order made. */
  const asked = (): Record<string, unknown[][][]> => {
    const byTable: Record<string, unknown[][][]> = {};
    for (const query of queries) (byTable[keyOf(query)] ??= []).push(query.calls);
    return byTable;
  };

  /** The tables asked, as the script names them, in the order asked. */
  const tablesAsked = () => queries.map(keyOf);

  /** Every insert the service-role client made, as [table, payload], in the order made. */
  const adminInserts = () =>
    queries
      .filter((query) => query.client === "admin")
      .flatMap((query) => query.calls.filter(([method]) => method === "insert").map((call) => [query.table, call[1]]));

  return { queries, from: client("user"), adminFrom: client("admin"), asked, tablesAsked, adminInserts };
}

export const ok = (data: unknown) => ({ data, error: null });
export const failed = (message: string, code = "XX000") => ({ data: null, error: { message, code } });

/**
 * An answer holding only those of `rows` whose `column` is among the values the query asked for with
 * `.in(column, values)`, as the database would answer it: nobody the code did not ask for comes back.
 */
export const rowsIn =
  (column: string, rows: Record<string, unknown>[]) =>
  (query: Query) => {
    const wanted = query.calls.find(([method, on]) => method === "in" && on === column)?.[2];
    return ok(rows.filter((row) => Array.isArray(wanted) && wanted.includes(row[column])));
  };

type Row = Record<string, unknown>;
type Keep = (row: Row) => boolean;

/**
 * Two values in the order the database puts them, for the values these tests hold: text, timestamps written in one
 * form (`2026-11-16T18:02:11.000000+00:00`) and UUIDs in lower case all sort as their text does.
 */
const compare = (a: unknown, b: unknown) => {
  const x = String(a);
  const y = String(b);
  return x < y ? -1 : x > y ? 1 : 0;
};

const OPERATORS: Record<string, (order: number) => boolean> = {
  eq: (o) => o === 0,
  neq: (o) => o !== 0,
  lt: (o) => o < 0,
  lte: (o) => o <= 0,
  gt: (o) => o > 0,
  gte: (o) => o >= 0,
};

/** A logic tree's list split at its own commas: not those inside parentheses or double quotes. */
function splitList(list: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let quoted = false;
  let start = 0;
  for (let i = 0; i < list.length; i++) {
    const c = list[i];
    if (c === '"') quoted = !quoted;
    else if (!quoted && c === "(") depth++;
    else if (!quoted && c === ")") depth--;
    else if (!quoted && depth === 0 && c === ",") {
      parts.push(list.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(list.slice(start));
  return parts;
}

/**
 * One condition of a PostgREST logic tree, as `.or()` is given them: `column.operator.value`, or `and(…)` or `or(…)`
 * of more. A value that holds one of PostgREST's reserved characters (`,` `.` `:` `(` `)`) must be in double quotes
 * or the database misreads it; the fake throws on such a value, so the test fails where the database would.
 */
function condition(text: string): Keep {
  const tree = /^(and|or)\((.*)\)$/.exec(text);
  if (tree) {
    const parts = splitList(tree[2]).map(condition);
    return tree[1] === "and" ? (row) => parts.every((keep) => keep(row)) : (row) => parts.some((keep) => keep(row));
  }
  const leaf = /^(\w+)\.(eq|neq|lt|lte|gt|gte)\.(.*)$/.exec(text);
  if (!leaf) throw new Error(`The fake cannot read the filter "${text}"`);
  const [, column, operator, raw] = leaf;
  const quoted = /^".*"$/.test(raw);
  if (!quoted && /[,.:()]/.test(raw)) throw new Error(`The value "${raw}" holds a reserved character and is not quoted`);
  const value = quoted ? raw.slice(1, -1) : raw;
  return (row) => OPERATORS[operator](compare(row[column], value));
}

/** What one call on a chain keeps of a row: a filter keeps what matches it, every other call keeps everything. */
function keepOf([method, ...args]: unknown[]): Keep {
  const column = args[0] as string;
  if (typeof method === "string" && Object.hasOwn(OPERATORS, method)) {
    return (row) => OPERATORS[method](compare(row[column], args[1]));
  }
  if (method === "in") return (row) => (args[1] as unknown[]).some((value) => compare(row[column], value) === 0);
  if (method === "or") return condition(`or(${args[0] as string})`);
  return () => true;
}

/**
 * An answer that reads `rows` as the database would read a table for the query: the rows every filter on its chain
 * keeps (eq, neq, lt, lte, gt, gte, in, and an or of them with and inside it), in its order (each `order` after the
 * first breaks the earlier ones' ties), cut to its limit; for `maybeSingle` or `single`, the one row or null. So an
 * answer depends on what the code asked for: a filter left out lets rows through that the test can see.
 */
export const rowsWhere = (rows: Row[]) => (query: Query) => {
  const keeps = query.calls.map(keepOf);
  const orders = query.calls.filter(([method]) => method === "order") as [string, string, { ascending?: boolean }?][];
  const limit = query.calls.find(([method]) => method === "limit")?.[1];

  const found = rows
    .filter((row) => keeps.every((keep) => keep(row)))
    .sort((a, b) => {
      for (const [, column, options] of orders) {
        const order = compare(a[column], b[column]);
        if (order !== 0) return options?.ascending === false ? -order : order;
      }
      return 0;
    })
    .slice(0, typeof limit === "number" ? limit : undefined);

  const last = query.calls[query.calls.length - 1]?.[0];
  if (last === "maybeSingle" || last === "single") {
    if (found.length > 1 || (last === "single" && found.length === 0)) {
      throw new Error(`"${query.table}" has ${found.length} rows where the query asked for one`);
    }
    return ok(found[0] ?? null);
  }
  return ok(found);
};
