import "server-only";

import { extractProduct } from "@/lib/intake/product-page";
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
 *   - the price comes from the page, never from the model — a model's price is
 *     a memory of a price;
 *   - a page with no structured price is kept but marked `unwatchable`, so the
 *     price cron skips it rather than starting a scraping arms race.
 *
 * That verification pass is also what makes Phase 6 possible: by the time a
 * match is stored, it is already known to be readable.
 */

const DEFAULT_MODEL = "gemini-3.6-flash";

/** How many links to ask for, and how many to verify. Verification is the cost. */
const CANDIDATES_REQUESTED = 10;
const MAX_VERIFICATIONS = 12;
/** Fetched a few at a time: polite to the retailers, and fast enough. */
const VERIFY_CONCURRENCY = 4;

export type Candidate = {
  url: string;
  title: string | null;
  brand: string | null;
  retailer: string;
  priceCents: number | null;
  currency: string | null;
  imageUrl: string | null;
  /** True when the page published no machine-readable price. */
  unwatchable: boolean;
  /** The model's one line on why this answers the brief. */
  rationale: string | null;
};

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
  /** In cents. The model is told, and the ranker enforces. */
  ceilingCents?: number | null;
  /** Brands already in the wardrobe — the ones to steer away from. */
  familiarBrands: string[];
};

function buildPrompt(brief: SearchBrief): string {
  const ceiling = brief.ceilingCents
    ? `Stay at or under ${(brief.ceilingCents / 100).toFixed(0)} in the listing's own currency.`
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

/** Pulls a JSON array out of a response that may or may not be fenced. */
function parseCandidates(raw: string): { url: string; title?: string; brand?: string; why?: string }[] {
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
async function askForCandidates(brief: SearchBrief): Promise<
  { url: string; title?: string; brand?: string; why?: string }[]
> {
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
    signal: AbortSignal.timeout(45_000),
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

  const payload = (await response.json()) as {
    candidates?: { content?: { parts?: { text?: string }[] } }[];
  };

  const raw = payload.candidates?.[0]?.content?.parts
    ?.map((part) => part.text ?? "")
    .join("")
    .trim();

  return raw ? parseCandidates(raw) : [];
}

/**
 * Fetches a candidate and reads what the page actually says.
 *
 * Returns null when the link is dead, private, unreachable, or not a page we
 * can read — all of which mean the same thing to the user, which is that it
 * shouldn't be on the list.
 */
async function verify(
  candidate: { url: string; title?: string; brand?: string; why?: string },
): Promise<Candidate | null> {
  let url: URL;
  try {
    url = new URL(candidate.url);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;

  try {
    const page = await safeFetch(url.href, {
      accept: "text/html,application/xhtml+xml",
      maxBytes: 3_000_000,
      timeoutMs: 8_000,
    });
    const product = extractProduct(new TextDecoder().decode(page.body), page.finalUrl);

    // No markup at all usually means a JavaScript shell — the same wall URL
    // import hits on the large chains. The link is real, so it's kept; it just
    // can't be priced or watched.
    const unwatchable = product.priceCents === null;

    return {
      // The URL *after* redirects: the one that was really fetched, and the one
      // the price cron will fetch again.
      url: page.finalUrl,
      title: product.title ?? candidate.title ?? null,
      brand: product.brand ?? candidate.brand ?? null,
      retailer: new URL(page.finalUrl).hostname.replace(/^www\./, ""),
      priceCents: product.priceCents,
      currency: product.currency,
      imageUrl: product.imageUrl,
      unwatchable,
      rationale: typeof candidate.why === "string" ? candidate.why.slice(0, 200) : null,
    };
  } catch (error) {
    if (error instanceof FetchRejected) return null;
    return null;
  }
}

/** Runs `verify` a few at a time rather than all at once. */
async function verifyAll(
  candidates: { url: string; title?: string; brand?: string; why?: string }[],
): Promise<Candidate[]> {
  const queue = candidates.slice(0, MAX_VERIFICATIONS);
  const verified: Candidate[] = [];

  for (let start = 0; start < queue.length; start += VERIFY_CONCURRENCY) {
    const batch = queue.slice(start, start + VERIFY_CONCURRENCY);
    const results = await Promise.all(batch.map(verify));
    for (const result of results) if (result) verified.push(result);
  }

  return verified;
}

export type SearchOutcome = {
  candidates: Candidate[];
  /** How many the model proposed, before verification. */
  proposed: number;
};

export async function findProducts(brief: SearchBrief): Promise<SearchOutcome> {
  const proposed = await askForCandidates(brief);
  const candidates = await verifyAll(proposed);
  return { candidates, proposed: proposed.length };
}
