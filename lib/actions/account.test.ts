import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { inspect } from "node:util";

/**
 * deleteAccount deletes the caller's account in steps that can be run again:
 * their pictures in both buckets, then delete_account() in the database, then
 * the email to the address read before it, then the sign-in account, then
 * delete_account() once more, so that nothing made for the person while the
 * deletion ran stays. A step that fails stops the ones after it, and the next
 * try finishes what is left without making a profile on the way; the last
 * step's error is logged by its code alone, and the deletion answers success.
 *
 * Nothing here reaches the network: the sign-in provider, storage, the
 * database and the email service are all fakes.
 */

/**
 * ACCOUNT_SENTENCES.deleteFailed (lib/account/sentences.ts), written out
 * rather than imported: if the wording there changes, these fail.
 */
const DELETE_FAILED = "Couldn't delete your account. Please try again.";

const CALLER = "user_2abcDEF";
const ADDRESS = "sam@example.com";

/** What each fake records, in call order: remove:<bucket>, rpc:<name>, email:<to>, signIn:<id>. */
let steps: string[] = [];

const getUserId = vi.fn();
const requireAuthWithProfile = vi.fn();
vi.mock("@/lib/auth/require-auth", () => ({
  getUserId: () => getUserId(),
  requireAuthWithProfile: () => requireAuthWithProfile(),
}));

const ensureProfile = vi.fn();
vi.mock("@/lib/auth/ensure-profile", () => ({
  ensureProfile: () => ensureProfile(),
}));

const sendAccountDeletedEmail = vi.fn();
vi.mock("@/lib/resend/send", () => ({
  sendAccountDeletedEmail: (...args: unknown[]) => sendAccountDeletedEmail(...args),
}));

const deleteSignInAccount = vi.fn();
vi.mock("@/lib/auth/clerk-users", () => ({
  deleteSignInAccount: (...args: unknown[]) => deleteSignInAccount(...args),
}));

type Call = { method: string; args: unknown[] };
type StorageError = { message: string };

/**
 * A database and storage that keep state between calls, so a second try sees
 * what the first one left.
 *
 * `buckets` holds each bucket's paths. `list(prefix, { limit, offset })`
 * answers the names directly under `prefix`, by name, as Supabase does, and
 * never more than `pageCap` of them however many are asked for;
 * `remove(paths)` deletes them. `profile` is the caller's user_profiles row,
 * and `rpc` empties it. Every method called on user_profiles is recorded.
 * `rpcErrors` is what each call of `rpc` answers in turn (null for no error);
 * once they are used up, every call answers `rpcError`.
 */
type DbError = { code: string; message: string };
type World = {
  buckets: Record<string, Set<string>>;
  pageCap: number;
  profile: { email: string | null } | null;
  readError: DbError | null;
  listError: Record<string, StorageError>;
  removeError: Record<string, StorageError>;
  rpcErrors: (DbError | null)[];
  rpcError: DbError | null;
};

function createWorld(seed: Partial<World> = {}): World {
  return {
    buckets: { "wishlist-images": new Set(), "gift-photos": new Set() },
    pageCap: Infinity,
    profile: { email: ADDRESS },
    readError: null,
    listError: {},
    removeError: {},
    rpcErrors: [],
    rpcError: null,
    ...seed,
  };
}

let world: World;
/** Every list: the bucket, the prefix asked for, and the options. */
let lists: { bucket: string; prefix: string; options: { limit: number; offset: number } }[] = [];
/** Every method called on from("user_profiles"), across every query. */
let profileCalls: Call[] = [];

const rpc = vi.fn(async (name: string) => {
  steps.push(`rpc:${name}`);
  const error = world.rpcErrors.length > 0 ? (world.rpcErrors.shift() ?? null) : world.rpcError;
  if (error) return { data: null, error };
  world.profile = null;
  return { data: null, error: null };
});

