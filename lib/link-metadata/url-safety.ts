import ipaddr from "ipaddr.js";

/**
 * True when this address must never be connected to.
 *
 * Allowlist, not denylist: only `unicast` — a genuine public address — passes.
 * Every other range ipaddr.js knows about is refused, so a range we failed to
 * think of fails CLOSED rather than open.
 */
export function isBlockedAddress(ip: string): boolean {
  let parsed;
  try {
    parsed = ipaddr.parse(ip);
  } catch {
    return true; // unparseable is not connectable
  }

  if (parsed.kind() === "ipv6") {
    const v6 = parsed as ipaddr.IPv6;

    // ::ffff:169.254.169.254 is a real bypass: as IPv6 its range is
    // "ipv4Mapped", which says nothing about the v4 address inside it.
    //
    // Note what this branch does and does not do under an allowlist. It is NOT
    // what blocks the metadata endpoint -- "ipv4Mapped" is already !== unicast,
    // so deleting this leaves every mapped address refused. Its job is the
    // other direction: getaddrinfo may hand back a genuinely public IPv4 host
    // in mapped form, and without unmapping we would refuse to fetch real
    // sites. Unmapping keeps that case working while ::ffff:169.254.169.254
    // still fails on the v4 address it actually carries.
    if (v6.isIPv4MappedAddress()) {
      return isBlockedAddress(v6.toIPv4Address().toString());
    }

    // ::/96 -- IPv4-COMPATIBLE IPv6 (RFC 4291 s2.5.5.1, deprecated). This is a
    // different range from the mapped ::ffff:0:0/96 above, and ipaddr.js does
    // not model it: ::a9fe:a9fe classifies as "unicast", so the allowlist would
    // let the metadata endpoint straight through. ipaddr.js rescues only the
    // dotted spelling "::169.254.169.254", which it silently rewrites into the
    // mapped form -- and the dotted spelling is never what we see, because
    // new URL("http://[::169.254.169.254]/").hostname is "[::a9fe:a9fe]".
    // Unmap and re-check, for the same reason the mapped form is unmapped.
    const compatible = ipv4CompatibleAddress(v6);
    if (compatible !== null) {
      return isBlockedAddress(compatible);
    }
  }

  return parsed.range() !== "unicast";
}

/**
 * The IPv4 address embedded in an IPv4-compatible IPv6 address (`::/96`), or
 * null when the address is not in that range.
 *
 * `::` and `::1` land here too, and unmap to 0.0.0.0 and 0.0.0.1 — both inside
 * 0.0.0.0/8, so both stay blocked. Nothing routable lives in `::/96`.
 */
function ipv4CompatibleAddress(v6: ipaddr.IPv6): string | null {
  const parts = v6.parts;
  for (let i = 0; i < 6; i++) {
    if (parts[i] !== 0) return null;
  }
  const high = parts[6];
  const low = parts[7];
  return [high >> 8, high & 0xff, low >> 8, low & 0xff].join(".");
}

export function parseSafeUrl(
  raw: string
): { ok: true; url: URL } | { ok: false; reason: string } {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { ok: false, reason: "That does not look like a web address." };
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return { ok: false, reason: "Only http and https links can be read." };
  }

  // Credentials in a fetched URL are never wanted and are a known SSRF
  // confusion vector across parsers.
  if (url.username || url.password) {
    return { ok: false, reason: "That link cannot contain a username or password." };
  }

  return { ok: true, url };
}
