import { lookup as dnsLookup } from "node:dns";
import { isIP } from "node:net";
// `fetch` comes from undici rather than from `globalThis`. That is not a style
// preference, it is load-bearing: see the note on `agent` below.
import { Agent, fetch as undiciFetch, type Response } from "undici";
import { isBlockedAddress, parseSafeUrl } from "./url-safety";

const TIMEOUT_MS = 5_000;
const MAX_REDIRECTS = 3;

/** Marker carried on the error the DNS guard raises, so the reason survives. */
const BLOCKED_ADDRESS = "BLOCKED_ADDRESS";

const REASON_REFUSED = "That link points somewhere we will not fetch from.";
const REASON_UNREACHABLE = "We could not reach that page.";
const REASON_UNREADABLE = "We could not read that page.";
const REASON_TOO_LARGE = "That page is too large to read.";
const REASON_TOO_MANY_HOPS = "That link redirects too many times.";

type SafeFetchResult =
  | { ok: true; body: Buffer; contentType: string }
  | { ok: false; reason: string };

function blockedError(): NodeJS.ErrnoException {
  return Object.assign(new Error(BLOCKED_ADDRESS), { code: BLOCKED_ADDRESS });
}

/**
 * IPv6 literals arrive from `new URL()` wrapped in brackets. `isIP` does not
 * accept that form, so strip them before asking.
 */
function unwrapHost(hostname: string): string {
  return hostname.startsWith("[") && hostname.endsWith("]")
    ? hostname.slice(1, -1)
    : hostname;
}

/**
 * A DNS lookup that refuses blocked addresses and hands back only addresses it
 * validated.
 *
 * This is half the SSRF defence (see `literalHostIsBlocked` for the other
 * half), and it works because the address that gets checked is the address that
 * gets connected to. Validating the hostname instead would be bypassed by DNS;
 * validating a resolved address and then letting the stack resolve again would
 * be bypassed by DNS rebinding.
 *
 * Every path out of here that is not "here is a list of addresses I checked and
 * approved" is an error. An empty answer, a non-array answer, an entry without
 * a usable `address` — none of those are permission to connect.
 */
const guardedLookup: typeof dnsLookup = ((
  hostname: string,
  options: unknown,
  callback: unknown
) => {
  const cb = (typeof options === "function" ? options : callback) as (
    err: NodeJS.ErrnoException | null,
    address?: unknown,
    family?: number
  ) => void;
  const opts = (typeof options === "function" ? {} : (options ?? {})) as {
    all?: boolean;
  };

  // Always resolve with `all: true` so every address the name carries is seen.
  // Asking for one address and checking it would leave the others unexamined
  // while the stack stayed free to use them.
  dnsLookup(hostname, { ...opts, all: true }, (err, addresses) => {
    if (err) return cb(err);
    if (!Array.isArray(addresses) || addresses.length === 0) {
      // No answer is not a safe answer.
      return cb(blockedError());
    }

    const safe = addresses.filter(
      (a) =>
        a != null &&
        typeof a.address === "string" &&
        a.address.length > 0 &&
        !isBlockedAddress(a.address)
    );
    if (safe.length === 0) return cb(blockedError());

    if (opts.all === true) return cb(null, safe);
    return cb(null, safe[0].address, safe[0].family);
  });
}) as unknown as typeof dnsLookup;

/**
 * The connection is pinned to the addresses `guardedLookup` approved.
 *
 * **Why this dispatcher is used with undici's own `fetch` and not the global
 * one.** Node's `globalThis.fetch` is a *copy* of undici baked into the runtime
 * (`process.versions.undici`, 7.12.0 on the machine this was written), which is
 * a different build from the `undici` in `node_modules`. Crossing the two makes
 * the guard depend on two independently-versioned halves of a private protocol
 * agreeing. They do not reliably agree: with undici 8 installed, the global
 * `fetch` + `{ dispatcher }` combination dies with `UND_ERR_INVALID_ARG:
 * invalid onRequestStart method` — the hook is never called and no request goes
 * out. With undici 6 pinned it happens to work. "Happens to work, on this pair
 * of versions" is not a footing for the only thing standing between a user's
 * pasted URL and the cloud metadata endpoint. Calling undici's own `fetch`
 * keeps the fetch implementation and the dispatcher inside one copy of one
 * library, so the `lookup` hook is reached by construction rather than by luck.
 *
 * **Why undici 6 and not the current 8.** undici 8 declares
 * `engines.node >= 22.19.0` and undici 7 declares `>= 20.18.1`; this package
 * declares `>= 20.9.0`. 6.28.0 (`>= 18.17`) is the newest line that does not
 * quietly raise the floor for everyone. Upgrading means raising `engines` here
 * first, and re-running the verification — an undici major bump has already
 * been observed to change whether the dispatcher is honoured at all.
 */
const agent = new Agent({
  connect: { lookup: guardedLookup, timeout: TIMEOUT_MS },
  headersTimeout: TIMEOUT_MS,
  bodyTimeout: TIMEOUT_MS,
});

