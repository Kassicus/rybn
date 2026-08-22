import { NodeType, parse, type HTMLElement, type Node } from "node-html-parser";

export interface LinkMetadata {
  title?: string;
  description?: string;
  price?: number;
  imageUrl?: string;
}

/**
 * The only currency this app can render. Every price in the UI is printed
 * behind a hard-coded `$` (`WishlistItemCard`, the item page, the dashboard,
 * the gift tracker) and `wishlist_items.price` is a bare `numeric` with no
 * currency column. So a price we cannot prove is USD would be *displayed* as
 * USD, which is the wrong-price harm the design forbids.
 */
const ACCEPTED_CURRENCY = "USD";

/**
 * A sanity ceiling. Nothing on a wishlist costs a million dollars; a number
 * this large is far more likely to be a parse artefact than a gift.
 */
const MAX_PRICE = 1_000_000;

/**
 * Prices must be written the way schema.org asks for them: digits, with `.`
 * as the decimal point and no readability separators. Anything else is
 * ambiguous -- `"1,299.99"` and `"1.299,99"` are the same number in different
 * locales, `"$42.50"` carries a currency claim we did not ask for, and
 * `"Now 19.99, was 29.99"` is two numbers. Ambiguous means dropped.
 */
const PLAIN_DECIMAL = /^\d+(?:\.\d+)?$/;

/**
 * More offers than a real product page carries. A list this long is either a
 * whole catalogue or an attack, and either way the "one unambiguous price"
 * question has no honest answer.
 */
const MAX_OFFERS = 50;

/** Matches the caps in `lib/schemas/wishlist.ts` and the `title_length` check
 * constraint on `wishlist_items`. A value the form would reject is worse than
 * no value: the design promises a failed lookup never blocks saving. */
const MAX_TITLE_LENGTH = 200;
const MAX_DESCRIPTION_LENGTH = 1000;

/** Conventional practical URL ceiling. Real image URLs are a few hundred
 * bytes; something far longer is padding, not a picture. */
const MAX_IMAGE_URL_LENGTH = 2048;

/**
 * Work ceilings. Task 6 hands us up to 2 MB of attacker-chosen HTML and calls
 * this synchronously inside a Server Action, so every loop here is bounded.
 *
 * Only `MAX_LD_SCRIPTS` is observable, and the tests pin it from both sides.
 * The other two sit above anything 2 MB of input can reach, and the loops they
 * guard are already linear and already terminate, so no test can tell whether
 * they are here -- they are a guarantee against a future edit, not a live
 * defence. Said plainly so nobody mistakes them for tested behaviour.
 */
const MAX_DOM_NODES = 1_000_000;
const MAX_LD_SCRIPTS = 100;
const MAX_JSON_NODES = 100_000;

/** Subtrees a browser does not treat as page metadata. `<svg><title>` is an
 * accessible name for an icon -- taking it would title a gift "icon" -- and
 * `<template>` content is inert until cloned. */
const INERT_SUBTREES = new Set(["svg", "template"]);

/** Openers whose region the parser finds with a lazy `[\s\S]*?` scan. */
const BOGUS_COMMENTS: ReadonlyArray<readonly [string, string]> = [
  ["<!--", "-->"],
  ["<![CDATA[", "]]>"],
];

/**
 * C0 and C1 control characters, minus tab/newline/carriage return which the
 * whitespace collapse below handles. A NUL in particular cannot be stored in a
 * Postgres `text` column at all, so leaving one in a title turns a helpful
 * auto-fill into a save that fails.
 */
const CONTROL_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/g;

/** Surrogate code units with no partner. Postgres rejects these too. */
const LONE_SURROGATE =
  /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g;

/**
 * Normalise a text value, or drop it.
 *
 * Whitespace is collapsed rather than preserved: these values land in a
 * single-line input and a short textarea, and a title spread over four lines
 * of source is one title.
 */
