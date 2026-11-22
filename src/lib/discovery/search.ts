import "server-only";

import { judgeRelevance, type Relevance } from "@/lib/discovery/relevance";
import {
  classifyPage,
  extractProduct,
  isChallengePage,
  readCategoryHints,
  readStock,
  readTitles,
  type Availability,
} from "@/lib/intake/product-page";
import { FetchRejected, safeFetch } from "@/lib/intake/safe-fetch";

/**
 * Finding buyable pieces, without an affiliate feed.
 *
 * This is the part of the app with an actual requirement behind it rather than
 * a preference: results must not be ranked by who pays. That rules out every
 * shopping API, all of which are commission feeds wearing a search interface,
 * and it is why this goes through a model with Google Search grounding instead
 * — organic results, and nothing in the pipeline with a reason to reorder them.
 *
 * **Every URL is verified before it is stored.** A grounded model still invents
 * plausible product URLs, and a shopping list of 404s is worse than an empty
 * one. So each candidate is fetched and parsed with the same JSON-LD reader
 * that powers URL import, and:
 *
 *   - a link that doesn't resolve is dropped, not shown;
 *   - a page that says nothing product-shaped at all (`no-markup`: no Product
 *     JSON-LD, no og:image, no price, no og:title) is dropped — there is
 *     nothing on it to show, and nothing to confirm it is the item at all;
 *   - a homepage, collection or category page is dropped (`not_a_product`) —
 *     decided from the page's own markup first and its path second, see
 *     `classifyPage`;
 *   - a listing priced in anything but US dollars is dropped — the shopper is
 *     in the United States, and a GBP page is a UK storefront they can't use.
 *     A page that names no currency is kept, and flagged `currencyUnknown`;
 *   - the price comes from the page, never from the model — a model's price is
 *     a memory of a price;
 *   - a page with no structured price is kept but marked `unwatchable`, so the
 *     price cron skips it rather than starting a scraping arms race;
 *   - a page whose every offer is out of stock is dropped (`out_of_stock`);
 *   - a page whose own product name is a different kind of garment from the
 *     brief is dropped (`off_brief`, see `relevance.ts`);
 *   - a price over the brief's ceiling is dropped (`over_ceiling`). The ranker
 *     re-checks the same rule, but doing it here means the drop is counted.
 *
 * **Every drop has a recorded reason** (`SearchOutcome.dropped`). Before that
 * existed, a run that kept 1 of 10 looked identical whether the model invented
 * nine URLs or nine real retailers 403'd the fetcher — two problems with
 * opposite fixes.
 *
 * That verification pass is also what makes Phase 6 possible: by the time a
 * match is stored, it is already known to be readable.
 */

const DEFAULT_MODEL = "gemini-3.6-flash";

/**
 * How many links to ask for, and how many to verify.
 *
 * Measured 2026-11-17 with `npm run discovery:probe` (10 briefs each way,
 * gemini-3.6-flash): asking for 6 instead of 10 did not bound the slow tail —
 * the 6-run still had a 94s brief — and halves what survives verification. The
 * time is in the model's searching, not in the length of the list. So 10 stays,
 * and the timeout below is what was fixed. MAX_VERIFICATIONS sits above it only
 * because the model occasionally returns a few extra.
 */
const CANDIDATES_REQUESTED = 10;
const MAX_VERIFICATIONS = 12;
/**
 * At most this many retailer fetches in flight at once: polite to the
 * retailers, and fast enough. Run as a pool, not in fixed batches, so one slow
 * host holds up one slot rather than the three fetches that happened to share
 * its batch.
 */
const VERIFY_CONCURRENCY = 4;
/**
 * Shopify rate-limits per client IP across *all* its stores, not per store.
 * Observed 2026-11-18: in one 10-brief probe run 49 of 79 drops were 429s from
 * ~25 different Shopify stores, every one `Retry-After: 60`; afterwards the IP
 * stayed throttled for minutes under every header variant, and the
 * `/products/<handle>.json` and `.js` endpoints were throttled identically
 * (7 of 8 stores 429 on each), so they are no way around it.
 *
 * So every URL shaped like a Shopify product (`/products/<handle>`) goes
 * through one lane, one request at a time, `SHOPIFY_GAP_MS` apart; every other
 * host gets a lane of its own, so no two requests hit one host at once.
 */
