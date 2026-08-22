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

  // ::ffff:169.254.169.254 is a real bypass: as IPv6 its range is
  // "ipv4Mapped", which says nothing about the v4 address inside it.
  if (parsed.kind() === "ipv6" && (parsed as ipaddr.IPv6).isIPv4MappedAddress()) {
    return isBlockedAddress((parsed as ipaddr.IPv6).toIPv4Address().toString());
  }

  return parsed.range() !== "unicast";
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
