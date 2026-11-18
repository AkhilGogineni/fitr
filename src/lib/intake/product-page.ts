/**
 * Reading a product page.
 *
 * Roughly half this wardrobe was bought online, and a retailer's product page
 * already contains everything intake needs: a photo shot on white, the brand,
 * the material, and the price paid. Pulling those out turns "photograph, cut
 * out, tag" into "paste a link".
 *
 * Two sources, in order of trust:
 *
 *   1. JSON-LD `Product` / `Offer` — the structured data retailers publish for
 *      Google Shopping. Nearly universal, and it means the same parser also
 *      powers the Phase 6 price watch. Structured data is *supposed* to match
 *      the page, so it is preferred over anything scraped.
 *   2. OpenGraph and `<meta>` tags — the fallback for pages without JSON-LD.
 *      Always yields an image and a title, rarely a price.
 *
 * Both are read with regexes rather than a DOM parser. That is a deliberate
 * trade: retailer HTML is enormous and frequently malformed, we want four
 * fields out of it, and adding a parser dependency to read four fields is not
 * worth the install. When a page defeats the regex the import degrades to
 * "couldn't read that one" — which the UI handles — rather than throwing.
 */

export type ProductMetadata = {
  sourceUrl: string;
  title: string | null;
  brand: string | null;
  imageUrl: string | null;
  priceCents: number | null;
  currency: string | null;
  material: string | null;
  colors: string[];
  description: string | null;
  /** How much of the page we could actually read. */
  reason: ExtractionReason;
};

/**
 * Why an import went the way it did.
 *
 * "Failed" is too blunt a verdict here. A page can be perfectly reachable and
 * still carry nothing a parser can use, because the big chains render their
 * product data in the browser — and that is not the same problem as a dead link,
 * nor is it fixable by trying again. The client turns each of these into a
 * different next step, so they have to survive as separate values rather than
 * collapsing into one error string.
 */
export type ExtractionReason =
  /** Product data and a usable image — nothing more is needed. */
  | "ok"
  /** Real HTML, but no `Product` markup and no `og:image` to fall back on. */
  | "no-markup"
  /** Some fields came through, but no picture — the one thing we can't invent. */
  | "no-image";

type JsonObject = Record<string, unknown>;

const HTML_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  "#39": "'",
  "#x27": "'",
};

function decodeEntities(value: string) {
  return value.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (match, entity: string) => {
    const named = HTML_ENTITIES[entity.toLowerCase()];
    if (named) return named;
    const numeric = entity.match(/^#(x?)([0-9a-f]+)$/i);
    if (numeric) {
      const code = parseInt(numeric[2], numeric[1] ? 16 : 10);
      if (Number.isFinite(code)) return String.fromCodePoint(code);
    }
    return match;
  });
}

function text(value: unknown, maxLength = 200): string | null {
  if (typeof value === "number") return String(value);
  if (typeof value !== "string") return null;
  const cleaned = decodeEntities(value).replace(/\s+/g, " ").trim();
  return cleaned ? cleaned.slice(0, maxLength) : null;
}

/**
 * Prices arrive as "$129.00", "129,00", "1.299,00", or a bare number, and
 * getting this wrong by a factor of 100 is the kind of bug that only surfaces
 * when a price-drop alert fires at 3am. Both separators present means the last
 * one is the decimal point; a lone comma with exactly two digits after it is a
 * decimal comma; anything else is a thousands separator.
 *
 * **Zero is not a price.** Nothing in a wardrobe costs nothing, so a 0 is a
 * placeholder, never a reading — and a common one. Observed 2026-11-17 on
 * seasaltcornwall.com (Magento): a configurable product's JSON-LD carries
 * `"offers": []`, and the page's `<meta property="product:price:amount">` says
 * `content="0"`, because the parent of a size/colour set has no price of its
 * own and the real one is filled in by JavaScript. Read as a number, that 0
 * sailed under every price ceiling and would have become the price cron's
 * baseline, after which any real price looks like a rise. So 0, negatives and
 * anything non-finite come back as null — "this page publishes no price" —
 * which every caller already treats as unwatchable.
 */