function cleanText(raw: unknown, maxLength: number): string | undefined {
  if (typeof raw !== "string") return undefined;
  const cleaned = raw
    .replace(CONTROL_CHARS, " ")
    .replace(LONE_SURROGATE, "")
    .replace(/\s+/g, " ")
    .trim();
  if (cleaned.length === 0) return undefined;
  return cleaned.length > maxLength
    ? cleaned.slice(0, maxLength).trimEnd()
    : cleaned;
}

/**
 * A price, or nothing. Never a guess.
 *
 * Both halves must be present and unambiguous: an amount in the one format
 * schema.org specifies, and a currency this app can actually render. An absent
 * currency is not permission to assume USD -- it is a page that never said.
 */
function toPrice(amount: unknown, currency: unknown): number | undefined {
  if (typeof currency !== "string") return undefined;
  if (currency.trim().toUpperCase() !== ACCEPTED_CURRENCY) return undefined;

  let value: number;
  if (typeof amount === "number") {
    value = amount;
  } else if (typeof amount === "string") {
    const trimmed = amount.trim();
    // `\d` without the `u` flag is ASCII-only, so fullwidth and Arabic-Indic
    // digits -- which schema.org warns about by name -- are refused here.
    if (!PLAIN_DECIMAL.test(trimmed)) return undefined;
    value = Number(trimmed);
  } else {
    return undefined;
  }

  if (!Number.isFinite(value) || value <= 0 || value > MAX_PRICE) return undefined;
  return value;
}

/** Absolutise an image reference, or drop it. */
function toImageUrl(raw: unknown, pageUrl: string): string | undefined {
  if (typeof raw !== "string") return undefined;
  const trimmed = raw.trim();
  if (trimmed.length === 0) return undefined;

  let resolved: URL;
  try {
    resolved = new URL(trimmed, pageUrl);
  } catch {
    return undefined;
  }

  // Task 5 revalidates this for SSRF before fetching it. This layer's job is
  // narrower: refuse anything that is not a fetchable web address, so a
  // `javascript:` or `data:` URI never reaches a column that other code puts
  // in an `src`.
  if (resolved.protocol !== "http:" && resolved.protocol !== "https:") return undefined;

  const href = resolved.toString();
  return href.length > MAX_IMAGE_URL_LENGTH ? undefined : href;
}

/**
 * Cut the document at its first unterminated comment, before the parser runs.
 *
 * node-html-parser tokenises with one regex whose first alternative is
 * `<!--[\s\S]*?-->`. When an opener has a closer, the lazy scan swallows the
 * whole span in a single match and skips every opener inside it -- linear, and
 * measured at 1 ms for 50,000 of them. When an opener has NO closer, the scan
 * runs to the end of the document, fails, and the engine restarts at the next
 * opener: quadratic. Measured at 195 KB of `<!--`, that is 2.5 seconds; at 391
 * KB, 10 seconds; extrapolated to Task 6's 2 MB fetch cap, several minutes of
 * one CPU inside a Server Action. `<![CDATA[`/`]]>` is the same shape.
 *
 * Cutting there is what the HTML spec's eof-in-comment rule says the document
 * means anyway: everything after an unterminated `<!--` IS comment content.
 * A well-formed page comes back byte-identical, and the walk is O(n) because
 * each `indexOf` starts where the previous span ended.
 */
function truncateAtUnterminatedComment(html: string): string {
  let out = html;
  for (const [open, close] of BOGUS_COMMENTS) {
    let cursor = 0;
    for (;;) {
      const start = out.indexOf(open, cursor);
      if (start === -1) break;
      const end = out.indexOf(close, start + open.length);
      if (end === -1) {
        out = out.slice(0, start);
        break;
      }
      cursor = end + close.length;
    }
  }
  return out;
}

interface PageParts {
  documentTitle?: string;
  /** Keyed by the lower-cased `property` or `name` attribute; first wins. */
  metas: Map<string, string>;
  /** Raw, undecoded bodies of `application/ld+json` scripts, in document order. */
  ldJson: string[];
}

