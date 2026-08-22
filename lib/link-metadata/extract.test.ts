import { describe, expect, it } from "vitest";
import { extractMetadata, reduceToMarkup } from "@/lib/link-metadata/extract";
import { DESCRIPTION_MAX_LENGTH, TITLE_MAX_LENGTH } from "@/lib/schemas/wishlist";

const PAGE = "https://shop.example.com/p/1";

// ---------------------------------------------------------------------------
// The plan's own corpus, verbatim.
// ---------------------------------------------------------------------------

describe("extractMetadata", () => {
  it("prefers JSON-LD over Open Graph", () => {
    const html = `
      <html><head>
        <meta property="og:title" content="OG Title">
        <meta property="og:price:amount" content="99.00">
        <script type="application/ld+json">
          {"@type":"Product","name":"LD Title","offers":{"price":"42.50","priceCurrency":"USD"}}
        </script>
      </head></html>`;
    const r = extractMetadata(html, PAGE);
    expect(r.title).toBe("LD Title");
    expect(r.price).toBe(42.5);
  });

  it("falls back to Open Graph", () => {
    const html = `<html><head>
      <meta property="og:title" content="OG Title">
      <meta property="og:description" content="OG Desc">
      <meta property="og:image" content="/img/a.jpg">
    </head></html>`;
    const r = extractMetadata(html, PAGE);
    expect(r.title).toBe("OG Title");
    expect(r.description).toBe("OG Desc");
    expect(r.imageUrl).toBe("https://shop.example.com/img/a.jpg");
  });

  it("falls back to twitter card, then document title", () => {
    expect(extractMetadata(
      `<html><head><meta name="twitter:title" content="TW"></head></html>`, PAGE
    ).title).toBe("TW");
    expect(extractMetadata(
      `<html><head><title>Doc</title></head></html>`, PAGE
    ).title).toBe("Doc");
  });

  it("never takes a price from page text", () => {
    const html = `<html><body><p>Only $19.99 today!</p></body></html>`;
    expect(extractMetadata(html, PAGE).price).toBeUndefined();
  });

  it("drops an unparseable price rather than guessing", () => {
    const html = `<html><head><meta property="og:price:amount" content="call us"></head></html>`;
    expect(extractMetadata(html, PAGE).price).toBeUndefined();
  });

  it("survives malformed JSON-LD", () => {
    const html = `<html><head>
      <script type="application/ld+json">{not json</script>
      <meta property="og:title" content="Still Works">
    </head></html>`;
    expect(extractMetadata(html, PAGE).title).toBe("Still Works");
  });

  it("finds Product inside an @graph array", () => {
    const html = `<html><head><script type="application/ld+json">
      {"@graph":[{"@type":"WebSite"},{"@type":"Product","name":"Graphed"}]}
    </script></head></html>`;
    expect(extractMetadata(html, PAGE).title).toBe("Graphed");
  });

  it("returns an empty object for a page with nothing", () => {
    expect(extractMetadata("<html><body>hi</body></html>", PAGE)).toEqual({});
  });
});

// ---------------------------------------------------------------------------
// Precedence. Every one of these fails if the ORDER of the sources changes,
// not just if a source is deleted -- each page below carries a value at every
// tier, so swapping any two tiers changes the answer.
// ---------------------------------------------------------------------------

describe("source precedence", () => {
  const everything = `<html><head>
    <title>Doc Title</title>
    <meta name="description" content="Doc Desc">
    <meta name="twitter:title" content="TW Title">
    <meta name="twitter:description" content="TW Desc">
    <meta name="twitter:image" content="/tw.jpg">
    <meta property="og:title" content="OG Title">
    <meta property="og:description" content="OG Desc">
    <meta property="og:image" content="/og.jpg">
    <meta property="og:price:amount" content="99.00">
    <meta property="og:price:currency" content="USD">
    <script type="application/ld+json">{"@type":"Product","name":"LD Title",
      "description":"LD Desc","image":"/ld.jpg",
      "offers":{"price":"42.50","priceCurrency":"USD"}}</script>
  </head></html>`;

  it("takes every field from JSON-LD when JSON-LD has it", () => {
    expect(extractMetadata(everything, PAGE)).toStrictEqual({
      title: "LD Title",
      description: "LD Desc",
      price: 42.5,
      imageUrl: "https://shop.example.com/ld.jpg",
    });
  });

  it("takes Open Graph over twitter and the document when JSON-LD is absent", () => {
    const noLd = everything.replace(/<script[\s\S]*?<\/script>/, "");
    expect(extractMetadata(noLd, PAGE)).toStrictEqual({
      title: "OG Title",
      description: "OG Desc",
      price: 99,
      imageUrl: "https://shop.example.com/og.jpg",
    });
  });

  it("takes the twitter card over the document when Open Graph is absent", () => {
    const html = `<html><head>
      <title>Doc Title</title>
      <meta name="description" content="Doc Desc">
      <meta name="twitter:title" content="TW Title">
      <meta name="twitter:description" content="TW Desc">
      <meta name="twitter:image" content="/tw.jpg">
    </head></html>`;
    expect(extractMetadata(html, PAGE)).toStrictEqual({
      title: "TW Title",
      description: "TW Desc",
      imageUrl: "https://shop.example.com/tw.jpg",
    });
  });

  it("falls all the way to the document floor", () => {
    const html = `<html><head>
      <title>Doc Title</title>
      <meta name="description" content="Doc Desc">
    </head></html>`;
    expect(extractMetadata(html, PAGE)).toStrictEqual({
      title: "Doc Title",
      description: "Doc Desc",
    });
  });

  it("fills each field from its own best available tier", () => {
    // JSON-LD carries only a name; everything else must come from lower tiers.
    const html = `<html><head>
      <title>Doc Title</title>
      <meta name="twitter:description" content="TW Desc">
      <meta property="og:image" content="/og.jpg">
      <script type="application/ld+json">{"@type":"Product","name":"LD Title"}</script>
    </head></html>`;
    expect(extractMetadata(html, PAGE)).toStrictEqual({
      title: "LD Title",
      description: "TW Desc",
      imageUrl: "https://shop.example.com/og.jpg",
    });
  });
});

