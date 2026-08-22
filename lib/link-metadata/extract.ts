import { NodeType, parse, type HTMLElement, type Node } from "node-html-parser";
import {
  DESCRIPTION_MAX_LENGTH,
  TITLE_MAX_LENGTH,
} from "@/lib/schemas/wishlist";

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
 * One cent. The column is `numeric` and would happily store `0.0000001`, but
 * every render site formats with `.toFixed(2)`, so anything below this reaches
 * the user as `$0.00` -- a price that says "free" about something that is not.
 */
const MIN_PRICE = 0.01;

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

/**
 * The caps come from `lib/schemas/wishlist.ts`, which is also what the form
 * validates against and what the `title_length` check constraint on
 * `wishlist_items` enforces. Imported rather than repeated: a value the form
 * would reject is worse than no value, because the design promises a failed
 * lookup never blocks saving, and two copies of a number drift.
 */
const MAX_TITLE_LENGTH = TITLE_MAX_LENGTH;
const MAX_DESCRIPTION_LENGTH = DESCRIPTION_MAX_LENGTH;

/** Conventional practical URL ceiling. Real image URLs are a few hundred
 * bytes; something far longer is padding, not a picture. */
const MAX_IMAGE_URL_LENGTH = 2048;

/**
 * Work ceilings. Task 6 hands us up to 2 MB of attacker-chosen HTML and calls
 * this synchronously inside a Server Action, so every loop here is bounded.
 *
 * All three are reachable inside a 2 MB page and all three are pinned from
 * both sides by tests, so none of them is a number nobody can see. Sizing:
 * after `reduceToMarkup` a node costs at least three bytes (`<b>`), so 2 MB
 * cannot exceed ~700,000 nodes and 250,000 sits far above any real document
 * while staying provable; `MAX_JSON_NODES` is reached by a ~200 KB JSON array.
 */
const MAX_DOM_NODES = 250_000;
const MAX_LD_SCRIPTS = 100;
const MAX_JSON_NODES = 100_000;

/** Subtrees a browser does not treat as page metadata. `<svg><title>` is an
 * accessible name for an icon -- taking it would title a gift "icon" -- and
 * `<template>` content is inert until cloned. */
const INERT_SUBTREES = new Set(["svg", "template"]);

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

  if (!Number.isFinite(value) || value < MIN_PRICE || value > MAX_PRICE) return undefined;
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
 * Elements whose content the parser must not read as markup.
 *
 * The first four are node-html-parser's own defaults. `title` is added because
 * a title is RCDATA in HTML -- a browser does not parse tags inside it -- and
 * because leaving it out is exploitable: `<title>` followed by 313 KB of
 * `<b></b>a` bypasses the reduction below entirely, since the reducer must
 * preserve raw-text content verbatim and the parser would then walk it as
 * markup. Declaring it here makes the two agree, and it also removes the
 * `<title>`-subtree stack overflow at the root instead of catching it.
 */
const BLOCK_TEXT_ELEMENTS = {
  script: true,
  noscript: true,
  style: true,
  pre: true,
  title: true,
} as const;

const RAW_TEXT_ELEMENTS = new Set(Object.keys(BLOCK_TEXT_ELEMENTS));

/**
 * Find the `>` that closes a tag, or -1.
 *
 * Quote-aware, because node-html-parser honours a `>` inside a quoted
 * attribute value (measured: `<meta content="a > b">` yields `a > b`), so a
 * naive scan would cut a legitimate tag in half. If a quote never closes, the
 * parser recovers at the first `>` it saw, so this falls back to the same
 * place rather than running to the end of the document -- otherwise a leading
 * `<a x="` would opt the payload behind it out of the reduction.
 */
function findTagEnd(html: string, start: number): number {
  let quote = 0;
  let firstGt = -1;
  for (let j = start + 1; j < html.length; j++) {
    const c = html.charCodeAt(j);
    if (c === 0x3e && firstGt === -1) firstGt = j;
    if (quote !== 0) {
      if (c === quote) quote = 0;
      continue;
    }
    if (c === 0x22 || c === 0x27) {
      quote = c;
      continue;
    }
    if (c === 0x3e) return j;
  }
  return firstGt;
}

/** The lower-cased tag name at `start`, or "" if there is not one. */
function readTagName(html: string, start: number): string {
  let from = start + 1;
  if (html.charCodeAt(from) === 0x2f) from += 1;
  let to = from;
  while (to < html.length) {
    const c = html.charCodeAt(to);
    const isName =
      (c >= 0x61 && c <= 0x7a) ||
      (c >= 0x41 && c <= 0x5a) ||
      (c >= 0x30 && c <= 0x39) ||
      c === 0x2d ||
      c === 0x3a;
    if (!isName) break;
    to += 1;
  }
  return html.slice(from, to).toLowerCase();
}