/**
 * One iterative pre-order pass over the document.
 *
 * Iterative rather than `querySelector` on purpose: node-html-parser's
 * selector engine recurses per level and throws `RangeError: Maximum call
 * stack size exceeded` somewhere between 5,000 and 20,000 levels of nesting --
 * well inside a 2 MB page. An explicit stack has no such ceiling, and one pass
 * is cheaper than the eight selector queries this would otherwise need.
 */
function collect(root: HTMLElement): PageParts {
  const metas = new Map<string, string>();
  const ldJson: string[] = [];
  let documentTitle: string | undefined;
  let budget = MAX_DOM_NODES;

  const stack: Node[] = [root];
  while (stack.length > 0 && budget-- > 0) {
    const node = stack.pop()!;

    if (node.nodeType === NodeType.ELEMENT_NODE) {
      const element = node as HTMLElement;
      // `lowerCaseTagName` is off, so the source's casing survives; HTML tag
      // names are case-insensitive.
      const tag = element.rawTagName?.toLowerCase();

      if (tag !== undefined && INERT_SUBTREES.has(tag)) continue; // do not descend

      if (tag === "meta") {
        const key = (element.getAttribute("property") ?? element.getAttribute("name"))
          ?.trim()
          .toLowerCase();
        const content = element.getAttribute("content");
        if (key !== undefined && key.length > 0 && content !== undefined && !metas.has(key)) {
          metas.set(key, content);
        }
      } else if (tag === "title") {
        // `.text` walks the element's subtree recursively, so a `<title>` with
        // a few thousand nested tags inside it overflows the stack. A page can
        // do that to us; it must cost us the document title, not the page.
        if (documentTitle === undefined) {
          try {
            documentTitle = element.text;
          } catch {
            documentTitle = undefined;
          }
        }
      } else if (tag === "script" && ldJson.length < MAX_LD_SCRIPTS) {
        const type = element.getAttribute("type")?.trim().toLowerCase();
        // Per HTML, a type is matched ASCII case-insensitively, and pages do
        // append `; charset=utf-8`.
        if (type !== undefined && type.startsWith("application/ld+json")) {
          // `rawText`, not `text`: script content is raw text in HTML, so a
          // browser does not entity-decode it and neither may we -- decoding
          // would rewrite the JSON before we parse it.
          ldJson.push(element.rawText);
        }
      }
    }

    const children = node.childNodes;
    for (let i = children.length - 1; i >= 0; i--) stack.push(children[i]);
  }

  return { documentTitle, metas, ldJson };
}

/**
 * The first schema.org `Product` in document order, or nothing.
 *
 * Descends through arrays and `@graph` only -- the two containers the design
 * names. Deliberately NOT through arbitrary nested objects: a page's
 * `review.itemReviewed` or a "customers also bought" rail are Products too,
 * and reaching one of those would attach a stranger's price to this gift.
 *
 * Iterative and budgeted, because `JSON.parse` will happily build a structure
 * 200,000 levels deep and a recursive walk of it overflows the stack.
 */
function findProduct(value: unknown): Record<string, unknown> | undefined {
  let budget = MAX_JSON_NODES;
  const stack: unknown[] = [value];

  while (stack.length > 0) {
    if (budget-- <= 0) return undefined;
    const node = stack.pop();

    if (Array.isArray(node)) {
      for (let i = node.length - 1; i >= 0; i--) stack.push(node[i]);
      continue;
    }
    if (node === null || typeof node !== "object") continue;

    const obj = node as Record<string, unknown>;
    const type = obj["@type"];
    if (type === "Product" || (Array.isArray(type) && type.includes("Product"))) {
      return obj;
    }
    if (obj["@graph"] !== undefined) stack.push(obj["@graph"]);
  }

  return undefined;
}

/**
 * The one price this product unambiguously has.
 *
 * A variant list whose prices disagree has no single answer, so it produces
 * none. `AggregateOffer`'s `lowPrice`/`highPrice` are deliberately not read
 * for the same reason: a range is not a price.
 */