// ---------------------------------------------------------------------------
// Price. The field the design calls the most dangerous to get wrong: a wrong
// price misleads someone buying a gift, a missing one is a small annoyance.
// ---------------------------------------------------------------------------

describe("price: positive controls", () => {
  // Without these, every "price is undefined" assertion below could pass on a
  // module that never reads a price at all.
  it("reads a JSON-LD offer price", () => {
    const html = `<script type="application/ld+json">
      {"@type":"Product","offers":{"price":"42.50","priceCurrency":"USD"}}</script>`;
    expect(extractMetadata(html, PAGE).price).toBe(42.5);
  });

  it("reads an og:price:amount", () => {
    const html = `<head><meta property="og:price:amount" content="99.00">
      <meta property="og:price:currency" content="USD"></head>`;
    expect(extractMetadata(html, PAGE).price).toBe(99);
  });

  it("accepts a JSON number, not only a numeric string", () => {
    const html = `<script type="application/ld+json">
      {"@type":"Product","offers":{"price":42.5,"priceCurrency":"USD"}}</script>`;
    expect(extractMetadata(html, PAGE).price).toBe(42.5);
  });

  it("accepts an integer price and a many-decimal price", () => {
    const at = (p: string) =>
      extractMetadata(
        `<script type="application/ld+json">{"@type":"Product","offers":{"price":"${p}","priceCurrency":"USD"}}</script>`,
        PAGE,
      ).price;
    expect(at("42")).toBe(42);
    expect(at("42.5000")).toBe(42.5);
    expect(at("0.99")).toBe(0.99);
  });
});

describe("price: values that must be dropped, never coerced", () => {
  const ldPrice = (raw: string, currency = `"priceCurrency":"USD",`) =>
    extractMetadata(
      `<script type="application/ld+json">{"@type":"Product","offers":{${currency}"price":${raw}}}</script>`,
      PAGE,
    );

  it("drops a price with a thousands separator instead of reading 1,299.99 as 1.29999", () => {
    // schema.org: "Use '.' rather than ',' to indicate a decimal point. Avoid
    // using these symbols as a readability separator." A separator means the
    // string is not in the format we can trust, so it is dropped outright.
    expect(ldPrice(`"1,299.99"`).price).toBeUndefined();
    expect(ldPrice(`"1.299,99"`).price).toBeUndefined();
  });

  it("drops a price carrying a currency symbol", () => {
    expect(ldPrice(`"$42.50"`).price).toBeUndefined();
    expect(ldPrice(`"42.50 USD"`).price).toBeUndefined();
    expect(ldPrice(`"USD 42.50"`).price).toBeUndefined();
  });

  it("drops a sale-and-was string rather than splicing the digits together", () => {
    // Stripping non-digits would turn this into 19.9929 -- a number that
    // appears nowhere on the page.
    expect(ldPrice(`"Now 19.99, was 29.99"`).price).toBeUndefined();
    expect(ldPrice(`"19.99 today only"`).price).toBeUndefined();
  });

  it("drops a negative price rather than dropping the sign", () => {
    expect(ldPrice(`"-5.00"`).price).toBeUndefined();
    expect(ldPrice(`-5.00`).price).toBeUndefined();
  });

  it("drops zero, which is an absent price rather than a free gift", () => {
    expect(ldPrice(`"0.00"`).price).toBeUndefined();
    expect(ldPrice(`0`).price).toBeUndefined();
  });

  it("drops a sub-cent price, which would render as $0.00", () => {
    // Every render site formats with .toFixed(2), so 0.0000001 reaches the
    // user as "$0.00" -- a price that says free about something that is not.
    expect(ldPrice(`0.0000001`).price).toBeUndefined();
    expect(ldPrice(`"0.001"`).price).toBeUndefined();
    expect(ldPrice(`"0.009"`).price).toBeUndefined();
    expect(ldPrice(`"0.01"`).price).toBe(0.01); // exactly one cent is a price
  });

  it("drops a non-scalar price", () => {
    expect(ldPrice(`{"@type":"UnitPriceSpecification","price":42.5}`).price).toBeUndefined();
    expect(ldPrice(`[10.00, 20.00]`).price).toBeUndefined();
    expect(ldPrice(`true`).price).toBeUndefined();
    expect(ldPrice(`null`).price).toBeUndefined();
  });

  it("drops values that are not finite or are absurdly large", () => {
    expect(ldPrice(`"1e3"`).price).toBeUndefined();
    expect(ldPrice(`1e999`).price).toBeUndefined(); // JSON.parse -> Infinity
    expect(ldPrice(`999999999`).price).toBeUndefined();
  });

  it("drops an exotic-digit price", () => {
    expect(ldPrice(`"４２"`).price).toBeUndefined(); // fullwidth 42
    expect(ldPrice(`"٤٢"`).price).toBeUndefined(); // arabic-indic 42
  });

  it("reports no price key at all, rather than a key holding 0 or NaN", () => {
    const r = ldPrice(`"call us"`);
    expect("price" in r).toBe(false);
    expect(r.price).toBeUndefined();
  });
});