function fakeClient() {
  return {
    rpc,
    storage: {
      from(bucket: string) {
        return {
          async list(prefix: string, options: { limit: number; offset: number }) {
            lists.push({ bucket, prefix, options });
            const error = world.listError[bucket];
            if (error) return { data: null, error };
            const names = [...(world.buckets[bucket] ?? [])]
              .filter((path) => path.startsWith(`${prefix}/`))
              .map((path) => path.slice(prefix.length + 1))
              .filter((name) => !name.includes("/"))
              .sort();
            const page = names.slice(options.offset, options.offset + Math.min(options.limit, world.pageCap));
            return { data: page.map((name) => ({ name, id: `id-${name}` })), error: null };
          },
          async remove(paths: string[]) {
            steps.push(`remove:${bucket}`);
            const error = world.removeError[bucket];
            if (error) return { data: null, error };
            const removed = paths.filter((path) => world.buckets[bucket]?.delete(path));
            return { data: removed.map((name) => ({ name })), error: null };
          },
        };
      },
    },
    from(table: string) {
      if (table !== "user_profiles") {
        throw new Error(`deleteAccount asked for the table "${table}"`);
      }
      const chain: Record<string, unknown> = {};
      for (const method of ["select", "insert", "upsert", "update", "delete", "eq"]) {
        chain[method] = (...args: unknown[]) => {
          profileCalls.push({ method, args });
          return chain;
        };
      }
      chain.maybeSingle = async () => {
        profileCalls.push({ method: "maybeSingle", args: [] });
        if (world.readError) return { data: null, error: world.readError };
        return { data: world.profile ? { email: world.profile.email } : null, error: null };
      };
      return chain;
    },
  };
}

const createClient = vi.fn(async () => fakeClient());
vi.mock("@/lib/supabase/server", () => ({
  createClient: () => createClient(),
}));

const { deleteAccount } = await import("./account");

/** Every path left in a bucket. */
function left(bucket: string): string[] {
  return [...world.buckets[bucket]].sort();
}

/** Every console method, quiet, so a test can read what was logged. */
let consoleSpies: ReturnType<typeof vi.spyOn>[] = [];

beforeEach(() => {
  vi.clearAllMocks();
  steps = [];
  lists = [];
  profileCalls = [];
  world = createWorld();
  getUserId.mockResolvedValue(CALLER);
  sendAccountDeletedEmail.mockImplementation(async (to: string) => {
    steps.push(`email:${to}`);
    return { data: { id: "e1" }, error: null };
  });
  deleteSignInAccount.mockImplementation(async (id: string) => {
    steps.push(`signIn:${id}`);
  });
  consoleSpies = (["log", "info", "warn", "error", "debug"] as const).map((method) =>
    vi.spyOn(console, method).mockImplementation(() => {})
  );
});

afterEach(() => {
  try {
    // Deleting an account never makes a profile on the way.
    expect(ensureProfile).not.toHaveBeenCalled();
    expect(requireAuthWithProfile).not.toHaveBeenCalled();
  } finally {
    vi.restoreAllMocks();
  }
});