const SHOPIFY_GAP_MS = 750;
/**
 * Once throttled, more requests only extend the penalty and each costs a
 * round trip. After this many 429s in the Shopify lane, the rest of the lane
 * is dropped as `rate_limited` without being fetched; any other host is
 * abandoned after its first 429.
 */
const SHOPIFY_429_BREAKER = 2;
/**
 * Wall-clock budget for the whole verification pass. The page's maxDuration
 * (200s) has to cover the grounded search (up to 150s) and this; anything not
 * started by the deadline is `not_verified`.
 */
const VERIFY_BUDGET_MS = 40_000;
/**
 * Per-candidate page fetch. Unchanged from before; measured verification for a
 * whole brief (10 fetches, 4 at a time) took 0.7–5s across 20 probe runs, so
 * this limit is not what makes discovery slow.
 */
const VERIFY_TIMEOUT_MS = 8_000;

/**
 * The grounded call, which is nearly all of discovery's wall time.
 *
 * It was 45s, and in-app about half of runs died at it. Measured 2026-11-17
 * with `npm run discovery:probe` under a 180s ceiling, search phase only:
 * 10 candidates — 33s to 74s, median ~47s, over 10 briefs; 6 candidates —
 * 23s to 94s, median ~40s, over the same briefs. 150s is the 94s worst case plus ~60%
 * headroom. It runs behind an explicit button in a server action, and the
 * page that hosts that action raises `maxDuration` to cover this plus
 * verification (see inbox/want/[id]/page.tsx).
 */
const GROUNDED_TIMEOUT_MS = 150_000;

export type Candidate = {
  url: string;
  title: string | null;
  brand: string | null;
  retailer: string;
  priceCents: number | null;
  currency: string | null;
  /**
   * True when the page names no currency. It is kept — most such pages on a
   * US-only search are US stores — but whatever reads `priceCents` should know
   * the "USD" it may assume was not read off the page.
   */
  currencyUnknown: boolean;
  imageUrl: string | null;
  /** True when the page published no machine-readable price. */
  unwatchable: boolean;
  /**
   * `product` when the page described itself as one item; `unknown` when it
   * said nothing either way. Listings never get this far (`not_a_product`).
   */
  pageKind: "product" | "unknown";
  /** From the page's offers; `unknown` when it doesn't say. */
  availability: Availability;
  /** `match`, or `unknown` when the page's name names no garment kind. */
  relevance: Exclude<Relevance, "mismatch">;
  /** The model's one line on why this answers the brief. */
  rationale: string | null;
};

/**
 * Why a proposed link didn't make the list. Kept as values, not sentences, so
 * a run can be totted up: `http_403` across five retailers is a bot wall,
 * `http_404` across five is the model inventing URLs.
 */
export type DropReason =
  /** The model's "URL" didn't parse, or wasn't http(s). */
  | "bad_url"
  /** Proposed beyond `MAX_VERIFICATIONS`, or not reached inside the verify budget. */
  | "not_verified"
  /** Not fetched: its lane had already been answered with 429s. */
  | "rate_limited"
  /** The retailer answered with this (non-2xx) status. */
  | `http_${number}`
  | "timeout"
  | "dns"
  | "unreachable"
  | "private_address"
  | "too_large"
  | "redirect"
  /** Any other refusal from `safeFetch`. */
  | "fetch_rejected"
  /** Reachable, but nothing product-shaped in the HTML (a JS shell or soft 404). */
  | "no_product_markup"
  /** A bot wall answered 200 with its challenge interstitial (`isChallengePage`). */
  | "bot_wall"
  /** A homepage, collection or category grid — not one buyable item. */
  | "not_a_product"
  /** Every offer on the page is OutOfStock / SoldOut / Discontinued. */
  | "out_of_stock"
  /** The page's product is a different kind of garment from the brief. */
  | "off_brief"
  /** Priced, and the price is over the brief's ceiling. */
  | "over_ceiling"
  /** The page states a currency, and it isn't USD. */
  | "non_usd"
  /** Something threw that isn't a fetch refusal — a bug, logged as such. */
  | "error";

export type DroppedCandidate = { url: string; reason: DropReason };

export class DiscoveryError extends Error {
  readonly status: number;
  constructor(message: string, status = 502) {
    super(message);
    this.name = "DiscoveryError";
    this.status = status;
  }
}

export type SearchBrief = {
  title: string;
  description?: string | null;
  category?: string | null;
  /**
   * In cents (USD). The model is told; `findProducts` drops priced results
   * over it (`over_ceiling`), and the ranker re-checks.
   */
  ceilingCents?: number | null;
  /** Brands already in the wardrobe — the ones to steer away from. */
  familiarBrands: string[];
};

