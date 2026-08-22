import ipaddr from "ipaddr.js";

/**
 * IANA global unicast, the only IPv6 block that carries the public internet.
 * Everything routable on the v6 internet today lives inside `2000::/3`.
 */
const IPV6_GLOBAL_UNICAST = ipaddr.parseCIDR("2000::/3");

/**
 * True when this address must never be connected to.
 *
 * Allowlist, not denylist. For an address to pass, BOTH must hold:
 *
 *   1. `range()` is `"unicast"` — it matched none of the special ranges
 *      ipaddr.js models.
 *   2. If it is IPv6, it is inside `2000::/3` (IANA global unicast).
 *
 * Neither condition replaces the other, and the second is the one that makes
 * the whole thing fail closed.
 *
 * **Why (1) alone is not enough.** `ipaddr.subnetMatch` DEFAULTS its answer to
 * `"unicast"` when nothing in its table matches (see the `defaultName` handling
 * in `node_modules/ipaddr.js/lib/ipaddr.js`). So `range() === "unicast"` really
 * means "unclassified", not "public". Every IPv6 range ipaddr.js does not model
 * lands in that default and would be waved straight through — measured against
 * 2.5.0, that includes ISATAP (`::5efe:a9fe:a9fe`, which carries
 * 169.254.169.254), `::/96` IPv4-compatible (`::a9fe:a9fe`, the form
 * `new URL("http://[::169.254.169.254]/").hostname` actually produces),
 * `::1:a9fe:a9fe`, `::ffff:0:0:0:1`, `100:0:0:1::1`, `200::1`, `400::1`,
 * `8000::1` and `fe00::1`. The `2000::/3` gate refuses all of them, and refuses
 * the next such range nobody has thought of yet.
 *
 * **Why (2) alone is not enough.** `2001:db8::/32` (documentation) and
 * `2002::/16` (6to4, which can wrap the metadata endpoint as
 * `2002:a9fe:a9fe::`) are both *inside* `2000::/3`. Only `range()` refuses
 * those. Dropping either condition reopens a hole.
 *
 * IPv4 needs no equivalent gate: there is no "global unicast prefix" for v4,
 * and ipaddr.js models every special-purpose v4 range this design names.
 */
export function isBlockedAddress(ip: string): boolean {
  // Task 3 reads hostnames straight from `new URL()`, which brackets IPv6
  // literals. `ipaddr.parse` throws on those — which fails closed, so this is
  // an availability fix rather than a security one, but unstripped it would
  // refuse every IPv6 host rather than only the bad ones.
  const candidate =
    ip.startsWith("[") && ip.endsWith("]") ? ip.slice(1, -1) : ip;

  let parsed;
  try {
    parsed = ipaddr.parse(candidate);
  } catch {
    return true; // unparseable is not connectable
  }

  if (parsed.kind() === "ipv6") {
    const v6 = parsed as ipaddr.IPv6;

    // ::ffff:169.254.169.254 — IPv4-MAPPED. Unmap and judge the v4 address it
    // actually carries.
    //
    // Note what this branch does and does not do. It is NOT what blocks the
    // metadata endpoint: "ipv4Mapped" is already !== "unicast", so deleting it
    // leaves every mapped address refused. Its job is the other direction —
    // getaddrinfo may hand back a genuinely public IPv4 host in mapped form
    // (`::ffff:93.184.216.34`), and that form is NOT inside 2000::/3, so
    // without unmapping the gate below would refuse real sites. Unmapping
    // keeps that case working while ::ffff:169.254.169.254 still fails on the
    // 169.254.169.254 inside it.
    if (v6.isIPv4MappedAddress()) {
      return isBlockedAddress(v6.toIPv4Address().toString());
    }

    // The global-unicast gate. This subsumes what an explicit `::/96`
    // IPv4-compatible check used to do here: `::a9fe:a9fe` is `range()`
    // "unicast" but sits outside 2000::/3, so it is refused — as is the whole
    // unmodelled class it belongs to, rather than that one prefix.
    if (!v6.match(IPV6_GLOBAL_UNICAST)) {
      return true;
    }
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
