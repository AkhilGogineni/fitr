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
 *     and either sits at an unambiguous listing path (`/`, `/en-us/`,
 *     `/collections/x`, `/search`), or declares itself a listing
 *     (`CollectionPage`, `SearchResultsPage`, `ItemList`, `og:type` website)
 *     at a path with no item segment in it and without a single purchase
 *     control (one add-to-cart form or one or two buy buttons), which counts
 *     as product evidence off the unambiguous listing paths.
 *   - `unknown` — no product evidence, but nothing that says listing either.
 *     Left to the caller; discovery keeps these (they're unwatchable at worst)
 *     rather than throwing away a real product page whose markup is thin.
 *
 * The URL never makes a page a product, and only a few unambiguous shapes
 * make one a listing on their own: `/collections/sale/products/x` is a
 * product page on Shopify, gap.com's items live under `/browse/`, and plenty
 * of real product pages live at paths no pattern would guess.
 */
export type PageKind = "product" | "listing" | "unknown";

/**
 * Paths that are a listing whatever the page says: the storefront root (with
 * an optional locale like `/en-us/`), a Shopify collection with no item under
 * it, and search results. Deliberately short. `/shop/`, `/c/`, `/browse/`,
 * `/category/` are not here — gap.com's items live at `/browse/product.do`,
 * and plenty of stores put items at `/shop/<slug>` or `/c/<cat>/<item>` — so
 * those paths only count as a listing alongside page evidence.
 */
const LISTING_PATH =
  /^\/(?:[a-z]{2}(?:[-_][a-z]{2})?\/?)?$|^\/(?:[a-z]{2}(?:[-_][a-z]{2})?\/)?(?:collections(?:\/[^/]+)?\/?|search(?:\/.*)?|catalogsearch(?:\/.*)?)$/i;

/**
 * An item segment anywhere in the path: `/products/x`, `/p/x`, `/dp/x`,
 * `product.do`, a `.html` page, or a long numeric id (`58231821`).
 */
const ITEM_PATH =
  /\/(?:products?|p|dp|pd|item|items)\/[^/]+|\/product\.do$|\.html?$|\d{5,}/i;

/**
 * True when the page has exactly one Shopify add-to-cart form, or one or two
 * visible buy buttons ("Add to cart", "Add to bag", "Pre-order", "Buy now") —
 * a product page's main button plus, often, its sticky-header copy. Measured
 * 2026-11-19 on 47 cached product pages (1–5 buttons, most 1–2) and 10
 * category/home pages (0, or 48).
 */
function singlePurchaseControl(html: string): boolean {
  const cartForms = html.match(/<form[^>]+action=["'][^"']*\/cart\/add/gi)?.length ?? 0;
  if (cartForms === 1) return true;
  const visible = html.replace(/<script[\s\S]*?<\/script>/gi, "").replace(/<style[\s\S]*?<\/style>/gi, "");
  const buttons =
    visible.match(/>\s*(?:add to (?:cart|bag)|pre-?order(?: now)?|buy now)\b/gi)?.length ?? 0;
  return buttons >= 1 && buttons <= 2;
}

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

  const declaresPage = nodes.some(
    (n) => hasType(n, "CollectionPage") || hasType(n, "SearchResultsPage"),
  );
  const declaresList = nodes.some((n) => hasType(n, "ItemList"));

  let path = "";
  try {
    path = new URL(pageUrl).pathname;
  } catch {
    path = "";
  }

  // An item segment (`/collections/x/products/y`, `/browse/product.do`) wins
  // over everything but the page explicitly calling itself a collection or
  // search results. An ItemList alone isn't that — product pages carry them
  // for "you may also like".
  if (ITEM_PATH.test(path)) {
    if (declaresPage) return "listing";
    return singlePurchaseControl(html) ? "product" : "unknown";
  }

  if (LISTING_PATH.test(path)) return "listing";

  // One way to buy one thing. Gustin's jeans pages carry no JSON-LD, say
  // og:type website, and still have a single "Pre-order now for $99" button.
  // Grids have none (a collection links to items) or dozens (quick-add on
  // every tile; 48 on a Madewell category page). Not trusted on the paths
  // above: a homepage's single featured-product form doesn't make it an item.
  if (!declaresPage && singlePurchaseControl(html)) return "product";

  // Everything below needs the page to say so. `og:type` website is what
  // every Shopify homepage and collection says.
  if (declaresPage || declaresList || ogType === "website") return "listing";
  return "unknown";
}

/**
 * Whether the item can be bought now, and what it costs.
 *
 * `extractProduct` reads one price — the first offer — which is right for
 * import ("what did I pay") and for the price cron's baseline. Discovery needs
 * more from the same offers. Observed 2026-11-18/19:
 *
 *   - Old Navy and Gap publish full `Offer` lists in which every entry is
 *     `OutOfStock`, at clearance prices that undercut every ceiling;
 *   - Naadam publishes a `ProductGroup` whose variants mix in- and
 *     out-of-stock;
 *   - Puma publishes one `ProductGroup` with a variant per colour, each its
 *     own price ($51.99 white, $44.99 black) — so "the lowest offer on the
 *     page" was the price of a shoe the link doesn't point at;
 *   - Gustin's jeans are `PreOrder` ("51% funded, ships Jan/Feb 2027").
 *
 * **Which offers count.** The ones for the item the URL points at: offers
 * whose own `url` is the page URL, or that belong to a Product/variant whose
 * `url` is the page URL; failing that, offers whose URL or `sku` carries the
 * page URL's `variant=` id (Shopify's selected-variant parameter); failing
 * that, every offer of the main product and its variants.
 *
 * **Availability**, over those offers:
 *
 *   - `in_stock` — at least one says InStock, LimitedAvailability, OnlineOnly
 *     or InStoreOnly.
 *   - `preorder` — none in stock, at least one PreOrder, PreSale or BackOrder.
 *     BackOrder is grouped here deliberately: like a pre-order, it can be
 *     ordered but not shipped, on a date the page doesn't promise, and "in
 *     stock" is the thing a shopper is being told.
 *   - `out_of_stock` — offers state an availability and every one is
 *     OutOfStock / SoldOut / Discontinued; or no offer states one and the page
 *     says in so many words that the item is no longer available.
 *   - When no offer states one and the page doesn't say it's gone, an element
 *     reading exactly "In stock" counts as `in_stock` (Florsheim).
 *   - `unknown` — nothing either way. Not treated as out of stock.
 *
 * The price is the lowest among the offers that set the verdict: in-stock
 * offers for `in_stock`, pre-order offers for `preorder`, all of them
 * otherwise.
 */
export type Availability = "in_stock" | "preorder" | "out_of_stock" | "unknown";

export type StockReading = {
  availability: Availability;
  /** Lowest positive price among the offers that decided `availability`. */
  lowestCents: number | null;
  currency: string | null;
  /** Whether the offers were narrowed to the page URL's own item. */
  matchedUrl: boolean;
};

const IN_STOCK = /instock|limitedavailability|onlineonly|instoreonly/i;
const LATER = /preorder|presale|backorder/i;
const UNAVAILABLE = /outofstock|soldout|discontinued/i;
/**
 * An element whose whole text is "In stock" — Florsheim's per-size stock
 * label, with no JSON-LD at all. Only consulted when no offer states an
 * availability; "Only 3 left in stock" and the like don't match.
 */
const IN_STOCK_TEXT = />\s*in stock\s*</i;
const GONE_TEXT =
  /\b(?:this (?:item|product|style) is )?no longer available\b|\bthis (?:item|product) (?:is|has been) discontinued\b/i;

/** A URL with its fragment and any trailing slash dropped, for comparing. */
function comparableUrl(value: unknown, base: string): string | null {
  if (typeof value !== "string" || !value) return null;
  try {
    const url = new URL(decodeEntities(value), base);
    url.hash = "";
    url.pathname = url.pathname.replace(/\/+$/, "") || "/";
    return url.href;
  } catch {
    return null;
  }
}

export function readStock(html: string, pageUrl: string): StockReading {
  const nodes = readJsonLdNodes(html);
  const main =
    nodes.find((node) => hasType(node, "ProductGroup")) ??
    nodes.find((node) => hasType(node, "Product")) ??
    null;

  const sources: JsonObject[] = [];
  if (main) {
    sources.push(main);
    const variants = main.hasVariant;
    for (const variant of Array.isArray(variants) ? variants : variants ? [variants] : []) {
      if (variant && typeof variant === "object") sources.push(variant as JsonObject);
    }
    const mainName = text(main.name, 120)?.toLowerCase();
    if (mainName) {
      for (const node of nodes) {
        if (sources.includes(node) || !hasType(node, "Product")) continue;
        if (text(node.name, 120)?.toLowerCase().startsWith(mainName)) sources.push(node);
      }
    }
  }

  type State = "now" | "later" | "no" | "?";
  type Read = {
    cents: number | null;
    currency: string | null;
    state: State;
    url: string | null;
    sourceUrl: string | null;
    sku: string | null;
  };
  const offers: Read[] = [];
  for (const source of sources) {
    const sourceUrl = comparableUrl(source.url, pageUrl);
    for (const offer of flattenJsonLd(source.offers)) {
      const spec = offer.priceSpecification as JsonObject | undefined;
      const availability = typeof offer.availability === "string" ? offer.availability : "";
      offers.push({
        cents: parsePriceToCents(offer.price ?? offer.lowPrice ?? spec?.price),
        currency: text(offer.priceCurrency, 3) ?? text(spec?.priceCurrency, 3),
        state: IN_STOCK.test(availability)
          ? "now"
          : LATER.test(availability)
            ? "later"
            : UNAVAILABLE.test(availability)
              ? "no"
              : "?",
        url: comparableUrl(offer.url, pageUrl),
        sourceUrl,
        sku: text(offer.sku, 60) ?? text(source.sku, 60),
      });
    }
  }

  const page = comparableUrl(pageUrl, pageUrl);
  let pool = offers.filter((o) => page !== null && (o.url === page || o.sourceUrl === page));
  if (pool.length === 0) {
    let variantId: string | null = null;
    try {
      variantId = new URL(pageUrl).searchParams.get("variant");
    } catch {
      variantId = null;
    }
    if (variantId) {
      pool = offers.filter(
        (o) => o.sku === variantId || (o.url !== null && o.url.includes(`variant=${variantId}`)),
      );
    }
  }
  const matchedUrl = pool.length > 0;
  if (!matchedUrl) pool = offers;

  const stated = pool.filter((o) => o.state !== "?");
  let availability: Availability = "unknown";
  if (stated.some((o) => o.state === "now")) availability = "in_stock";
  else if (stated.some((o) => o.state === "later")) availability = "preorder";
  else if (stated.length > 0) availability = "out_of_stock";
  else {
    const visible = html.replace(/<script[\s\S]*?<\/script>/gi, "");
    if (GONE_TEXT.test(visible)) availability = "out_of_stock";
    else if (IN_STOCK_TEXT.test(visible)) availability = "in_stock";
  }

  const deciding =
    availability === "in_stock"
      ? pool.filter((o) => o.state === "now")
      : availability === "preorder"
        ? pool.filter((o) => o.state === "later")
        : pool;
  let lowest: Read | null = null;
  for (const offer of deciding) {
    if (offer.cents !== null && (lowest === null || offer.cents < (lowest.cents ?? Infinity))) {
      lowest = offer;
    }
  }

  return {
    availability,
    lowestCents: lowest?.cents ?? null,
    currency: lowest?.currency ?? null,
    matchedUrl,
  };
}

/**
 * What the page says the item is filed under: its breadcrumb trail and its
 * Product `category`. Secondary evidence for discovery's relevance check, for
 * pages whose product name is a style name ("Gritty Jackson Dry Old") rather
 * than a description.
 */
export function readCategoryHints(html: string): string[] {
  const hints: string[] = [];
  for (const node of readJsonLdNodes(html)) {
    if (hasType(node, "BreadcrumbList") && Array.isArray(node.itemListElement)) {
      for (const entry of node.itemListElement) {
        if (!entry || typeof entry !== "object") continue;
        const item = entry as JsonObject;
        const name = text(item.name, 80) ?? nameOf(item.item);
        if (name) hints.push(name);
      }
    }
    if (hasType(node, "Product") || hasType(node, "ProductGroup")) {
      const category = text(node.category, 120);
      if (category) hints.push(category);
    }
  }
  return hints;
}

/**
 * The page's own names for the item, most specific first: the JSON-LD
 * Product name, the `<title>`, then `og:title`. They are not interchangeable —
 * Florsheim's `og:title` is "Rucci Lug by Florsheim Shoes" while its `<title>`
 * is "Rucci Lug Plain Toe Chelsea Boot" — so a caller that needs the name to
 * *say* something (discovery's relevance check) tries each in turn.
 */
export function readTitles(html: string): string[] {
  const nodes = readJsonLdNodes(html);
  const product =
    nodes.find((node) => hasType(node, "Product")) ??
    nodes.find((node) => hasType(node, "ProductGroup")) ??
    null;
  const candidates = [
    text(product?.name, 120),
    text(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1], 120),
    metaContent(html, "og:title", "twitter:title"),
  ];
  return [...new Set(candidates.filter((title): title is string => title !== null))];
}

/**
 * Is this a bot wall's interstitial rather than the page that was asked for?
 *
 * Some walls answer 200, not 403. Observed 2026-11-21: abercrombie.com and
 * hollisterco.com return a 3,038-byte page titled "Client Challenge" that
 * loads a script from `/_fs-ch-…/`; blankapparel.com redirects to a 3.5KB
 * "Captcha Page". `safeFetch` only refuses non-2xx, so without this the
 * interstitial was read as the product: captures saved as "Client Challenge"
 * with no picture.
 *
 * Generic on purpose — no hostnames. Fires only when all three hold:
 *
 *   1. the page carries no product evidence at all (Product JSON-LD,
 *      `og:type` product, `og:image`, a price meta) — a real product page with
 *      a captcha-protected newsletter form is still a product page;
 *   2. the body is small (under 60KB) — interstitials are a few KB, product
 *      pages hundreds;
 *   3. it names itself as a challenge: its `<title>` is one of the walls'
 *      stock titles ("Client Challenge", "Just a moment...", "Attention
 *      Required!", "Access Denied", "Pardon Our Interruption", "Robot or
 *      human?", "Captcha Page", …), or it loads a known challenge script
 *      (Cloudflare `challenge-platform`/`cf-chl`, Akamai `bm-verify` /
 *      `sec-cpt`, PerimeterX `px-captcha`, DataDome `captcha-delivery`,
 *      Kasada `KPSDK`, the `/_fs-ch-` challenge path).
 */
const CHALLENGE_TITLE =
  /^\s*(?:client challenge|just a moment|attention required|access denied|pardon our interruption|robot or human|are you a (?:robot|human)|captcha(?: page)?|security check|verify(?:ing)? you are (?:a )?human|one more step|request blocked|too many requests|please wait while we verify)\b/i;
const CHALLENGE_MARKER =
  /cdn-cgi\/challenge-platform|\bcf[-_]chl|\/_fs-ch-|bm-verify|sec-cpt|_sec\/cp_challenge|px-captcha|_pxCaptcha|captcha-delivery\.com|\bKPSDK\b|\/ips\.js\?/i;
const CHALLENGE_MAX_BYTES = 60_000;

export function isChallengePage(html: string): boolean {
  if (html.length > CHALLENGE_MAX_BYTES) return false;

  const nodes = readJsonLdNodes(html);
  const productEvidence =
    nodes.some((node) => hasType(node, "Product") || hasType(node, "ProductGroup")) ||
    /product/i.test(metaContent(html, "og:type") ?? "") ||
    metaContent(html, "og:image", "og:image:url") !== null ||
    metaContent(html, "product:price:amount", "og:price:amount") !== null;
  if (productEvidence) return false;

  const title = decodeEntities(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? "");
  return CHALLENGE_TITLE.test(title) || CHALLENGE_MARKER.test(html);
}