/**
 * Strip everything the extractor does not read, before the parser sees it.
 *
 * Keeps every tag byte-for-byte, and keeps the content of raw-text elements
 * byte-for-byte. Drops character data and comments. Nothing this module reads
 * lives in either -- titles and script bodies are raw text, everything else is
 * an attribute -- so the extraction is unchanged and a realistic page comes
 * back with the same answer (asserted in the tests, not assumed).
 *
 * **Why.** node-html-parser appends a text node by calling `remove()` on a
 * node whose constructor already set `parentNode` (`append` ->
 * `resolveInsertable` -> `remove`), and `remove()` filters the parent's entire
 * child list. The cost is therefore quadratic in the number of text nodes
 * under one parent. Measured against the shipped module:
 *
 *     '<b></b>a'.repeat(10_000)     78 KB      303 ms
 *     '<b></b>a'.repeat(20_000)    156 KB    1,456 ms
 *     '<b></b>a'.repeat(40_000)    313 KB    6,444 ms
 *
 * -- about 300 seconds at Task 6's 2 MB cap, from a page with no unclosed tags
 * and no comments. The same tags with the character data removed cost 14 ms,
 * and 1.7 MB of them cost 119 ms, so dropping it turns the curve linear.
 * `<![CDATA[a]]>` reaches the same append path and is dropped here too.
 *
 * This also subsumes the earlier eof-in-comment truncation, and corrects it: a
 * `<!--` only opens a comment in the data state, so one inside a script body
 * or an attribute value is now left alone rather than discarding the rest of
 * the page.
 *
 * Linear: every `indexOf` resumes where the previous span ended.
 */
export function reduceToMarkup(html: string): string {
  const out: string[] = [];
  const length = html.length;
  let i = 0;

  while (i < length) {
    const lt = html.indexOf("<", i);
    if (lt === -1) break; // trailing character data
    i = lt;

    if (html.startsWith("<!--", i)) {
      const end = html.indexOf("-->", i + 4);
      // eof-in-comment: the rest of the document IS the comment.
      if (end === -1) return out.join("");
      i = end + 3;
      continue;
    }
    if (html.startsWith("<![CDATA[", i)) {
      const end = html.indexOf("]]>", i + 9);
      if (end === -1) return out.join("");
      i = end + 3;
      continue;
    }

    const next = html.charCodeAt(i + 1);
    const startsName = (next >= 0x61 && next <= 0x7a) || (next >= 0x41 && next <= 0x5a);
    if (!startsName && next !== 0x2f && next !== 0x21 && next !== 0x3f) {
      i += 1; // a bare "<" in text, which the parser does not treat as a tag
      continue;
    }

    const end = findTagEnd(html, i);
    if (end === -1) {
      // No `>` anywhere after this, so the parser finds no further tags and
      // builds no further nodes. Keeping it verbatim costs nothing.
      out.push(html.slice(i));
      break;
    }
    out.push(html.slice(i, end + 1));
    const name = startsName ? readTagName(html, i) : "";
    i = end + 1;

    if (name !== "" && RAW_TEXT_ELEMENTS.has(name)) {
      // Mirror the parser exactly: it looks for the literal `</name>` spelled
      // as the opening tag spelled it, and runs to the end of the document
      // when that is not there.
      const close = html.indexOf(`</${html.slice(lt + 1, lt + 1 + name.length)}>`, i);
      if (close === -1) {
        out.push(html.slice(i));
        break;
      }
      out.push(html.slice(i, close));
      i = close;
    }
  }

  return out.join("");
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
        // Safe to read without a guard only because `title` is declared a
        // block-text element above: its content is then a single text node, so
        // `.text` does not recurse. Without that declaration a `<title>`
        // holding a few thousand nested tags overflows the stack right here.
        documentTitle ??= element.text;
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
    // provoke -- an unparseable page URL, malformed JSON-LD, a `<title>` deep
    // enough to overflow `.text` -- is now handled at its source, so removing
    // this catch breaks nothing in the suite. It stays because the contract is
    // "never throws" and the parser is third-party code. It is the only guard
    // here that no test can see; every other bound is pinned from both sides.
    return {};
  }
}

function read(html: string, pageUrl: string): LinkMetadata {
  // `parseNoneClosedTags` disables the library's repair pass for unclosed
  // tags, which re-parents every orphaned child one stack level at a time and
  // is super-linear: 8,000 unclosed `<div>`s -- 40 KB, a fiftieth of Task 6's
  // fetch cap -- takes ~36 seconds with it on and ~10 ms with it off. We read
  // meta tags and script bodies, so the repaired tree shape buys us nothing.
  const root = parse(reduceToMarkup(html), {
    parseNoneClosedTags: true,
    blockTextElements: BLOCK_TEXT_ELEMENTS,
  });
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