export function parsePriceToCents(value: unknown): number | null {
  if (typeof value === "number") {
    return Number.isFinite(value) && value > 0 ? Math.round(value * 100) : null;
  }
  if (typeof value !== "string") return null;

  const digits = value.replace(/[^\d.,]/g, "");
  if (!digits) return null;

  const lastComma = digits.lastIndexOf(",");
  const lastDot = digits.lastIndexOf(".");
  let normalised: string;

  if (lastComma > -1 && lastDot > -1) {
    const decimalAt = Math.max(lastComma, lastDot);
    normalised =
      digits.slice(0, decimalAt).replace(/[.,]/g, "") +
      "." +
      digits.slice(decimalAt + 1);
  } else if (lastComma > -1) {
    normalised =
      digits.length - lastComma === 3
        ? digits.replace(",", ".")
        : digits.replace(/,/g, "");
  } else {
    normalised = digits;
  }

  const amount = Number.parseFloat(normalised);
  const cents = Number.isFinite(amount) ? Math.round(amount * 100) : null;
  // A string can still say "0.00", or round to nothing — same rule as above.
  return cents !== null && cents > 0 ? cents : null;
}

/** Flattens the shapes JSON-LD arrives in: bare object, array, or `@graph`. */
function flattenJsonLd(node: unknown, out: JsonObject[] = []): JsonObject[] {
  if (Array.isArray(node)) {
    for (const entry of node) flattenJsonLd(entry, out);
    return out;
  }
  if (node && typeof node === "object") {
    const object = node as JsonObject;
    out.push(object);
    if (object["@graph"]) flattenJsonLd(object["@graph"], out);
    // Some retailers nest the Product inside a mainEntity or itemListElement.
    if (object.mainEntity) flattenJsonLd(object.mainEntity, out);
    if (object.itemListElement) flattenJsonLd(object.itemListElement, out);
  }
  return out;
}

function hasType(node: JsonObject, wanted: string) {
  const type = node["@type"];
  const types = Array.isArray(type) ? type : [type];
  return types.some(
    (t) => typeof t === "string" && t.toLowerCase() === wanted.toLowerCase(),
  );
}

function collectImageUrls(value: unknown, out: string[] = []): string[] {
  if (typeof value === "string") {
    out.push(value);
  } else if (Array.isArray(value)) {
    for (const entry of value) collectImageUrls(entry, out);
  } else if (value && typeof value === "object") {
    const object = value as JsonObject;
    collectImageUrls(object.url ?? object.contentUrl, out);
  }
  return out;
}

function declaredWidth(url: string): number | null {
  const match = url.match(/[?&](?:width|w)=(\d{2,5})\b/i);
  return match ? Number(match[1]) : null;
}

/**
 * Picks the biggest rendition on offer.
 *
 * Some retailers publish `image` as an array of the *same* photo at several
 * widths, smallest first — so taking element zero hands the cutter a 100px
 * thumbnail, which produces a cutout that looks fine in a grid and falls apart
 * on a canvas. Observed on allbirds.com (Shopify's CDN, `/cdn/shop/`); the
 * other store checked while writing this, also on Shopify, published a single
 * unsized URL. One platform, two behaviours, so nothing here keys off the host.
 *
 * When the winner still carries a small `width`, it is rewritten upward: that
 * URL is proof the CDN resizes on that parameter, so asking it for 1600 is
 * asking for a rendition it already knows how to make.
 */
function chooseImageUrl(candidates: string[]): string | null {
  if (candidates.length === 0) return null;

  let best: string | null = null;
  let bestWidth = 0;

  for (const candidate of candidates) {
    const width = declaredWidth(candidate);
    if (width !== null && width > bestWidth) {
      best = candidate;
      bestWidth = width;
    }
  }

  if (!best) return candidates[0];
  if (bestWidth >= 1600) return best;
  return best.replace(/([?&](?:width|w)=)\d{2,5}\b/i, `$11600`);
}