function buildPrompt(brief: SearchBrief): string {
  const ceiling = brief.ceilingCents
    ? `Stay at or under $${(brief.ceilingCents / 100).toFixed(0)} USD.`
    : "There is no strict budget, but prefer sensibly-priced options over designer ones.";

  const familiar =
    brief.familiarBrands.length > 0
      ? `This person already owns things from: ${brief.familiarBrands.slice(0, 25).join(", ")}. Actively look elsewhere — the point of this search is to find labels they don't already wear. Do not exclude these brands outright, but do not lead with them.`
      : "Favour smaller and independent labels over the obvious big names.";

  return `Find real, currently-purchasable products matching this brief.

BRIEF
  What: ${brief.title}
  ${brief.description ? `Notes: ${brief.description}` : ""}
  ${brief.category ? `Category: ${brief.category}` : ""}

CONSTRAINTS
  The shopper is in the United States and pays in US dollars. Only return
  retailers that sell and ship to the United States with prices in USD. When a
  brand runs several country storefronts, give the US one — never a UK, EU,
  Canadian or Australian storefront, and never a page priced in GBP, EUR, CAD
  or AUD.
  ${ceiling}
  ${familiar}
  Only direct product pages — a page for one specific buyable item. Never a
  category listing, a search results page, a blog post, a "best of" roundup, or
  a marketplace search. Never an affiliate or redirect link.
  Prefer the brand's own store over a reseller.

Use search to find ${CANDIDATES_REQUESTED} of them.

Reply with ONLY a JSON array, no prose and no code fence:
[{"url": "...", "title": "...", "brand": "...", "why": "one short sentence"}]

If you genuinely cannot find real matching products, reply with []. An empty
array is a correct answer. Inventing a plausible-looking URL is not — every one
of these is going to be fetched, and a made-up link is worse than no link.`;
}

type Proposal = { url: string; title?: string; brand?: string; why?: string };

/** Pulls a JSON array out of a response that may or may not be fenced. */
function parseCandidates(raw: string): Proposal[] {
  const cleaned = raw
    .replace(/^\s*```(?:json)?/i, "")
    .replace(/```\s*$/, "")
    .trim();

  const start = cleaned.indexOf("[");
  const end = cleaned.lastIndexOf("]");
  if (start === -1 || end === -1 || end < start) return [];

  try {
    const parsed = JSON.parse(cleaned.slice(start, end + 1));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/**
 * Asks the model, with search grounding on.
 *
 * Grounding and structured output can't be requested together, so the response
 * format is asked for in the prompt and parsed leniently. That's the trade for
 * results that come from the live web rather than from training data.
 */
async function askForCandidates(brief: SearchBrief): Promise<Proposal[]> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new DiscoveryError(
      "Discovery needs GEMINI_API_KEY. Set it in .env.local — see SETUP.md.",
      503,
    );
  }

  const model = process.env.GEMINI_MODEL || DEFAULT_MODEL;
  const endpoint =
    `https://generativelanguage.googleapis.com/v1beta/models/` +
    `${encodeURIComponent(model)}:generateContent`;

  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "content-type": "application/json", "x-goog-api-key": apiKey },
    body: JSON.stringify({
      contents: [{ role: "user", parts: [{ text: buildPrompt(brief) }] }],
      // The grounding tool. This is the whole reason this route exists rather
      // than a shopping API: it returns organic web results.
      tools: [{ google_search: {} }],
      generationConfig: { temperature: 0.3 },
    }),
    // Grounded generation is slow — it's several searches plus a synthesis.
    // This runs behind an explicit button, not a page load, so it can afford it.
    signal: AbortSignal.timeout(GROUNDED_TIMEOUT_MS),
  }).catch((error: unknown) => {
    if (error instanceof Error && error.name === "TimeoutError") {
      throw new DiscoveryError("The search took too long.", 504);
    }
    throw new DiscoveryError("Couldn't reach the search.", 502);
  });

  if (!response.ok) {
    if (response.status === 429) {
      throw new DiscoveryError(
        "The month's grounded-search quota is used up. It resets on the 1st.",
        429,
      );
    }
    if (response.status === 404) {
      throw new DiscoveryError(
        `The model "${model}" isn't available to this key, or doesn't support search grounding.`,
        404,
      );
    }
    const detail = await response.text().catch(() => "");
    throw new DiscoveryError(`Search returned ${response.status}: ${detail.slice(0, 200)}`);
  }

  // The body arrives after the headers, and the timeout signal still covers it.
  const payload = (await response.json().catch((error: unknown) => {
    if (error instanceof Error && error.name === "TimeoutError") {
      throw new DiscoveryError("The search took too long.", 504);
    }
    throw new DiscoveryError("The search sent back something unreadable.", 502);
  })) as {
    candidates?: { content?: { parts?: { text?: string }[] } }[];
  };

  const raw = payload.candidates?.[0]?.content?.parts
    ?.map((part) => part.text ?? "")
    .join("")
    .trim();

  return raw ? parseCandidates(raw) : [];
}

