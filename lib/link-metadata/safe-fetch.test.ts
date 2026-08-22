import { describe, expect, it } from "vitest";
import { safeFetch } from "./safe-fetch";

/**
 * Only the refusals that happen before a socket is ever opened live here, so
 * this file needs no network and cannot go flaky. That is not a limitation —
 * it is exactly the class of bug this file exists to catch.
 *
 * `net.connect` skips DNS entirely when the host is already an IP literal, so
 * the `lookup` hook inside safe-fetch is never called for these URLs. A guard
 * built only on that hook would connect straight to every address below. The
 * cases here are the regression test for that gap; anything requiring real DNS
 * (a public name that resolves to a private address) needs a live resolver and
 * is exercised out of band.
 */

const REFUSED = "That link points somewhere we will not fetch from.";
const UNREADABLE = "We could not read that page.";
const OPTS = { maxBytes: 100_000, accept: "text/html" };

describe("safeFetch refuses literal-IP hosts without connecting", () => {
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
  it("refuses a non-http scheme", async () => {
    const r = await safeFetch("ftp://example.com/", OPTS);
    expect(r.ok).toBe(false);
  });

  it("refuses a URL carrying credentials", async () => {
    const r = await safeFetch("http://user:pass@example.com/", OPTS);
    expect(r.ok).toBe(false);
  });

  it("refuses something that is not a URL", async () => {
    const r = await safeFetch("not a url", OPTS);
    expect(r.ok).toBe(false);
  });
});

describe("safeFetch treats a missing size cap as a refusal, not as no cap", () => {
  for (const maxBytes of [0, -1, NaN, Infinity, undefined as unknown as number]) {
    it(`refuses maxBytes=${String(maxBytes)}`, async () => {
      await expect(
        safeFetch("https://example.com/", { maxBytes, accept: "text/html" })
      ).resolves.toEqual({ ok: false, reason: UNREADABLE });
    });
  }
});