function nameOf(value: unknown): string | null {
  if (typeof value === "string") return text(value, 80);
  if (Array.isArray(value)) return nameOf(value[0]);
  if (value && typeof value === "object") return text((value as JsonObject).name, 80);
  return null;
}

/** Offers may be a single object, an array, or an AggregateOffer wrapper. */
function readOffer(offers: unknown): { priceCents: number | null; currency: string | null } {
  const candidates = flattenJsonLd(offers);
  for (const offer of candidates) {
    const price =
      offer.price ??
      offer.lowPrice ??
      (offer.priceSpecification as JsonObject | undefined)?.price;
    const cents = parsePriceToCents(price);
    if (cents !== null) {
      return {
        priceCents: cents,
        currency:
          text(offer.priceCurrency, 3) ??
          text((offer.priceSpecification as JsonObject | undefined)?.priceCurrency, 3),
      };
    }
  }
  return { priceCents: null, currency: null };
}

function metaContent(html: string, ...keys: string[]): string | null {
  for (const key of keys) {
    // Attribute order varies, so match `content` on either side of the key.
    const pattern = new RegExp(
      `<meta[^>]+(?:property|name)=["']${key}["'][^>]*content=["']([^"']*)["']` +
        `|<meta[^>]+content=["']([^"']*)["'][^>]*(?:property|name)=["']${key}["']`,
      "i",
    );
    const match = html.match(pattern);
    const value = text(match?.[1] ?? match?.[2]);
    if (value) return value;
  }
  return null;
}

/** Every JSON-LD node on the page, flattened. */
function readJsonLdNodes(html: string): JsonObject[] {
  const scripts = [
    ...html.matchAll(
      /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi,
    ),
  ];

  const nodes: JsonObject[] = [];
  for (const [, raw] of scripts) {
    try {
      flattenJsonLd(JSON.parse(raw.trim()), nodes);
    } catch {
      // A single malformed block is common and shouldn't sink the whole import.
    }
  }
  return nodes;
}

export function extractProduct(html: string, pageUrl: string): ProductMetadata {
  const nodes = readJsonLdNodes(html);

  const product =
    nodes.find((node) => hasType(node, "Product")) ??
    nodes.find((node) => hasType(node, "ProductGroup")) ??
    null;

  const offer = readOffer(product?.offers);

  const ogImage = metaContent(html, "og:image", "og:image:url", "twitter:image");
  const rawImage = chooseImageUrl([
    ...collectImageUrls(product?.image),
    ...(ogImage ? [ogImage] : []),
  ]);

  let imageUrl: string | null = null;
  if (rawImage) {
    try {
      imageUrl = new URL(decodeEntities(rawImage), pageUrl).href;
    } catch {
      imageUrl = null;
    }
  }

  const titleTag = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1];

  const colorValue = product?.color;
  const colors = (Array.isArray(colorValue) ? colorValue : [colorValue])
    .map((color) => text(color, 30))
    .filter((color): color is string => color !== null);

  const priceCents =
    offer.priceCents ??
    parsePriceToCents(metaContent(html, "product:price:amount", "og:price:amount"));

  const brand =
    nameOf(product?.brand) ??
    nameOf(product?.manufacturer) ??
    metaContent(html, "og:site_name", "product:brand");

  const title =
    text(product?.name, 120) ??
    metaContent(html, "og:title", "twitter:title") ??
    text(titleTag, 120);

  /*
   * `no-markup` means the page told us nothing a shopper would recognise. A
   * `<title>` alone doesn't count — every JavaScript shell has one, and Uniqlo's
   * is the single word "UNIQLO". The test is whether anything specific to the
   * product survived into the HTML: structured data, an image, or a price.
   */
  const reason: ExtractionReason = imageUrl
    ? "ok"
    : product || priceCents !== null || metaContent(html, "og:title")
      ? "no-image"
      : "no-markup";

  return {
    sourceUrl: pageUrl,
    title,
    brand,
    imageUrl,
    priceCents,
    currency:
      offer.currency ??
      metaContent(html, "product:price:currency", "og:price:currency"),
    material: text(product?.material, 60),
    colors,
    description:
      text(product?.description, 400) ??
      metaContent(html, "og:description", "description"),
    reason,
  };
}