describe("price: currency", () => {
  const ld = (offer: string) =>
    extractMetadata(
      `<script type="application/ld+json">{"@type":"Product","offers":${offer}}</script>`,
      PAGE,
    ).price;

  it("drops a price in a currency this app cannot render", () => {
    // Every price in the app renders behind a hard-coded "$" (see
    // WishlistItemCard, the item page, the dashboard). 42.50 EUR shown as
    // $42.50 is exactly the wrong-price harm the design forbids.
    expect(ld(`{"price":"42.50","priceCurrency":"EUR"}`)).toBeUndefined();
    expect(ld(`{"price":"42.50","priceCurrency":"GBP"}`)).toBeUndefined();
    expect(ld(`{"price":"42.50","priceCurrency":"CAD"}`)).toBeUndefined();
  });

  it("drops a price whose currency is an ambiguous symbol", () => {
    // "$" is USD, CAD, AUD, MXN, ...
    expect(ld(`{"price":"42.50","priceCurrency":"$"}`)).toBeUndefined();
  });

  it("drops a price with no declared currency, because absent is not permission", () => {
    expect(ld(`{"price":"42.50"}`)).toBeUndefined();
    expect(
      extractMetadata(`<meta property="og:price:amount" content="42.50">`, PAGE).price,
    ).toBeUndefined();
  });

  it("accepts the currency regardless of case and surrounding space", () => {
    expect(ld(`{"price":"42.50","priceCurrency":"usd"}`)).toBe(42.5);
    expect(ld(`{"price":"42.50","priceCurrency":"  USD  "}`)).toBe(42.5);
  });

  it("drops an og price whose currency disagrees", () => {
    const html = `<head><meta property="og:price:amount" content="42.50">
      <meta property="og:price:currency" content="EUR"></head>`;
    expect(extractMetadata(html, PAGE).price).toBeUndefined();
  });

  it("does not let an og currency vouch for a JSON-LD amount", () => {
    const html = `<head><meta property="og:price:currency" content="USD">
      <script type="application/ld+json">
        {"@type":"Product","offers":{"price":"42.50"}}</script></head>`;
    expect(extractMetadata(html, PAGE).price).toBeUndefined();
  });
});