type Verified = { ok: true; candidate: Candidate } | { ok: false; dropped: DroppedCandidate };

function dropReasonFor(error: unknown): DropReason {
  if (error instanceof FetchRejected) {
    switch (error.code) {
      case "http":
        return error.upstreamStatus ? `http_${error.upstreamStatus}` : "fetch_rejected";
      case "timeout":
      case "dns":
      case "unreachable":
      case "private_address":
      case "too_large":
      case "redirect":
        return error.code;
      case "bad_url":
      case "protocol":
        return "bad_url";
      default:
        return "fetch_rejected";
    }
  }
  // `safeFetch` maps an abort during the request to FetchRejected, but an
  // abort while the body is still streaming surfaces as the raw AbortError.
  if (error instanceof Error && error.name === "AbortError") return "timeout";
  return "error";
}

/**
 * Fetches a candidate and reads what the page actually says.
 *
 * Every outcome is either a candidate or a drop with its reason — never a bare
 * null — so a run that keeps one of ten can say what happened to the other nine.
 */
async function verify(proposal: Proposal, brief: SearchBrief): Promise<Verified> {
  const proposedUrl = typeof proposal.url === "string" ? proposal.url : String(proposal.url);
  const drop = (reason: DropReason): Verified => ({
    ok: false,
    dropped: { url: proposedUrl, reason },
  });

  let url: URL;
  try {
    url = new URL(proposedUrl);
  } catch {
    return drop("bad_url");
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return drop("bad_url");

  try {
    const page = await safeFetch(url.href, {
      accept: "text/html,application/xhtml+xml",
      maxBytes: 3_000_000,
      timeoutMs: VERIFY_TIMEOUT_MS,
    });
    const html = new TextDecoder().decode(page.body);
    if (isChallengePage(html)) return drop("bot_wall");
    const product = extractProduct(html, page.finalUrl);

    // No Product data, no image, no price, no og:title: a JavaScript shell or
    // a soft 404. There is nothing to show and nothing to confirm the link is
    // the item the model said it was.
    if (product.reason === "no-markup") return drop("no_product_markup");

    // A homepage or collection has an og:image and an og:title, so it reads as
    // "ok" above — but it is a store, not an item. Judged on the final URL,
    // since a dead product link often redirects to the homepage.
    const pageKind = classifyPage(html, page.finalUrl);
    if (pageKind === "listing") return drop("not_a_product");

    const stock = readStock(html, page.finalUrl);
    if (stock.availability === "out_of_stock") return drop("out_of_stock");

    // The lowest price the item is actually for sale at, when the offers say;
    // otherwise the one price `extractProduct` read.
    const priceCents = stock.lowestCents ?? product.priceCents;
    const rawCurrency = stock.lowestCents !== null ? (stock.currency ?? product.currency) : product.currency;
    const currency = rawCurrency?.trim().toUpperCase() || null;
    if (currency !== null && currency !== "USD") return drop("non_usd");

    // The page's own names, not the model's: they disagree more than you'd think.
    const relevance = judgeRelevance(brief, {
      titles: readTitles(html),
      url: page.finalUrl,
      hints: readCategoryHints(html),
    });
    if (relevance === "mismatch") return drop("off_brief");

    if (brief.ceilingCents && priceCents !== null && priceCents > brief.ceilingCents) {
      return drop("over_ceiling");
    }

    // `parsePriceToCents` already turns a 0 into null; this is the line that
    // makes such a page unwatchable rather than "free".
    const unwatchable = priceCents === null;

    return {
      ok: true,
      candidate: {
        // The URL *after* redirects: the one that was really fetched, and the
        // one the price cron will fetch again.
        url: page.finalUrl,
        title: product.title ?? proposal.title ?? null,
        brand: product.brand ?? proposal.brand ?? null,
        retailer: new URL(page.finalUrl).hostname.replace(/^www\./, ""),
        priceCents,
        currency,
        currencyUnknown: currency === null,
        imageUrl: product.imageUrl,
        unwatchable,
        pageKind,
        availability: stock.availability,
        relevance,
        rationale: typeof proposal.why === "string" ? proposal.why.slice(0, 200) : null,
      },
    };
  } catch (error) {
    const reason = dropReasonFor(error);
    if (reason === "error") console.error("Discovery verify failed", proposedUrl, error);
    return drop(reason);
  }
}

/** Which lane a URL is fetched in: all Shopify-shaped product URLs share one. */
function laneFor(url: string): string {
  try {
    const parsed = new URL(url);
    if (/\/products\/[^/]+\/?$/.test(parsed.pathname)) return "shopify";
    return parsed.hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Runs `verify` with one request per lane at a time (see `SHOPIFY_GAP_MS`),
 * and at most `VERIFY_CONCURRENCY` lanes at once.
 */
async function verifyAll(
  proposals: Proposal[],
  brief: SearchBrief,
): Promise<{ candidates: Candidate[]; dropped: DroppedCandidate[] }> {
  const queue = proposals.slice(0, MAX_VERIFICATIONS);
  const results: Verified[] = new Array(queue.length);
  const deadline = Date.now() + VERIFY_BUDGET_MS;

  const lanes = new Map<string, number[]>();
  queue.forEach((proposal, index) => {
    const lane = laneFor(String(proposal.url));
    lanes.set(lane, [...(lanes.get(lane) ?? []), index]);
  });
  // The Shopify lane is the long one; start it first.
  const order = [...lanes.keys()].sort((a, b) => (a === "shopify" ? -1 : b === "shopify" ? 1 : 0));

  async function runLane(lane: string) {
    const isShopify = lane === "shopify";
    let throttled = 0;
    for (const [position, index] of (lanes.get(lane) ?? []).entries()) {
      const url = String(queue[index].url);
      if (throttled >= (isShopify ? SHOPIFY_429_BREAKER : 1)) {
        results[index] = { ok: false, dropped: { url, reason: "rate_limited" } };
        continue;
      }
      if (Date.now() >= deadline) {
        results[index] = { ok: false, dropped: { url, reason: "not_verified" } };
        continue;
      }
      if (isShopify && position > 0) await sleep(SHOPIFY_GAP_MS);
      results[index] = await verify(queue[index], brief);
      const result = results[index];
      if (!result.ok && result.dropped.reason === "http_429") throttled += 1;
    }
  }

  let nextLane = 0;
  async function worker() {
    while (nextLane < order.length) await runLane(order[nextLane++]);
  }
  await Promise.all(
    Array.from({ length: Math.min(VERIFY_CONCURRENCY, order.length) }, worker),
  );

  const candidates: Candidate[] = [];
  const dropped: DroppedCandidate[] = [];
  for (const result of results) {
    if (result.ok) candidates.push(result.candidate);
    else dropped.push(result.dropped);
  }
  for (const proposal of proposals.slice(MAX_VERIFICATIONS)) {
    dropped.push({ url: String(proposal.url), reason: "not_verified" });
  }

  return { candidates, dropped };
}

/**
 * Verification alone, for a list of URLs already in hand — what
 * `scripts/discovery-replay.ts` uses to re-check a probe run's proposals
 * without spending a grounded-search prompt.
 */
export function verifyProposals(
  urls: string[],
  brief: SearchBrief,
): Promise<{ candidates: Candidate[]; dropped: DroppedCandidate[] }> {
  return verifyAll(urls.map((url) => ({ url })), brief);
}

export type SearchOutcome = {
  candidates: Candidate[];
  /** How many the model proposed, before verification. */
  proposed: number;
  /** Every proposal that didn't survive verification, and why. */
  dropped: DroppedCandidate[];
  /** Wall time of the two halves, for tuning the timeouts above. */
  timings: { searchMs: number; verifyMs: number };
};

export async function findProducts(brief: SearchBrief): Promise<SearchOutcome> {
  const searchStart = Date.now();
  const proposed = await askForCandidates(brief);
  const verifyStart = Date.now();
  const { candidates, dropped } = await verifyAll(proposed, brief);
  return {
    candidates,
    proposed: proposed.length,
    dropped,
    timings: { searchMs: verifyStart - searchStart, verifyMs: Date.now() - verifyStart },
  };
}
