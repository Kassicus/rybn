import { describe, expect, it } from "vitest";
import { isBlockedAddress, parseSafeUrl } from "@/lib/link-metadata/url-safety";

describe("isBlockedAddress", () => {
  const blocked = [
    "127.0.0.1", "127.1.2.3",           // loopback
    "10.0.0.1", "172.16.0.1", "192.168.1.1", // private
    "169.254.169.254",                   // cloud metadata
    "100.64.0.1",                        // carrier-grade NAT
    "0.0.0.0",
    "255.255.255.255",
    "224.0.0.1",                         // multicast
    "::1",                               // v6 loopback
    "::",                                // v6 unspecified
    "fc00::1", "fd12:3456::1",           // unique local
    "fe80::1",                           // v6 link-local
    "ff02::1",                           // v6 multicast
    "::ffff:169.254.169.254",            // IPv4-mapped metadata — the bypass
    "::ffff:127.0.0.1",
    "::ffff:a9fe:a9fe",                  // the SAME address, hex-compressed
  ];
  for (const ip of blocked) {
    it(`blocks ${ip}`, () => expect(isBlockedAddress(ip)).toBe(true));
  }

  const allowed = ["1.1.1.1", "93.184.216.34", "2606:2800:220:1:248:1893:25c8:1946"];
  for (const ip of allowed) {
    it(`allows ${ip}`, () => expect(isBlockedAddress(ip)).toBe(false));
  }

  it("blocks anything unparseable", () => {
    expect(isBlockedAddress("not-an-ip")).toBe(true);
    expect(isBlockedAddress("")).toBe(true);
  });
});

describe("parseSafeUrl", () => {
  it("accepts http and https", () => {
    expect(parseSafeUrl("https://example.com/x").ok).toBe(true);
    expect(parseSafeUrl("http://example.com/x").ok).toBe(true);
  });

  const rejected = [
    "file:///etc/passwd",
    "data:text/html,hi",
    "javascript:alert(1)",
    "ftp://example.com/x",
    "gopher://example.com/x",
    "not a url",
    "",
  ];
  for (const raw of rejected) {
    it(`rejects ${raw || "(empty)"}`, () => expect(parseSafeUrl(raw).ok).toBe(false));
  }

  it("rejects embedded credentials", () => {
    expect(parseSafeUrl("https://user:pw@example.com/x").ok).toBe(false);
  });

  it("accepts a host that merely resembles a blocked one", () => {
    expect(parseSafeUrl("https://127.0.0.1.example.com/x").ok).toBe(true);
  });

  // The spec calls for decimal/octal/hex IP encodings. They are defended by the
  // URL parser normalising them, not by anything we wrote -- which is exactly
  // why it is worth asserting rather than assuming.
  it("normalises alternate IP encodings to a form isBlockedAddress catches", () => {
    for (const raw of ["http://2130706433/", "http://0177.0.0.1/", "http://0x7f.1/"]) {
      const r = parseSafeUrl(raw);
      expect(r.ok).toBe(true);
      expect((r as { url: URL }).url.hostname).toBe("127.0.0.1");
      expect(isBlockedAddress((r as { url: URL }).url.hostname)).toBe(true);
    }
  });

  it("normalises bracketed IPv4-mapped IPv6 to a blocked address", () => {
    const r = parseSafeUrl("http://[::ffff:169.254.169.254]/");
    expect(r.ok).toBe(true);
    // Note the brackets and the hex compression -- this is what the code really sees.
    const host = (r as { url: URL }).url.hostname.replace(/^\[|\]$/g, "");
    expect(host).toBe("::ffff:a9fe:a9fe");
    expect(isBlockedAddress(host)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Cases beyond the corpus above. Each one is here because running that corpus
// proved it could not tell a real difference -- see url-safety.ts for why.
// ---------------------------------------------------------------------------

describe("isBlockedAddress: cases the corpus above cannot distinguish", () => {
  // Deleting the isIPv4MappedAddress branch leaves the corpus above entirely
  // green, because under an allowlist `ipv4Mapped !== "unicast"` already
  // refuses every mapped address. The branch's real job is the other
  // direction: getaddrinfo can hand back a public IPv4 host in v4-mapped form,
  // and without unmapping we would refuse to fetch legitimate sites. These two
  // assertions together are what make that branch load-bearing.
  it("allows a public IPv4 host presented in v4-mapped form", () => {
    expect(isBlockedAddress("::ffff:93.184.216.34")).toBe(false);
  });

  it("still blocks the metadata endpoint in v4-mapped form", () => {
    expect(isBlockedAddress("::ffff:169.254.169.254")).toBe(true);
  });

  // ::/96 is IPv4-COMPATIBLE IPv6 (RFC 4291 s2.5.5.1) -- a different range from
  // the ::ffff:0:0/96 mapped one, and one ipaddr.js does not model at all, so
  // it comes back "unicast" and the allowlist would let it through. ipaddr.js
  // rescues only the DOTTED spelling, which it silently rewrites into the
  // mapped form; the hex spelling is the one our code actually sees, because
  // that is what new URL() emits.
  const ipv4Compatible = [
    "::a9fe:a9fe",       // == ::169.254.169.254 -- the metadata endpoint
    "::169.254.169.254", // the dotted spelling of that same address
    "::7f00:1",          // == ::127.0.0.1
    "::127.0.0.1",
  ];
  for (const ip of ipv4Compatible) {
    it(`blocks IPv4-compatible ${ip}`, () =>
      expect(isBlockedAddress(ip)).toBe(true));
  }
});

describe("parseSafeUrl: IPv4-compatible IPv6 round-trip", () => {
  it("normalises bracketed IPv4-compatible IPv6 to a blocked address", () => {
    const r = parseSafeUrl("http://[::169.254.169.254]/");
    expect(r.ok).toBe(true);
    const host = (r as { url: URL }).url.hostname.replace(/^\[|\]$/g, "");
    // No ffff in the result: this is ::/96, not ::ffff:0:0/96.
    expect(host).toBe("::a9fe:a9fe");
    expect(isBlockedAddress(host)).toBe(true);
  });
});