describe("price: multiple offers", () => {
  const ld = (offers: string) =>
    extractMetadata(
      `<script type="application/ld+json">{"@type":"Product","offers":${offers}}</script>`,
      PAGE,
    ).price;

  it("accepts an offer array whose prices agree", () => {
    expect(ld(`[{"price":"42.50","priceCurrency":"USD"},{"price":"42.50","priceCurrency":"USD"}]`))
      .toBe(42.5);
  });

  it("drops an offer array whose prices disagree, rather than taking the first", () => {
    expect(ld(`[{"price":"10.00","priceCurrency":"USD"},{"price":"20.00","priceCurrency":"USD"}]`))
      .toBeUndefined();
  });

  it("ignores offers with no usable price when one offer is usable", () => {
    expect(ld(`[{"availability":"InStock"},{"price":"42.50","priceCurrency":"USD"}]`)).toBe(42.5);
  });

  it("ignores an offer quoted in a currency we cannot render", () => {
    // The EUR offer contributes nothing, so it neither supplies a price nor
    // makes the USD one ambiguous.
    expect(ld(`[{"price":"42.50","priceCurrency":"USD"},{"price":"39.00","priceCurrency":"EUR"}]`))
      .toBe(42.5);
    expect(ld(`[{"price":"42.50","priceCurrency":"EUR"},{"price":"39.00","priceCurrency":"EUR"}]`))
      .toBeUndefined();
  });

  it("takes no price from an AggregateOffer range", () => {
    expect(ld(`{"@type":"AggregateOffer","lowPrice":"10.00","highPrice":"90.00","priceCurrency":"USD"}`))
      .toBeUndefined();
  });

  it("drops the price when the offer list is implausibly long", () => {
    const many = Array.from(
      { length: 200 },
      () => `{"price":"42.50","priceCurrency":"USD"}`,
    ).join(",");
    expect(ld(`[${many}]`)).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// JSON-LD shapes.
// ---------------------------------------------------------------------------

describe("JSON-LD traversal", () => {
  it("matches a @type array containing Product", () => {
    const html = `<script type="application/ld+json">
      {"@type":["Thing","Product"],"name":"Multi"}</script>`;
    expect(extractMetadata(html, PAGE).title).toBe("Multi");
  });

  it("finds a Product in a top-level array", () => {
    const html = `<script type="application/ld+json">
      [{"@type":"BreadcrumbList"},{"@type":"Product","name":"Arrayed"}]</script>`;
    expect(extractMetadata(html, PAGE).title).toBe("Arrayed");
  });

  it("keeps reading later scripts after a malformed one", () => {
    const html = `<head>
      <script type="application/ld+json">{not json</script>
      <script type="application/ld+json">{"@type":"Product","name":"Second Block"}</script>
    </head>`;
    expect(extractMetadata(html, PAGE).title).toBe("Second Block");
  });

  it("keeps reading later scripts after one with no Product in it", () => {
    const html = `<head>
      <script type="application/ld+json">{"@type":"Organization","name":"Acme"}</script>
      <script type="application/ld+json">{"@type":"Product","name":"Real Product"}</script>
    </head>`;
    expect(extractMetadata(html, PAGE).title).toBe("Real Product");
  });

  it("takes the first Product and ignores a later, differently priced one", () => {
    const html = `<head>
      <script type="application/ld+json">{"@type":"Product","name":"Main",
        "offers":{"price":"42.50","priceCurrency":"USD"}}</script>
      <script type="application/ld+json">{"@type":"Product","name":"Also Bought",
        "offers":{"price":"999.00","priceCurrency":"USD"}}</script>
    </head>`;
    const r = extractMetadata(html, PAGE);
    expect(r.title).toBe("Main");
    expect(r.price).toBe(42.5);
  });

  it("does not mix one Product's title with another Product's price", () => {
    const html = `<head>
      <script type="application/ld+json">{"@type":"Product","name":"Priceless"}</script>
      <script type="application/ld+json">{"@type":"Product","name":"Other",
        "offers":{"price":"999.00","priceCurrency":"USD"}}</script>
    </head>`;
    const r = extractMetadata(html, PAGE);
    expect(r.title).toBe("Priceless");
    expect(r.price).toBeUndefined();
  });

  it("reads the last JSON-LD block it is willing to look at", () => {
    const pad = `<script type="application/ld+json">{"@type":"Organization"}</script>`;
    const product =
      `<script type="application/ld+json">{"@type":"Product","name":"Block 100"}</script>`;
    expect(extractMetadata(pad.repeat(99) + product, PAGE).title).toBe("Block 100");
  });

  it("stops after its ceiling of JSON-LD blocks rather than reading an unbounded page", () => {
    const pad = `<script type="application/ld+json">{"@type":"Organization"}</script>`;
    const product =
      `<script type="application/ld+json">{"@type":"Product","name":"Block 101"}</script>`;
    const html = pad.repeat(100) + product +
      `<meta property="og:title" content="OG Fallback">`;
    expect(extractMetadata(html, PAGE).title).toBe("OG Fallback");
  });

  it("tolerates JSON-LD that is not an object at all", () => {
    for (const body of [`"a string"`, `42`, `null`, `[]`, `[[[]]]`, `{}`]) {
      const html = `<head><script type="application/ld+json">${body}</script>
        <meta property="og:title" content="Fallback"></head>`;
      expect(extractMetadata(html, PAGE).title).toBe("Fallback");
    }
  });

  it("reads a ld+json script whose type carries a charset or odd casing", () => {
    const html = `<script type="Application/LD+JSON; charset=utf-8">
      {"@type":"Product","name":"Cased"}</script>`;
    expect(extractMetadata(html, PAGE).title).toBe("Cased");
  });

  it("does not decode HTML entities inside a JSON-LD block", () => {
    // Script content is raw text in HTML: a browser does not entity-decode it,
    // and neither may we, or "&amp;" would corrupt the JSON we parse.
    const html = `<script type="application/ld+json">
      {"@type":"Product","name":"Tom &amp; Jerry"}</script>`;
    expect(extractMetadata(html, PAGE).title).toBe("Tom &amp; Jerry");
  });

  it("ignores a script that is not ld+json", () => {
    const html = `<head><script type="application/json">
      {"@type":"Product","name":"Not LD"}</script>
      <meta property="og:title" content="OG Wins"></head>`;
    expect(extractMetadata(html, PAGE).title).toBe("OG Wins");
  });

  it("ignores a non-string name and falls through", () => {
    const html = `<head><script type="application/ld+json">
      {"@type":"Product","name":{"@value":"Objectified"},"description":["a","b"]}</script>
      <meta property="og:title" content="OG Wins"><meta property="og:description" content="OG Desc"></head>`;
    const r = extractMetadata(html, PAGE);
    expect(r.title).toBe("OG Wins");
    expect(r.description).toBe("OG Desc");
  });

  it("falls through to Open Graph when the Product name is only whitespace", () => {
    const html = `<head><script type="application/ld+json">
      {"@type":"Product","name":"   "}</script>
      <meta property="og:title" content="OG Wins"></head>`;
    expect(extractMetadata(html, PAGE).title).toBe("OG Wins");
  });

  it("takes the first entry of a JSON-LD image array", () => {
    const html = `<script type="application/ld+json">
      {"@type":"Product","name":"I","image":["/a.jpg","/b.jpg"]}</script>`;
    expect(extractMetadata(html, PAGE).imageUrl).toBe("https://shop.example.com/a.jpg");
  });

  it("never resolves an empty JSON-LD image into the page URL itself", () => {
    const html = `<head><script type="application/ld+json">
      {"@type":"Product","name":"I","image":""}</script>
      <meta property="og:image" content="/real.jpg"></head>`;
    expect(extractMetadata(html, PAGE).imageUrl).toBe("https://shop.example.com/real.jpg");
  });
});

// ---------------------------------------------------------------------------
// Image URLs. Task 5 revalidates these for SSRF; this layer's job is to refuse
// anything that is not a fetchable http(s) URL.
// ---------------------------------------------------------------------------

describe("image URLs", () => {
  const img = (content: string, page = PAGE) =>
    extractMetadata(`<meta property="og:image" content="${content}">`, page).imageUrl;

  it("absolutises a relative path against the page URL", () => {
    expect(img("/img/a.jpg")).toBe("https://shop.example.com/img/a.jpg");
    expect(img("a.jpg")).toBe("https://shop.example.com/p/a.jpg");
    expect(img("../up.jpg")).toBe("https://shop.example.com/up.jpg");
  });

  it("resolves a protocol-relative URL against the page's scheme", () => {
    expect(img("//cdn.example.net/a.jpg")).toBe("https://cdn.example.net/a.jpg");
  });

  it("keeps an absolute URL on another host", () => {
    expect(img("https://cdn.other.example/a.jpg")).toBe("https://cdn.other.example/a.jpg");
  });

  it("drops a javascript: image", () => {
    expect(img("javascript:alert(1)")).toBeUndefined();
  });

  it("drops a data: image", () => {
    expect(img("data:image/png;base64,iVBORw0KGgo=")).toBeUndefined();
  });

  it("drops other non-http schemes", () => {
    for (const scheme of ["file:///etc/passwd", "ftp://h/a.jpg", "blob:https://x/y", "vbscript:x"]) {
      expect(img(scheme)).toBeUndefined();
    }
  });

  it("drops an empty or whitespace-only image", () => {
    expect(img("")).toBeUndefined();
    expect(img("   ")).toBeUndefined();
  });

  it("drops an absurdly long image URL", () => {
    expect(img(`https://cdn.example.net/${"a".repeat(4000)}.jpg`)).toBeUndefined();
  });

  it("drops the image but keeps the text when the page URL will not parse", () => {
    const html = `<head><meta property="og:title" content="T">
      <meta property="og:image" content="/a.jpg"></head>`;
    const r = extractMetadata(html, "not a url");
    expect(r.title).toBe("T");
    expect(r.imageUrl).toBeUndefined();
  });

  it("trims surrounding whitespace before resolving", () => {
    expect(img("  /img/a.jpg  ")).toBe("https://shop.example.com/img/a.jpg");
  });
});

// ---------------------------------------------------------------------------
// Hostile and malformed HTML. The page is whatever the pasted URL served.
// ---------------------------------------------------------------------------

describe("hostile HTML", () => {
  it("prefers the document title over an SVG icon title that appears first", () => {
    const html = `<html><body><svg><title>icon</title></svg></body>
      <head><title>Real Doc Title</title></head></html>`;
    expect(extractMetadata(html, PAGE).title).toBe("Real Doc Title");
  });

  it("ignores metadata parked inside an inert <template>", () => {
    const html = `<head><template><meta property="og:title" content="Templated">
      </template><meta property="og:title" content="Real"></head>`;
    expect(extractMetadata(html, PAGE).title).toBe("Real");
  });

  it("takes the first of duplicated meta tags", () => {
    const html = `<head><meta property="og:title" content="First">
      <meta property="og:title" content="Second"></head>`;
    expect(extractMetadata(html, PAGE).title).toBe("First");
  });

  it("skips a duplicate that carries no content attribute at all", () => {
    const html = `<head><meta property="og:title"><meta property="og:title" content="Real"></head>`;
    expect(extractMetadata(html, PAGE).title).toBe("Real");
  });

  it("matches meta tags and property values case-insensitively", () => {
    const html = `<HEAD><META PROPERTY="OG:TITLE" CONTENT="Shouty"></HEAD>`;
    expect(extractMetadata(html, PAGE).title).toBe("Shouty");
  });

  it("decodes HTML entities in a content attribute", () => {
    const html = `<meta property="og:title" content="Caf&eacute; &amp; Co &lt;b&gt;">`;
    expect(extractMetadata(html, PAGE).title).toBe("Café & Co <b>");
  });

  it("ignores metadata inside an HTML comment", () => {
    const html = `<head><!-- <meta property="og:title" content="Commented"> -->
      <meta property="og:title" content="Real"></head>`;
    expect(extractMetadata(html, PAGE).title).toBe("Real");
  });

  it("falls through an empty or whitespace-only og:title", () => {
    expect(extractMetadata(
      `<head><meta property="og:title" content=""><title>Doc</title></head>`, PAGE
    ).title).toBe("Doc");
    expect(extractMetadata(
      `<head><meta property="og:title" content="   "><title>Doc</title></head>`, PAGE
    ).title).toBe("Doc");
  });

  it("reads metadata out of a page with no head element", () => {
    expect(extractMetadata(`<meta property="og:title" content="Headless">`, PAGE).title)
      .toBe("Headless");
  });

  it("reads a ld+json block that appears in the body", () => {
    const html = `<body><script type="application/ld+json">
      {"@type":"Product","name":"Late"}</script></body>`;
    expect(extractMetadata(html, PAGE).title).toBe("Late");
  });

  it("survives an unterminated script tag", () => {
    const html = `<head><meta property="og:title" content="T">
      <script type="application/ld+json">{"@type":"Product","name":"Cut off`;
    expect(() => extractMetadata(html, PAGE)).not.toThrow();
    expect(extractMetadata(html, PAGE).title).toBe("T");
  });

  it("returns an empty object for junk input without throwing", () => {
    const junk = [
      "",
      "   ",
      "<<<>>>",
      "<html",
      "&&&;;;",
      "\u0000\u0001\u0002",
      "<script>",
      "</head></html>",
      "<!--",
    ];
    for (const html of junk) {
      expect(() => extractMetadata(html, PAGE)).not.toThrow();
      expect(extractMetadata(html, PAGE)).toStrictEqual({});
    }
  });

  it("does not throw on a hostile page URL", () => {
    for (const page of ["", "not a url", "javascript:x", "http://", "\u0000"]) {
      expect(() => extractMetadata(`<meta property="og:image" content="/a.jpg">`, page))
        .not.toThrow();
    }
  });
});

// ---------------------------------------------------------------------------
// Resource exhaustion. Task 6 fetches up to 2 MB of attacker-chosen HTML and
// calls this synchronously inside a Server Action, so a pathological page must
// cost milliseconds, not seconds, and must never overflow the stack.
// ---------------------------------------------------------------------------

describe("pathological documents", () => {
  it("parses 8000 unclosed tags quickly", { timeout: 4000 }, () => {
    // node-html-parser's default unclosed-tag repair is super-linear: this
    // input takes ~36s with the library's defaults and ~10ms without them.
    // 40 KB of HTML is far below Task 6's 2 MB fetch cap.
    const html = "<div>".repeat(8000) + `<meta property="og:title" content="Deep">`;
    const r = extractMetadata(html, PAGE);
    expect(r.title).toBe("Deep");
  });

  it("reads metadata out of 100000 levels of nesting without overflowing the stack",
    { timeout: 10000 }, () => {
      const depth = 100_000;
      const html =
        "<div>".repeat(depth) + `<meta property="og:title" content="Buried">` +
        "</div>".repeat(depth);
      expect(extractMetadata(html, PAGE).title).toBe("Buried");
    });

  it("survives JSON-LD nested 200000 levels deep", () => {
    const depth = 200_000;
    const html = `<head><script type="application/ld+json">${
      "[".repeat(depth)}1${"]".repeat(depth)}</script>
      <meta property="og:title" content="Survived"></head>`;
    expect(extractMetadata(html, PAGE).title).toBe("Survived");
  });

  it("stops at an unterminated comment instead of rescanning it", { timeout: 2000 }, () => {
    // node-html-parser's tokeniser rescans to end-of-document once per opener
    // when no `-->` follows: 391 KB of these costs ~10s, and 2 MB -- Task 6's
    // fetch cap -- costs minutes. Everything after the opener is comment
    // content per the spec's eof-in-comment rule, so it is also invisible.
    const html =
      `<meta property="og:title" content="Before the comment">` +
      "<!--".repeat(100_000) +
      `<meta property="og:description" content="Inside the comment">`;
    const r = extractMetadata(html, PAGE);
    expect(r.title).toBe("Before the comment");
    expect(r.description).toBeUndefined();
  });

  it("stops at an unterminated CDATA section instead of rescanning it",
    { timeout: 2000 }, () => {
      const html =
        `<meta property="og:title" content="Before the cdata">` +
        "<![CDATA[".repeat(100_000);
      expect(extractMetadata(html, PAGE).title).toBe("Before the cdata");
    });

  it("keeps reading past thousands of properly closed comments", () => {
    const html = "<!-- pad -->".repeat(5000) +
      `<meta property="og:title" content="After the comments">`;
    expect(extractMetadata(html, PAGE).title).toBe("After the comments");
  });

  it("keeps the rest of the page when a booby-trapped title overflows the stack", () => {
    // `.text` recurses per level, and 5,000 is already past the limit.
    const depth = 20_000;
    const html = `<head><meta property="og:title" content="OG Survives">` +
      `<title>${"<div>".repeat(depth)}boom${"</div>".repeat(depth)}</title></head>`;
    expect(extractMetadata(html, PAGE).title).toBe("OG Survives");
  });

  it("handles a page with thousands of meta tags", { timeout: 4000 }, () => {
    const html = `<meta property="og:title" content="First">` +
      `<meta property="og:x" content="pad">`.repeat(20_000);
    expect(extractMetadata(html, PAGE).title).toBe("First");
  });
});

// ---------------------------------------------------------------------------
// Values that would break the destination. Title and description land in
// `wishlist_items` (title text, 1..200 chars) via a zod schema that caps title
// at 200 and description at 1000. A value that cannot be saved is worse than
// no value: it blocks the save the design promises never to block.
// ---------------------------------------------------------------------------

describe("output hygiene", () => {
  it("caps the title at the length the form accepts", () => {
    const html = `<meta property="og:title" content="${"a".repeat(5000)}">`;
    // Read from the schema, not repeated here: if someone raises the form's
    // limit and not the extractor's, this is where they find out.
    expect(extractMetadata(html, PAGE).title).toHaveLength(TITLE_MAX_LENGTH);
    expect(TITLE_MAX_LENGTH).toBe(200);
  });

  it("caps the description at the length the form accepts", () => {
    const html = `<meta property="og:description" content="${"a".repeat(5000)}">`;
    expect(extractMetadata(html, PAGE).description).toHaveLength(DESCRIPTION_MAX_LENGTH);
    expect(DESCRIPTION_MAX_LENGTH).toBe(1000);
  });

  it("strips a NUL byte, which a Postgres text column cannot store", () => {
    const html = `<meta property="og:title" content="Ti\u0000tle">`;
    const title = extractMetadata(html, PAGE).title;
    expect(title).not.toContain("\u0000");
    expect(title).toBe("Ti tle");
  });

  it("strips an unpaired surrogate", () => {
    const html = `<meta property="og:title" content="Bro\uD800ken">`;
    expect(extractMetadata(html, PAGE).title).toBe("Broken");
  });

  it("keeps a legitimate surrogate pair intact", () => {
    const html = `<meta property="og:title" content="Gift \u{1F381}">`;
    expect(extractMetadata(html, PAGE).title).toBe("Gift \u{1F381}");
  });

  it("collapses newlines and tabs out of a multi-line document title", () => {
    const html = `<title>\n  Spread\tover\n  lines\n</title>`;
    expect(extractMetadata(html, PAGE).title).toBe("Spread over lines");
  });

  it("omits keys entirely rather than returning undefined values", () => {
    const r = extractMetadata(`<meta property="og:title" content="Only a title">`, PAGE);
    expect(r).toStrictEqual({ title: "Only a title" });
    expect(Object.keys(r)).toEqual(["title"]);
  });
});

// ---------------------------------------------------------------------------
// reduceToMarkup: the pre-pass that decides what the parser ever sees. Asserted
// on its exact output, so these do not depend on a timing margin.
// ---------------------------------------------------------------------------

describe("reduceToMarkup", () => {
  it("returns a document with nothing to drop byte for byte", () => {
    const html =
      `<html><head><title>T</title><meta property="og:title" content="x">` +
      `<script type="application/ld+json">{"a":1}</script></head></html>`;
    expect(reduceToMarkup(html)).toBe(html);
  });

  it("drops character data but keeps every tag", () => {
    expect(reduceToMarkup("<p>hello</p>")).toBe("<p></p>");
    expect(reduceToMarkup("<b></b>a".repeat(3))).toBe("<b></b>".repeat(3));
  });

  it("keeps a quoted > inside an attribute rather than cutting the tag in half", () => {
    const html = `<meta property="og:description" content="a > b">`;
    expect(reduceToMarkup(html)).toBe(html);
    expect(extractMetadata(html, PAGE).description).toBe("a > b");
  });

  it("keeps raw-text content verbatim", () => {
    const html = `<script>var a = "<b>x</b>";</script><style>.a{content:"<i>"}</style>`;
    expect(reduceToMarkup(html)).toBe(html);
  });

  it("drops a comment and everything after an unterminated one", () => {
    expect(reduceToMarkup(`<a><!-- gone --><b>`)).toBe("<a><b>");
    expect(reduceToMarkup(`<a><!--` + "<!--".repeat(999))).toBe("<a>");
    expect(reduceToMarkup(`<a><![CDATA[x]]><b>`)).toBe("<a><b>");
  });

  it("leaves a bare < in text alone rather than treating it as a tag", () => {
    expect(reduceToMarkup("<p>1 < 2</p>")).toBe("<p></p>");
  });
});

// ---------------------------------------------------------------------------
// A `<!--` only opens a comment in the data state. Treating one inside a
// script body or an attribute value as a comment discards the rest of an
// ordinary page, which is a correctness regression, not a mitigation.
// ---------------------------------------------------------------------------

describe("comment-like text that is not a comment", () => {
  it("keeps the page when a script body contains <!--", () => {
    const html = `<script>var a="<!--";</script><meta property="og:title" content="Real">`;
    expect(extractMetadata(html, PAGE).title).toBe("Real");
  });

  it("keeps the page when an attribute value contains <!--", () => {
    const html =
      `<meta property="og:description" content="a <!-- b">` +
      `<meta property="og:title" content="Real">`;
    const r = extractMetadata(html, PAGE);
    expect(r.title).toBe("Real");
    expect(r.description).toBe("a <!-- b");
  });

  it("keeps the JSON-LD when one of its strings contains <![CDATA[", () => {
    const html =
      `<script type="application/ld+json">` +
      `{"@type":"Product","name":"Bracket <![CDATA[ Toy",` +
      `"offers":{"price":"42.50","priceCurrency":"USD"}}</script>`;
    const r = extractMetadata(html, PAGE);
    expect(r.title).toBe("Bracket <![CDATA[ Toy");
    expect(r.price).toBe(42.5);
  });

  it("keeps the page when a script body contains an unterminated comment", () => {
    const html = `<script>/* <!-- */ var a = 1;</script><meta property="og:title" content="Real">`;
    expect(extractMetadata(html, PAGE).title).toBe("Real");
  });
});

// ---------------------------------------------------------------------------
// Sibling text nodes. node-html-parser appends one by calling remove() on a
// node whose parentNode is already set, and remove() filters the parent's
// whole child list -- quadratic in text nodes per parent. 313 KB costs 6.4
// seconds unreduced; 2 MB costs about five minutes.
// ---------------------------------------------------------------------------

describe("sibling text nodes", () => {
  it("parses 2 MB of alternating tags and text quickly", { timeout: 5000 }, () => {
    const html =
      `<meta property="og:title" content="Findable">` + "<b></b>a".repeat(262_144);
    expect(extractMetadata(html, PAGE).title).toBe("Findable");
  });

  it("parses 2 MB of CDATA text nodes quickly", { timeout: 5000 }, () => {
    const html =
      `<meta property="og:title" content="Findable">` + "<![CDATA[a]]>".repeat(161_319);
    expect(extractMetadata(html, PAGE).title).toBe("Findable");
  });

  it("is not bypassed by hiding the payload behind an unclosed <title>",
    { timeout: 5000 }, () => {
      // <title> content is preserved verbatim by the reduction, so the parser
      // must be told it is raw text or it walks the payload as markup.
      const html =
        `<meta property="og:title" content="Findable"><title>` + "<b></b>a".repeat(262_144);
      expect(extractMetadata(html, PAGE).title).toBe("Findable");
    });

  it("is not bypassed by an unterminated quoted attribute", { timeout: 5000 }, () => {
    const html =
      `<meta property="og:title" content="Findable"><a x="` + "<b></b>a".repeat(262_144);
    expect(extractMetadata(html, PAGE).title).toBe("Findable");
  });

  it("is not bypassed by a bare < in front of the payload", { timeout: 5000 }, () => {
    const html =
      `<meta property="og:title" content="Findable">` + "< b></b>a".repeat(262_144);
    expect(extractMetadata(html, PAGE).title).toBe("Findable");
  });

  it("reads a realistic 320 KB page unchanged, and quickly", { timeout: 2000 }, () => {
    // The control for all of the above: nested markup at the same byte count
    // is 500x cheaper than the crafted shape, so the mitigation must not be a
    // size limit, and it must not change this answer.
    const html =
      `<html><head><title>Doc &amp; Title</title>` +
      `<meta property="og:title" content="OG &eacute; Title">` +
      `<meta property="og:description" content="a > b and 1 < 2">` +
      `<meta property="og:image" content="/img/a.jpg">` +
      `<script type="application/ld+json">{"@type":"Product","name":"Real Product",` +
      `"offers":{"price":"42.50","priceCurrency":"USD"}}</script>` +
      `<style>.a{content:"<b>"}</style></head><body>` +
      '<div class="p"><span>item</span><p>desc text here</p></div>'.repeat(5600) +
      `</body></html>`;
    expect(html.length).toBeGreaterThan(320_000);
    expect(extractMetadata(html, PAGE)).toStrictEqual({
      title: "Real Product",
      price: 42.5,
      imageUrl: "https://shop.example.com/img/a.jpg",
      description: "a > b and 1 < 2",
    });
  });
});

// ---------------------------------------------------------------------------
// The remaining work ceilings, pinned from both sides so the numbers are
// behaviour rather than decoration.
// ---------------------------------------------------------------------------

describe("work ceilings", () => {
  const buried = (nodes: number) =>
    extractMetadata(
      "<b>".repeat(nodes) + `<meta property="og:title" content="Bottom">`,
      PAGE,
    ).title;

  it("walks to a meta tag at the bottom of its DOM budget", { timeout: 5000 }, () => {
    expect(buried(249_998)).toBe("Bottom");
  });

  it("stops one node past its DOM budget", { timeout: 5000 }, () => {
    expect(buried(249_999)).toBeUndefined();
  });

  const inArray = (padding: number) =>
    extractMetadata(
      `<script type="application/ld+json">[${"0,".repeat(padding)}` +
        `{"@type":"Product","name":"Last"}]</script>`,
      PAGE,
    ).title;

  it("finds a Product at the bottom of its JSON budget", { timeout: 5000 }, () => {
    expect(inArray(99_998)).toBe("Last");
  });

  it("stops one node past its JSON budget", { timeout: 5000 }, () => {
    expect(inArray(99_999)).toBeUndefined();
  });
});