/**
 * The other half of the defence: a hostname that is already a literal IP.
 *
 * `net.connect` skips DNS entirely when the host is an IP literal — the
 * `lookup` hook is never invoked, which was measured, not assumed. Relying on
 * the hook alone would let `http://169.254.169.254/` connect straight through
 * without a single validation call. So literals are checked here instead, and
 * the address checked is again exactly the address the socket will use.
 *
 * Returns `null` when the host is not a literal, meaning "not my job" rather
 * than "fine" — the caller must still let DNS and the hook have their say.
 */
function literalHostIsBlocked(hostname: string): boolean | null {
  const host = unwrapHost(hostname);
  if (isIP(host) === 0) return null;
  return isBlockedAddress(host);
}

/** True if this error, or anything it wraps, is the DNS guard's refusal. */
function isBlockedError(err: unknown, depth = 0): boolean {
  if (err == null || typeof err !== "object" || depth > 6) return false;
  const e = err as { code?: unknown; cause?: unknown; errors?: unknown };
  if (e.code === BLOCKED_ADDRESS) return true;
  if (
    Array.isArray(e.errors) &&
    e.errors.some((inner) => isBlockedError(inner, depth + 1))
  ) {
    return true;
  }
  return isBlockedError(e.cause, depth + 1);
}

/** Release a response body we are not going to read, so the socket is freed. */
function discard(res: Response): void {
  void res.body?.cancel().catch(() => {});
}

/**
 * Fetch a user-supplied URL with the guarantees this module exists to provide:
 * validation at the resolved address, re-validation on every redirect, no
 * credentials or cookies, and a body cap applied while streaming.
 *
 * Every failure is a refusal with a reason. There is no path that returns
 * `ok: true` without a body this function read and counted itself.
 */
export async function safeFetch(
  raw: string,
  opts: { maxBytes: number; accept: string }
): Promise<SafeFetchResult> {
  // A missing or nonsensical cap is not permission to read without one.
  if (typeof opts?.maxBytes !== "number" || !Number.isFinite(opts.maxBytes) || opts.maxBytes <= 0) {
    return { ok: false, reason: REASON_UNREADABLE };
  }
  const accept =
    typeof opts.accept === "string" && opts.accept.length > 0
      ? opts.accept
      : "*/*";

  let current = raw;

  // Redirects are followed by hand so every hop is re-validated. A public URL
  // that 302s to the metadata endpoint is the standard bypass.
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const parsed = parseSafeUrl(current);
    if (!parsed.ok) return { ok: false, reason: parsed.reason };

    // An empty host is not a host, and `dns.lookup("")` answers with loopback
    // on most systems. No http/https URL reaches here with one today — the
    // WHATWG parser rejects `http://` outright and reads `http:///foo` as the
    // host `foo` — so this is a standing guard against that changing, not a
    // live case.
    if (!parsed.url.hostname) {
      return { ok: false, reason: REASON_REFUSED };
    }

    if (literalHostIsBlocked(parsed.url.hostname) === true) {
      return { ok: false, reason: REASON_REFUSED };
    }

    let res: Response;
    try {
      res = await undiciFetch(parsed.url, {
        method: "GET",
        redirect: "manual",
        signal: AbortSignal.timeout(TIMEOUT_MS),
        // No ambient credentials, no cookie jar, no referrer leak.
        credentials: "omit",
        referrerPolicy: "no-referrer",
        // Built fresh from `opts` on every hop, so nothing a caller set on the
        // first request can ride along to a redirect target.
        headers: { accept, "user-agent": "rybn-link-preview" },
        dispatcher: agent,
      });
    } catch (e) {
      if (isBlockedError(e)) return { ok: false, reason: REASON_REFUSED };
      return { ok: false, reason: REASON_UNREACHABLE };
    }

    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get("location");
      discard(res);
      // A redirect with nowhere to go is a dead end, not a page.
      if (!location) return { ok: false, reason: REASON_UNREACHABLE };
      let next: URL;
      try {
        next = new URL(location, parsed.url);
      } catch {
        return { ok: false, reason: REASON_UNREACHABLE };
      }
      current = next.toString();
      continue;
    }

    if (!res.ok) {
      discard(res);
      return { ok: false, reason: REASON_UNREADABLE };
    }

    // Reported as found. An absent `content-type` yields "", which the caller
    // must treat as "unknown" — this function does not invent one.
    const contentType = (res.headers.get("content-type") ?? "")
      .split(";")[0]
      .trim()
      .toLowerCase();

    // Cap while streaming. A declared content-length is not trusted and a
    // missing one is not a licence to read forever.
    const reader = res.body?.getReader();
    if (!reader) return { ok: false, reason: REASON_UNREADABLE };

    const chunks: Uint8Array[] = [];
    let total = 0;
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        if (!value) continue;
        total += value.byteLength;
        if (total > opts.maxBytes) {
          await reader.cancel().catch(() => {});
          return { ok: false, reason: REASON_TOO_LARGE };
        }
        chunks.push(value);
      }
    } catch {
      // A stream that dies part-way has not produced a page.
      await reader.cancel().catch(() => {});
      return { ok: false, reason: REASON_UNREADABLE };
    }

    return { ok: true, body: Buffer.concat(chunks), contentType };
  }

  return { ok: false, reason: REASON_TOO_MANY_HOPS };
}
