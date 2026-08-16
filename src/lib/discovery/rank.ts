import type { Candidate } from "@/lib/discovery/search";

/**
 * Ranking candidates, with the bias written down.
 *
 * This is the file the whole shopping half was justified by. The complaint
 * about existing tools was that their results were clouded by sponsorship —
 * so the ranking function here is small, readable, and has exactly one thumb on
 * the scale, which is stated out loud: **brands already in the wardrobe are
 * ranked down.**
 *
 * That is not neutrality. It's a deliberate bias, and it's the one that was
 * asked for — "find me something new" is the actual request, and a ranker that
 * kept surfacing the same three labels would be technically unbiased and
 * practically useless. The difference from an affiliate feed is that this bias
 * is visible in twenty lines of code, serves the person searching, and nobody
 * is paying for it.
 *
 * Nothing here can be bought. There is no partner list, no boost parameter, and
 * no field a retailer could influence.
 */

export type RankedCandidate = Candidate & {
  /** 0–1. Stored on the match so a ranking can be explained later. */
  score: number;
  /** Why it scored the way it did, in plain words. */
  notes: string[];
};

export type RankInput = {
  candidates: Candidate[];
  /** In cents. Candidates above it are dropped, not merely demoted. */
  ceilingCents: number | null;
  /** Lower-cased brand names already in the wardrobe. */
  familiarBrands: Set<string>;
  /** The want's own target price, if it has one. */
  targetCents: number | null;
};

/** Same product from the same retailer, arrived at by two paths. */
function identity(candidate: Candidate) {
  try {
    const url = new URL(candidate.url);
    // Query strings on a product URL are almost always tracking or a variant
    // selector, and neither makes it a different product.
    return `${url.hostname.replace(/^www\./, "")}${url.pathname.replace(/\/$/, "")}`;
  } catch {
    return candidate.url;
  }
}

export function rankCandidates({
  candidates,
  ceilingCents,
  familiarBrands,
  targetCents,
}: RankInput): RankedCandidate[] {
  const seen = new Set<string>();
  const ranked: RankedCandidate[] = [];

  for (const candidate of candidates) {
    const key = identity(candidate);
    if (seen.has(key)) continue;
    seen.add(key);

    // The ceiling is a filter, not a penalty. Showing something unaffordable
    // and ranking it fourth is still showing it, and the ceilings exist
    // precisely so that doesn't happen.
    if (
      ceilingCents !== null &&
      candidate.priceCents !== null &&
      candidate.priceCents > ceilingCents
    ) {
      continue;
    }

    let score = 0.5;
    const notes: string[] = [];

    const brand = candidate.brand?.toLowerCase().trim() ?? "";
    if (brand && familiarBrands.has(brand)) {
      score -= 0.25;
      notes.push("A brand you already wear.");
    } else if (brand) {
      score += 0.15;
      notes.push("Not a label you own yet.");
    }

    if (candidate.priceCents === null) {
      // No published price is a genuine handicap: it can't be compared and it
      // can't be watched, which is half of what a match is for.
      score -= 0.15;
      notes.push("No price we could read.");
    } else if (targetCents !== null) {
      if (candidate.priceCents <= targetCents) {
        score += 0.2;
        notes.push("At or under what you wanted to pay.");
      } else if (candidate.priceCents <= targetCents * 1.25) {
        score += 0.05;
        notes.push("Slightly over your target.");
      } else {
        score -= 0.1;
        notes.push("Over what you wanted to pay.");
      }
    }

    // A page we can read is a page we can keep watching, which is worth
    // something on its own.
    if (!candidate.unwatchable) {
      score += 0.1;
      notes.push("Price is readable, so it can be watched.");
    }

    if (candidate.imageUrl) score += 0.05;

    ranked.push({
      ...candidate,
      score: Math.min(1, Math.max(0, Number(score.toFixed(3)))),
      notes,
    });
  }

  return ranked.sort((a, b) => b.score - a.score);
}
