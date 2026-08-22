import { afterAll, beforeAll, describe, expect, it } from "vitest";
import http from "node:http";
import net from "node:net";
import zlib from "node:zlib";
import { Agent, fetch as undiciFetch } from "undici";
import { safeFetch, __testing, type SafeFetchOptions } from "./safe-fetch";

/**
 * Everything here is hermetic: no DNS query leaves the machine and no
 * connection leaves the loopback interface. `localhost` resolves from
 * `/etc/hosts` and `dns.lookup` on an IP literal answers without a query, which
 * is what makes the resolved-address guard testable offline.
 *
 * Two entry points are used deliberately.
 *
 *   * `safeFetch` — the real thing, wired to the real guarded dispatcher. Used
 *     for everything that must prove the guard itself.
 *   * `__testing.fetchChain` — the same hop-and-cap loop with a caller-supplied
 *     TRANSPORT. Used for redirect and body-cap mechanics, because every
 *     address a test can bind to locally is one the guard (correctly) refuses,
 *     so there is no way to reach a real server through the real dispatcher.
 *     The loop's own checks are not on that seam: scheme, credentials, literal
 *     addresses, hop count and the byte cap all still run, which is why the
 *     redirect-to-a-blocked-address cases below are meaningful.
 */

const REFUSED = "That link points somewhere we will not fetch from.";
const UNREACHABLE = "We could not reach that page.";
const UNREADABLE = "We could not read that page.";
const TOO_LARGE = "That page is too large to read.";
const TOO_MANY_HOPS = "That link redirects too many times.";

const OPTS: SafeFetchOptions = { maxBytes: 100_000, acceptHeader: "text/html" };

// ---------------------------------------------------------------------------
// Pre-socket refusals, through the real safeFetch.
// ---------------------------------------------------------------------------

describe("safeFetch refuses literal-IP hosts without connecting", () => {
  /**
   * `net.connect` skips DNS entirely when the host is already an IP literal, so
   * the `lookup` hook is never called for any of these. A guard built only on
   * that hook would connect straight to every address below. This is the
   * regression test for that gap.
   */
  const blocked: Array<[string, string]> = [
    ["cloud metadata endpoint", "http://169.254.169.254/latest/meta-data/"],
    ["IPv4 loopback", "http://127.0.0.1/"],
    ["IPv6 loopback", "http://[::1]/"],
    ["decimal IPv4 spelling of loopback", "http://2130706433/"],
    ["hex IPv4 spelling of loopback", "http://0x7f000001/"],
    ["IPv4-mapped IPv6 metadata address", "http://[::ffff:169.254.169.254]/"],
    ["IPv4-compatible IPv6 metadata address", "http://[::169.254.169.254]/"],
    ["6to4 IPv6 wrapping the metadata address", "http://[2002:a9fe:a9fe::]/"],
    ["RFC1918 private range", "http://10.0.0.1/"],
    ["RFC1918 private range, https", "https://192.168.1.1/"],
    ["carrier-grade NAT range", "http://100.64.0.1/"],
    ["IPv6 unique local", "http://[fd00::1]/"],
    ["IPv6 link local", "http://[fe80::1]/"],
    ["unspecified address", "http://0.0.0.0/"],
  ];

  for (const [label, url] of blocked) {
    it(`refuses ${label}`, async () => {
      await expect(safeFetch(url, OPTS)).resolves.toEqual({
        ok: false,
        reason: REFUSED,
      });
    });
  }
});

describe("safeFetch refuses malformed input before connecting", () => {
  // Asserting the exact reason, not merely ok===false. A test that accepts any
  // refusal cannot tell "the guard fired" from "something else went wrong",
  // which is how a blocked-port failure once masqueraded as a guard hit.
  it("refuses a non-http scheme with the scheme reason", async () => {
    await expect(safeFetch("ftp://example.com/", OPTS)).resolves.toEqual({
      ok: false,
      reason: "Only http and https links can be read.",
    });
  });

  it("refuses a URL carrying credentials with the credentials reason", async () => {
    await expect(safeFetch("http://user:pass@example.com/", OPTS)).resolves.toEqual({
      ok: false,
      reason: "That link cannot contain a username or password.",
    });
  });

  it("refuses something that is not a URL with the parse reason", async () => {
    await expect(safeFetch("not a url", OPTS)).resolves.toEqual({
      ok: false,
      reason: "That does not look like a web address.",
    });
  });
});

describe("safeFetch treats a missing size cap as a refusal, not as no cap", () => {
  for (const maxBytes of [0, -1, NaN, Infinity, undefined as unknown as number]) {
    it(`refuses maxBytes=${String(maxBytes)}`, async () => {
      await expect(
        safeFetch("https://example.com/", { maxBytes, acceptHeader: "text/html" })
      ).resolves.toEqual({ ok: false, reason: UNREADABLE });
    });
  }
});