function priceFromProduct(product: Record<string, unknown>): number | undefined {
  const raw = product.offers;
  const offers = Array.isArray(raw) ? raw : [raw];
  if (offers.length > MAX_OFFERS) return undefined;

  let found: number | undefined;
  for (const offer of offers) {
    if (offer === null || typeof offer !== "object" || Array.isArray(offer)) continue;
    const o = offer as Record<string, unknown>;
    const price = toPrice(o.price, o.priceCurrency);
    if (price === undefined) continue;
    if (found !== undefined && found !== price) return undefined; // ambiguous
    found = price;
  }
  return found;
}

/**
 * Read `{ title, description, price, imageUrl }` out of a page.
 *
 * Every field is optional and partial success is the normal case. The HTML is
 * whatever server the pasted URL pointed at chose to return, so this function
 * treats it as hostile: it never throws, it never blocks, and where a value is
 * ambiguous it returns nothing rather than a guess.
 */
export function extractMetadata(html: string, pageUrl: string): LinkMetadata {
  try {
    return read(html, pageUrl);
  } catch {
    // Last resort, and honestly untested: every throw this module was able to
    // provoke -- a `<title>` deep enough to overflow `.text`, an unparseable
    // page URL, malformed JSON-LD -- is now caught closer to where it happens,
    // so removing this catch breaks nothing in the suite. It stays because the
    // contract is "never throws" and the parser is third-party code.
    return {};
  }
}

function read(html: string, pageUrl: string): LinkMetadata {
  // `parseNoneClosedTags` disables the library's repair pass for unclosed
  // tags, which re-parents every orphaned child one stack level at a time and
  // is super-linear: 8,000 unclosed `<div>`s -- 40 KB, a fiftieth of Task 6's
  // fetch cap -- takes ~36 seconds with it on and ~10 ms with it off. We read
  // meta tags and script bodies, so the repaired tree shape buys us nothing.
  const root = parse(truncateAtUnterminatedComment(html), { parseNoneClosedTags: true });
  const { documentTitle, metas, ldJson } = collect(root);
  const out: LinkMetadata = {};

  // 1. JSON-LD. The only source that reliably carries a price with a currency.
  const product = firstProduct(ldJson);
  if (product !== undefined) {
    out.title = cleanText(product.name, MAX_TITLE_LENGTH);
    out.description = cleanText(product.description, MAX_DESCRIPTION_LENGTH);
    out.price = priceFromProduct(product);
    const image = Array.isArray(product.image) ? product.image[0] : product.image;
    out.imageUrl = toImageUrl(image, pageUrl);
  }

  // 2. Open Graph, 3. Twitter card, 4. the document itself.
  out.title ??=
    cleanText(metas.get("og:title"), MAX_TITLE_LENGTH) ??
    cleanText(metas.get("twitter:title"), MAX_TITLE_LENGTH) ??
    cleanText(documentTitle, MAX_TITLE_LENGTH);

  out.description ??=
    cleanText(metas.get("og:description"), MAX_DESCRIPTION_LENGTH) ??
    cleanText(metas.get("twitter:description"), MAX_DESCRIPTION_LENGTH) ??
    cleanText(metas.get("description"), MAX_DESCRIPTION_LENGTH);

  out.price ??= toPrice(metas.get("og:price:amount"), metas.get("og:price:currency"));

  out.imageUrl ??=
    toImageUrl(metas.get("og:image"), pageUrl) ??
    toImageUrl(metas.get("twitter:image"), pageUrl);

  for (const key of Object.keys(out) as (keyof LinkMetadata)[]) {
    if (out[key] === undefined) delete out[key];
  }
  return out;
}

/**
 * The first Product across all the page's JSON-LD blocks.
 *
 * Every field comes from this one object. Pages carry several Products --
 * the item, its accessories, a "related" rail -- and mixing fields across
 * them would pair one product's title with another's price. Taking the first
 * in document order is a rule; picking per field would be a guess.
 */
function firstProduct(ldJson: string[]): Record<string, unknown> | undefined {
  for (const raw of ldJson) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      continue; // a broken block must not lose us the rest of the page
    }
    const product = findProduct(parsed);
    if (product !== undefined) return product;
  }
  return undefined;
}
