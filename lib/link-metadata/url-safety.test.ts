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

  // Asserting `reason` and not just `ok`: a refusal that fires for the wrong
  // cause is still a refusal, and would hide a broken scheme check behind a
  // parse failure (or the reverse).
  const NOT_A_URL = "That does not look like a web address.";
  const BAD_SCHEME = "Only http and https links can be read.";
  const HAS_CREDENTIALS = "That link cannot contain a username or password.";

  const rejected: Array<[string, string]> = [
    ["file:///etc/passwd", BAD_SCHEME],
    ["data:text/html,hi", BAD_SCHEME],
    ["javascript:alert(1)", BAD_SCHEME],
    ["ftp://example.com/x", BAD_SCHEME],
    ["gopher://example.com/x", BAD_SCHEME],
    ["not a url", NOT_A_URL],
    ["", NOT_A_URL],
  ];
  for (const [raw, reason] of rejected) {
    it(`rejects ${raw || "(empty)"}`, () => {
      const r = parseSafeUrl(raw);
      expect(r.ok).toBe(false);
      expect((r as { reason: string }).reason).toBe(reason);
    });
  }

  it("rejects embedded credentials", () => {
    const r = parseSafeUrl("https://user:pw@example.com/x");
    expect(r.ok).toBe(false);
    // Specifically the credentials refusal -- the scheme here is https, so a
    // BAD_SCHEME answer would mean the credentials check never ran.
    expect((r as { reason: string }).reason).toBe(HAS_CREDENTIALS);
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
  // it comes back "unicast" and a bare range() check lets it through. ipaddr.js
  // rescues only the DOTTED spelling, which it silently rewrites into the
  // mapped form; the hex spelling is the one our code actually sees, because
  // that is what new URL() emits.
  //
  // These are now refused by the 2000::/3 gate rather than by a ::/96-specific
  // branch -- ::/96 turned out to be one instance of the much wider unmodelled
  // class exercised further down. The cases stay: they are the reason the gate
  // exists, and they fail the moment it is removed.
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

// ---------------------------------------------------------------------------
// The unmodelled-IPv6 class. ipaddr.subnetMatch DEFAULTS its answer to
// "unicast" when no special range matches, so range() === "unicast" means
// "unclassified", not "public". Every address below is range() === "unicast"
// and is refused only by the 2000::/3 global-unicast gate. Without these
// tests the gate can be "simplified" away and the hole comes straight back.
// ---------------------------------------------------------------------------

describe("isBlockedAddress: IPv6 ranges ipaddr.js does not model", () => {
  const unmodelled = [
    "::5efe:a9fe:a9fe",       // ISATAP carrying 169.254.169.254
    "::5efe:169.254.169.254", // the dotted spelling of the same
    "::1:a9fe:a9fe",
    "::ffff:0:0:0:1",
    "100:0:0:1::1",
    "200::1",
    "400::1",
    "8000::1",
    "fe00::1",
  ];
  for (const ip of unmodelled) {
    it(`blocks unmodelled ${ip}`, () => expect(isBlockedAddress(ip)).toBe(true));
  }

  // ...while the gate must not cost us the real IPv6 internet.
  const reachable = [
    "2606:2800:220:1:248:1893:25c8:1946",
    "2001:4860:4860::8888",
  ];
  for (const ip of reachable) {
    it(`keeps ${ip} reachable`, () => expect(isBlockedAddress(ip)).toBe(false));
  }

  // 2000::/3 alone is not sufficient either: both of these are INSIDE it and
  // only range() refuses them. The two conditions intersect, neither replaces
  // the other.
  it("still blocks the documentation prefix, which is inside 2000::/3", () => {
    expect(isBlockedAddress("2001:db8::1")).toBe(true);
  });

  it("still blocks 6to4 wrapping the metadata endpoint, inside 2000::/3", () => {
    expect(isBlockedAddress("2002:a9fe:a9fe::1")).toBe(true);
  });

  it("normalises a pasted ISATAP URL to the address the gate refuses", () => {
    const r = parseSafeUrl("http://[::5efe:169.254.169.254]/");
    expect(r.ok).toBe(true);
    const host = (r as { url: URL }).url.hostname.replace(/^\[|\]$/g, "");
    expect(host).toBe("::5efe:a9fe:a9fe");
    expect(isBlockedAddress(host)).toBe(true);
  });
});

describe("isBlockedAddress: bracketed IPv6 literals", () => {
  // Task 3 reads hostnames from new URL(), which brackets IPv6 literals.
  // Unstripped these throw in ipaddr.parse and fail closed -- safe, but it
  // would refuse every IPv6 host rather than only the bad ones.
  it("blocks a bracketed loopback", () => {
    expect(isBlockedAddress("[::1]")).toBe(true);
  });

  it("blocks a bracketed v4-mapped metadata address", () => {
    expect(isBlockedAddress("[::ffff:a9fe:a9fe]")).toBe(true);
  });

  it("blocks a bracketed unmodelled address", () => {
    expect(isBlockedAddress("[::5efe:a9fe:a9fe]")).toBe(true);
  });

  it("allows a bracketed public IPv6 host", () => {
    expect(isBlockedAddress("[2606:2800:220:1:248:1893:25c8:1946]")).toBe(false);
  });

  it("blocks a lone bracket pair", () => {
    expect(isBlockedAddress("[]")).toBe(true);
  });
});