/**
 * Is this one buyable item, or a page of many?
 *
 * Discovery asks for product pages and is sometimes handed a store's homepage,
 * a collection, or a category grid. Those often carry an `og:image` and an
 * `og:title`, so `extractProduct` reads them as "ok" — and a homepage then
 * shows up as a result with the store's hero banner and no price.
 *
 * Decided from what the page says about itself first, the URL second:
 *
 *   - `product` — exactly one product described: a `Product`/`ProductGroup`
 *     node (or a few repeats of the same one), `og:type` of product, or a
 *     `product:price:amount` meta. A page that says it is a product is taken
 *     at its word, whatever its path looks like.
 *   - `listing` — the page describes three or more differently-named
 *     `Product` nodes and does not claim `og:type` product (a grid that
 *     publishes every tile); or it carries no product evidence at all
 *     and either declares itself a listing (`CollectionPage`, `ItemList`,
 *     `SearchResultsPage`), sits at a listing-shaped path (`/`,
 *     `/collections/x`, `/category/...`, `/search`), or says `og:type`
 *     website at a path that doesn't look like an item.
 *   - `unknown` — no product evidence, but nothing that says listing either.
 *     Left to the caller; discovery keeps these (they're unwatchable at worst)
 *     rather than throwing away a real product page whose markup is thin.
 *
 * The URL alone never decides: `/collections/sale/products/x` is a product
 * page on Shopify, and plenty of real product pages live at paths no pattern
 * would guess.
 */
export type PageKind = "product" | "listing" | "unknown";

const LISTING_PATH =
  /^\/(?:[a-z]{2}(?:[-_][a-z]{2})?\/?)?$|^\/(?:[a-z]{2}(?:[-_][a-z]{2})?\/)?(?:collections|category|categories|c|shop|search|browse|catalog|catalogsearch)(?:\/[^/]+)*\/?$/i;

const PRODUCT_PATH = /\/(?:products?|p|dp|item|items|pd)\/[^/]+|\.html?$|\/\d{5,}/i;

export function classifyPage(html: string, pageUrl: string): PageKind {
  const nodes = readJsonLdNodes(html);

  const products = nodes.filter((n) => hasType(n, "Product") || hasType(n, "ProductGroup"));
  // Variants of one ProductGroup, or the same Product published twice, are
  // still one item — count names, not nodes.
  const productNames = new Set(
    products
      .filter((n) => !hasType(n, "ProductGroup"))
      .map((n) => text(n.name, 120)?.toLowerCase() ?? "")
      .filter(Boolean),
  );
  const hasGroup = products.some((n) => hasType(n, "ProductGroup"));

  const ogType = metaContent(html, "og:type")?.toLowerCase() ?? null;
  const ogSaysProduct = ogType !== null && /product/.test(ogType);
  const priceMeta = metaContent(html, "product:price:amount", "og:price:amount") !== null;

  // A grid that publishes each tile as a Product. A product page that also
  // lists related items as Products is protected by its own og:type.
  const manyProducts = !hasGroup && productNames.size >= 3;
  if (manyProducts && !ogSaysProduct) return "listing";

  if (products.length > 0 || ogSaysProduct || priceMeta) return "product";

  const declaresListing = nodes.some(
    (n) => hasType(n, "CollectionPage") || hasType(n, "ItemList") || hasType(n, "SearchResultsPage"),
  );

  let path = "";
  try {
    path = new URL(pageUrl).pathname;
  } catch {
    path = "";
  }
  const productPath = PRODUCT_PATH.test(path);
  // `/collections/x/products/y` is an item: the item segment wins.
  const listingPath = LISTING_PATH.test(path) && !productPath;

  if (declaresListing || listingPath) return "listing";
  // `og:type` website is what every Shopify homepage and collection says, but
  // also what a thin product page might say — so it only counts when the path
  // doesn't look like an item.
  if (ogType === "website" && !productPath) return "listing";
  return "unknown";
}