// ---------------------------------------------------------------------------
// The DNS hook, through the real safeFetch and the real guarded dispatcher.
// `localhost` is a hostname, not a literal, so ONLY the resolved-address hook
// can refuse it -- and it resolves from /etc/hosts, so this needs no network.
// ---------------------------------------------------------------------------

describe("the DNS hook refuses a name that resolves to a blocked address", () => {
  let server: http.Server;
  let port = 0;
  let connections = 0;

  beforeAll(async () => {
    server = http.createServer((_req, res) => {
      res.writeHead(200, { "content-type": "text/html" });
      res.end("REACHED-THE-LOOPBACK-SERVER");
    });
    server.on("connection", () => {
      connections++;
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    port = (server.address() as net.AddressInfo).port;
  });

  afterAll(() => new Promise<void>((r) => server.close(() => r())));

  it("CONTROL: an unguarded dispatcher reaches localhost happily", async () => {
    // Without this, a refusal below would prove nothing -- it could just mean
    // the host was unreachable.
    const plain = new Agent();
    try {
      const res = await undiciFetch(`http://localhost:${port}/`, {
        dispatcher: plain,
        signal: AbortSignal.timeout(5000),
      });
      expect(res.status).toBe(200);
      await expect(res.text()).resolves.toBe("REACHED-THE-LOOPBACK-SERVER");
    } finally {
      await plain.close();
    }
  });

  it("SUBJECT: safeFetch refuses that exact reachable URL", async () => {
    await expect(safeFetch(`http://localhost:${port}/`, OPTS)).resolves.toEqual({
      ok: false,
      reason: REFUSED,
    });
  });

  it("opens no socket at all when the resolved address is blocked", async () => {
    const before = connections;
    await safeFetch(`http://localhost:${port}/`, OPTS);
    // The connection is gated on the validated address: a blocked resolution
    // means the socket is never dialled, so there is no window in which an
    // unvalidated address could be connected to.
    expect(connections - before).toBe(0);
  });
});

describe("guardedLookup hands back the address it validated", () => {
  const lookup = __testing.guardedLookup;

  it("refuses a name whose every address is blocked", async () => {
    const err = await new Promise<NodeJS.ErrnoException | null>((resolve) => {
      lookup("localhost", { all: true }, (e) => resolve(e));
    });
    expect(err).toBeTruthy();
    expect(err?.code).toBe("BLOCKED_ADDRESS");
  });

  it("refuses a blocked literal", async () => {
    const err = await new Promise<NodeJS.ErrnoException | null>((resolve) => {
      lookup("127.0.0.1", { all: true }, (e) => resolve(e));
    });
    expect(err?.code).toBe("BLOCKED_ADDRESS");
  });

  it("returns exactly the validated address, so there is nothing left to re-resolve", async () => {
    // This is the anti-rebinding property: the hook does not answer "this name
    // is fine, go look it up again" -- it answers with the vetted addresses
    // themselves, and those are what the socket is opened to.
    const out = await new Promise<{ err: unknown; addresses: unknown }>((resolve) => {
      lookup("93.184.216.34", { all: true }, (err, addresses) =>
        resolve({ err, addresses })
      );
    });
    expect(out.err).toBeNull();
    expect(out.addresses).toEqual([{ address: "93.184.216.34", family: 4 }]);
  });

  it("returns a single validated address when not asked for all", async () => {
    const out = await new Promise<{ err: unknown; address: unknown; family: unknown }>(
      (resolve) => {
        lookup("93.184.216.34", {}, (err, address, family) =>
          resolve({ err, address, family })
        );
      }
    );
    expect(out.err).toBeNull();
    expect(out.address).toBe("93.184.216.34");
    expect(out.family).toBe(4);
  });
});

// ---------------------------------------------------------------------------
// Redirect and body-cap mechanics, driven against a real loopback server.
// ---------------------------------------------------------------------------

describe("the hop-and-cap loop", () => {
  let server: http.Server;
  let port = 0;
  let pinned: Agent;
  let lastHeaders: http.IncomingHttpHeaders = {};
  let gzipBomb: Buffer;

  // The request URLs use a hostname that is not an IP literal, so the loop's
  // literal-address check passes and the request is actually dispatched. The
  // dispatcher then ignores the host entirely and dials the loopback server.
  const BASE = "http://probe.test";

  beforeAll(async () => {
    // ~16MB of zeros, which gzips to roughly 16KB. The sizes matter: the wire
    // bytes must sit UNDER the cap while the inflated bytes sit far above it,
    // or the test proves nothing. An earlier 64MB version compressed to 65KB --
    // over the 50KB cap -- and so passed without any decompression happening at
    // all. The assertion in the test itself now pins that relationship.
    gzipBomb = zlib.gzipSync(Buffer.alloc(16 * 1024 * 1024, 0));

    server = http.createServer((req, res) => {
      lastHeaders = req.headers;
      const path = new URL(req.url ?? "/", "http://x").pathname;
      switch (path) {
        case "/ok":
          res.writeHead(200, { "content-type": "text/html; charset=UTF-8" });
          return res.end("<html><title>hi</title></html>");
        case "/no-ct":
          res.writeHead(200);
          return res.end("body with no declared type");
        case "/to-literal":
          res.writeHead(302, { location: `http://127.0.0.1:${port}/ok` });
          return res.end();
        case "/to-metadata":
          res.writeHead(302, { location: "http://169.254.169.254/latest/meta-data/" });
          return res.end();
        case "/to-protocol-relative":
          res.writeHead(302, { location: "//127.0.0.1/" });
          return res.end();
        case "/hop1":
          res.writeHead(302, { location: `${BASE}/hop2` });
          return res.end();
        case "/hop2":
          res.writeHead(302, { location: `${BASE}/to-literal` });
          return res.end();
        case "/to-relative":
          res.writeHead(302, { location: "/ok" });
          return res.end();
        case "/no-location":
          res.writeHead(302);
          return res.end();
        case "/loop":
          res.writeHead(302, { location: `${BASE}/loop` });
          return res.end();
        case "/chunked-big":
          // No content-length at all. The streaming cap is the only limit.
          res.writeHead(200, { "content-type": "text/html" });
          for (let i = 0; i < 200; i++) res.write("x".repeat(1024));
          return res.end();
        case "/honest-big": {
          const n = 200 * 1024;
          res.writeHead(200, {
            "content-type": "text/html",
            "content-length": String(n),
          });
          for (let i = 0; i < 200; i++) res.write("z".repeat(1024));
          return res.end();
        }
        case "/lying-length":
          res.writeHead(200, {
            "content-type": "text/html",
            "content-length": "10",
          });
          for (let i = 0; i < 200; i++) res.write("y".repeat(1024));
          return res.end();
        case "/gzip-bomb":
          res.writeHead(200, {
            "content-type": "text/html",
            "content-encoding": "gzip",
            "content-length": String(gzipBomb.length),
          });
          return res.end(gzipBomb);
        case "/gzip-bomb-undeclared":
          // The exact same bytes, not declared as gzip. The control for the
          // test below: identical wire traffic, no decoding, comfortably under
          // the cap.
          res.writeHead(200, {
            "content-type": "application/octet-stream",
            "content-length": String(gzipBomb.length),
          });
          return res.end(gzipBomb);
        case "/slow-hop-1":
          return setTimeout(() => {
            res.writeHead(302, { location: `${BASE}/slow-hop-2` });
            res.end();
          }, 3000);
        case "/slow-hop-2":
          return setTimeout(() => {
            res.writeHead(200, { "content-type": "text/html" });
            res.end("too late");
          }, 3000);
        case "/notfound":
          res.writeHead(404);
          return res.end("nope");
        default:
          res.writeHead(200, { "content-type": "text/plain" });
          return res.end("default");
      }
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    port = (server.address() as net.AddressInfo).port;

    pinned = new Agent({
      // Transport only. Dials the loopback server whatever the host says.
      connect: ((_opts: unknown, cb: (e: Error | null, s?: net.Socket) => void) => {
        const socket = net.connect(port, "127.0.0.1");
        socket.setNoDelay(true);
        socket.once("connect", () => cb(null, socket));
        socket.once("error", (err) => cb(err));
      }) as never,
    });
  });

  afterAll(async () => {
    await pinned.close();
    await new Promise<void>((r) => server.close(() => r()));
  });

  const run = (path: string, opts: SafeFetchOptions = OPTS) =>
    __testing.fetchChain(`${BASE}${path}`, opts, pinned);

  it("reads a normal page", async () => {
    const r = await run("/ok");
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.body.toString()).toContain("<title>hi</title>");
      expect(r.contentType).toBe("text/html");
    }
  });

  it("follows an ordinary relative redirect", async () => {
    const r = await run("/to-relative");
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.body.toString()).toContain("<title>hi</title>");
  });

  describe("re-validates every hop", () => {
    it("refuses a redirect whose target is a blocked literal", async () => {
      await expect(run("/to-literal")).resolves.toEqual({ ok: false, reason: REFUSED });
    });

    it("refuses a redirect to the cloud metadata endpoint", async () => {
      await expect(run("/to-metadata")).resolves.toEqual({ ok: false, reason: REFUSED });
    });

    it("refuses a protocol-relative //127.0.0.1/ Location", async () => {
      // Resolved against the current hop's scheme, so it must not slip past the
      // address check by not looking like an absolute URL.
      await expect(run("/to-protocol-relative")).resolves.toEqual({
        ok: false,
        reason: REFUSED,
      });
    });

    it("refuses a multi-hop chain whose FINAL hop is blocked", async () => {
      // Two clean hops first, so this fails only if re-validation happens on
      // every hop rather than on the first.
      await expect(run("/hop1")).resolves.toEqual({ ok: false, reason: REFUSED });
    });

    it("refuses a redirect with no Location header", async () => {
      await expect(run("/no-location")).resolves.toEqual({
        ok: false,
        reason: UNREACHABLE,
      });
    });

    it("refuses an endless redirect loop", async () => {
      await expect(run("/loop")).resolves.toEqual({
        ok: false,
        reason: TOO_MANY_HOPS,
      });
    });
  });

  describe("caps the body while streaming", () => {
    const CAP: SafeFetchOptions = { maxBytes: 50_000, acceptHeader: "text/html" };

    it("caps a chunked body that declares no content-length", async () => {
      await expect(run("/chunked-big", CAP)).resolves.toEqual({
        ok: false,
        reason: TOO_LARGE,
      });
    });

    it("caps an oversized body that declares an honest content-length", async () => {
      await expect(run("/honest-big", CAP)).resolves.toEqual({
        ok: false,
        reason: TOO_LARGE,
      });
    });

    it("never buffers past the declared framing when content-length lies", async () => {
      // Declares 10 bytes and sends 200KB. We return what we counted, never
      // what the peer tried to push.
      const r = await run("/lying-length", CAP);
      expect(r.ok).toBe(true);
      if (r.ok) expect(r.body.length).toBe(10);
    });

    it("CONTROL: the bomb's wire bytes are themselves under the cap", async () => {
      // Without this the next test is vacuous -- it would pass on a build that
      // never decompresses anything, simply because the compressed payload was
      // already too big. Serving the identical bytes undeclared must succeed.
      expect(gzipBomb.length).toBeLessThan(CAP.maxBytes);
      const r = await run("/gzip-bomb-undeclared", CAP);
      expect(r.ok).toBe(true);
      if (r.ok) expect(r.body.length).toBe(gzipBomb.length);
    });

    it("counts DECOMPRESSED bytes, so a gzip bomb is refused", async () => {
      // Same bytes as the control above, differing only in `content-encoding`.
      // 16MB inflated behind ~16KB on the wire. A cap applied to wire bytes
      // would accept this; a cap applied after buffering would inflate all
      // 16MB first.
      const started = Date.now();
      const r = await run("/gzip-bomb", CAP);
      const elapsed = Date.now() - started;
      expect(r).toEqual({ ok: false, reason: TOO_LARGE });
      // Refused early rather than after inflating the whole thing.
      expect(elapsed).toBeLessThan(2000);
    });
  });

  describe("other behaviour", () => {
    it("reports an absent content-type as null, never as a value", async () => {
      const r = await run("/no-ct");
      expect(r.ok).toBe(true);
      // Not "". A caller must handle absence explicitly; the type forbids
      // string comparisons until it has.
      if (r.ok) expect(r.contentType).toBeNull();
    });

    it("refuses a non-2xx response", async () => {
      await expect(run("/notfound")).resolves.toEqual({
        ok: false,
        reason: UNREADABLE,
      });
    });

    it("sends no cookie or authorization header, and sends the acceptHeader given", async () => {
      await run("/ok", { maxBytes: 100_000, acceptHeader: "text/html,application/xhtml+xml" });
      expect(lastHeaders.cookie).toBeUndefined();
      expect(lastHeaders.authorization).toBeUndefined();
      expect(lastHeaders.accept).toBe("text/html,application/xhtml+xml");
      expect(lastHeaders["user-agent"]).toBe("rybn-link-preview");
    });

    it(
      "spends ONE timeout budget across the whole chain, not one per hop",
      async () => {
        // Two hops, three seconds each. Per-hop timeouts would allow both (each
        // is under the limit) and take six seconds. A single budget must give
        // up inside it.
        const started = Date.now();
        const r = await run("/slow-hop-1");
        const elapsed = Date.now() - started;
        expect(r).toEqual({ ok: false, reason: UNREACHABLE });
        expect(elapsed).toBeLessThan(6000);
      },
      20_000
    );
  });
});