describe("deleteAccount", () => {
  it("removes the caller's pictures in both buckets, then the account, then emails, then deletes the sign-in account, then runs the database step once more", async () => {
    world = createWorld({
      buckets: {
        "wishlist-images": new Set([
          "user_2abcDEF/1-a.jpg",
          "user_2abcDEF/2-b.png",
          "user_2momABC/9-z.jpg",
        ]),
        "gift-photos": new Set(["user_2abcDEF/3-c.jpg"]),
      },
    });

    const result = await deleteAccount();

    expect(result).toEqual({ success: true });
    expect(steps).toEqual([
      "remove:wishlist-images",
      "remove:gift-photos",
      "rpc:delete_account",
      "email:sam@example.com",
      "signIn:user_2abcDEF",
      "rpc:delete_account",
    ]);
    expect(left("wishlist-images")).toEqual(["user_2momABC/9-z.jpg"]);
    expect(left("gift-photos")).toEqual([]);
    expect(lists.length).toBeGreaterThan(0);
    expect(lists.every((l) => l.prefix === CALLER)).toBe(true);
    expect(rpc.mock.calls).toEqual([["delete_account"], ["delete_account"]]);
    // Both calls are made with the one client.
    expect(createClient).toHaveBeenCalledTimes(1);
    expect(deleteSignInAccount).toHaveBeenCalledWith(CALLER);
  });

  it("removes a profile made for the person while the deletion ran", async () => {
    deleteSignInAccount.mockImplementationOnce(async (id: string) => {
      // The first database step emptied the profile; a request from another
      // tab makes one again before the sign-in account is gone.
      expect(world.profile).toBeNull();
      world.profile = { email: ADDRESS };
      steps.push(`signIn:${id}`);
    });

    expect(await deleteAccount()).toEqual({ success: true });

    expect(world.profile).toBeNull();
    expect(steps.slice(-2)).toEqual(["signIn:user_2abcDEF", "rpc:delete_account"]);
    // The last step reads no address and sends no second email.
    expect(sendAccountDeletedEmail).toHaveBeenCalledTimes(1);
    expect(profileCalls.filter((c) => c.method === "maybeSingle")).toHaveLength(1);
  });

  it("answers success when the last database step fails, logging its code alone", async () => {
    world = createWorld({
      rpcErrors: [
        null,
        { code: "XX000", message: `could not delete the profile of ${ADDRESS}` },
      ],
    });

    expect(await deleteAccount()).toEqual({ success: true });

    expect(rpc).toHaveBeenCalledTimes(2);
    expect(deleteSignInAccount).toHaveBeenCalledTimes(1);
    expect(vi.mocked(console.error).mock.calls).toEqual([
      ["deleteAccount: the last delete_account failed (XX000)"],
    ]);
    for (const spy of consoleSpies) {
      for (const call of spy.mock.calls) {
        expect(inspect(call, { depth: 10 })).not.toContain(ADDRESS);
      }
    }
  });

  it("runs the database step once only when the sign-in account cannot be deleted", async () => {
    deleteSignInAccount.mockImplementationOnce(async (id: string) => {
      steps.push(`signIn:${id}`);
      throw new Error("sign-in provider unavailable");
    });

    expect(await deleteAccount()).toEqual({ error: DELETE_FAILED });

    expect(rpc).toHaveBeenCalledTimes(1);
    expect(steps).toEqual(["rpc:delete_account", "email:sam@example.com", "signIn:user_2abcDEF"]);
  });

  it("removes more than one page of pictures", async () => {
    const many = Array.from(
      { length: 1001 },
      (_, i) => `user_2abcDEF/${String(i).padStart(4, "0")}-x.jpg`
    );
    world = createWorld({
      buckets: { "wishlist-images": new Set(many), "gift-photos": new Set() },
    });

    const result = await deleteAccount();

    expect(result).toEqual({ success: true });
    expect(left("wishlist-images")).toEqual([]);
    // Listing stops at the first empty page.
    expect(
      lists.filter((l) => l.bucket === "wishlist-images").map((l) => l.options)
    ).toEqual([
      { limit: 1000, offset: 0 },
      { limit: 1000, offset: 1000 },
      { limit: 1000, offset: 1001 },
    ]);
  });

  it("removes every picture when the storage service answers fewer names than asked", async () => {
    const many = Array.from(
      { length: 250 },
      (_, i) => `user_2abcDEF/${String(i).padStart(3, "0")}-x.jpg`
    );
    world = createWorld({
      buckets: { "wishlist-images": new Set(many), "gift-photos": new Set(["user_2abcDEF/3-c.jpg"]) },
      pageCap: 100,
    });

    const result = await deleteAccount();

    expect(result).toEqual({ success: true });
    expect(left("wishlist-images")).toEqual([]);
    expect(left("gift-photos")).toEqual([]);
    // Each page starts after the names already received, and every page is
    // read before the one remove of all 250.
    expect(
      lists.filter((l) => l.bucket === "wishlist-images").map((l) => l.options.offset)
    ).toEqual([0, 100, 200, 250]);
    expect(steps.filter((s) => s === "remove:wishlist-images")).toHaveLength(1);
  });

  it("emails the address read before the database deleted the account", async () => {
    const result = await deleteAccount();

    expect(result).toEqual({ success: true });
    // The rpc fake emptied the profile, so the address came from the read before it.
    expect(world.profile).toBeNull();
    expect(sendAccountDeletedEmail).toHaveBeenCalledTimes(1);
    expect(sendAccountDeletedEmail).toHaveBeenCalledWith(ADDRESS);
    expect(profileCalls).toEqual([
      { method: "select", args: ["email"] },
      { method: "eq", args: ["id", CALLER] },
      { method: "maybeSingle", args: [] },
    ]);
    expect(steps.indexOf("rpc:delete_account")).toBeLessThan(steps.indexOf(`email:${ADDRESS}`));
  });

  it("still succeeds when the email is refused or throws, and logs each by its name and status or code alone", async () => {
    // Both quote the address, as the email service's words can.
    sendAccountDeletedEmail.mockResolvedValueOnce({
      data: null,
      error: {
        name: "validation_error",
        statusCode: 403,
        message: `You can only send testing emails to your own address, not ${ADDRESS}.`,
      },
    });

    expect(await deleteAccount()).toEqual({ success: true });

    world = createWorld();
    sendAccountDeletedEmail.mockRejectedValueOnce(
      Object.assign(new TypeError(`fetch failed sending to ${ADDRESS}`), { code: "ECONNRESET" })
    );

    expect(await deleteAccount()).toEqual({ success: true });

    expect(deleteSignInAccount).toHaveBeenCalledTimes(2);
    expect(vi.mocked(console.error).mock.calls).toEqual([
      ["deleteAccount: the email was refused (validation_error, 403)"],
      ["deleteAccount: the email failed (TypeError, ECONNRESET)"],
    ]);
    for (const spy of consoleSpies) {
      for (const call of spy.mock.calls) {
        expect(inspect(call, { depth: 10 })).not.toContain(ADDRESS);
      }
    }
  });

  it("finishes a try that failed half way, answering success and making no profile", async () => {
    world = createWorld({
      buckets: {
        "wishlist-images": new Set(["user_2abcDEF/1-a.jpg"]),
        "gift-photos": new Set(["user_2abcDEF/3-c.jpg"]),
      },
    });
    deleteSignInAccount.mockImplementationOnce(async (id: string) => {
      steps.push(`signIn:${id}`);
      throw new Error("sign-in provider unavailable");
    });

    expect(await deleteAccount()).toEqual({ error: DELETE_FAILED });

    // The second try: no pictures left, no profile, and the database has nothing to do.
    steps = [];
    expect(await deleteAccount()).toEqual({ success: true });

    expect(steps).toEqual(["rpc:delete_account", "signIn:user_2abcDEF", "rpc:delete_account"]);
    expect(sendAccountDeletedEmail).toHaveBeenCalledTimes(1);
    expect(deleteSignInAccount).toHaveBeenCalledTimes(2);
    expect(profileCalls.some((c) => c.method === "insert" || c.method === "upsert")).toBe(false);
  });

  it("stops at a picture it cannot remove", async () => {
    world = createWorld({
      buckets: {
        "wishlist-images": new Set(["user_2abcDEF/1-a.jpg"]),
        "gift-photos": new Set(["user_2abcDEF/3-c.jpg"]),
      },
      removeError: { "wishlist-images": { message: "permission denied" } },
    });

    expect(await deleteAccount()).toEqual({ error: DELETE_FAILED });

    expect(rpc).not.toHaveBeenCalled();
    expect(sendAccountDeletedEmail).not.toHaveBeenCalled();
    expect(deleteSignInAccount).not.toHaveBeenCalled();
    expect(inspect(vi.mocked(console.error).mock.calls)).toContain("wishlist-images");
  });

  it("stops at a folder it cannot list", async () => {
    world = createWorld({
      buckets: {
        "wishlist-images": new Set(),
        "gift-photos": new Set(["user_2abcDEF/3-c.jpg"]),
      },
      listError: { "gift-photos": { message: "timeout" } },
    });

    expect(await deleteAccount()).toEqual({ error: DELETE_FAILED });

    expect(left("gift-photos")).toEqual(["user_2abcDEF/3-c.jpg"]);
    expect(rpc).not.toHaveBeenCalled();
    expect(deleteSignInAccount).not.toHaveBeenCalled();
    expect(inspect(vi.mocked(console.error).mock.calls)).toContain("gift-photos");
  });

  it("stops when the address cannot be read", async () => {
    world = createWorld({ readError: { code: "57014", message: "statement timeout" } });

    expect(await deleteAccount()).toEqual({ error: DELETE_FAILED });

    expect(rpc).not.toHaveBeenCalled();
    expect(sendAccountDeletedEmail).not.toHaveBeenCalled();
    expect(deleteSignInAccount).not.toHaveBeenCalled();
  });

  it("stops when the database refuses, keeping the sign-in account", async () => {
    world = createWorld({ rpcError: { code: "XX000", message: "boom" } });

    expect(await deleteAccount()).toEqual({ error: DELETE_FAILED });

    expect(sendAccountDeletedEmail).not.toHaveBeenCalled();
    expect(deleteSignInAccount).not.toHaveBeenCalled();
    expect(inspect(vi.mocked(console.error).mock.calls)).toContain("XX000");
  });

  it("answers Not authenticated when signed out, touching nothing", async () => {
    getUserId.mockResolvedValue(null);

    expect(await deleteAccount()).toEqual({ error: "Not authenticated" });

    expect(createClient).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalled();
    expect(sendAccountDeletedEmail).not.toHaveBeenCalled();
    expect(deleteSignInAccount).not.toHaveBeenCalled();
    expect(steps).toEqual([]);
  });
});
