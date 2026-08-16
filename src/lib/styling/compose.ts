import type { Category } from "@/lib/garments";
import type { WardrobeItem } from "@/lib/items";
import {
  FABRIC_WEIGHT,
  HEAVY_FABRIC_CEILING_C,
  OCCASION_RULES,
  RAIN_RULES,
  bandFor,
  inferRegister,
} from "@/lib/styling/rulebook";
import { disqualify, scoreOutfit, type ScoreContext, type ScoredOutfit } from "@/lib/styling/score";

/**
 * Building the shortlist the model chooses from.
 *
 * Enumerating every top against every bottom against every shoe is fine at
 * thirty garments and 400,000 combinations at three hundred, so this narrows
 * each category first and only then combines. The narrowing uses the cheap
 * per-item signals — is it in season, is it near the right formality, was it
 * worn yesterday — and the expensive rules (colour, proportion, contrast) run
 * only on combinations that survived.
 *
 * The shortlist is deliberately more than one. Rules are good at ruling things
 * out and mediocre at picking a favourite among ten reasonable options, which
 * is precisely the division of labour with the model: the engine decides what
 * is *wearable*, the model decides which of the wearable ones is *good*, and
 * if the model is unavailable the top-scoring candidate is a perfectly
 * defensible answer.
 */

/** How many of each category survive the first pass. */
const KEEP_PER_CATEGORY: Record<Category, number> = {
  top: 8,
  bottom: 6,
  shoes: 5,
  outerwear: 4,
  accessory: 3,
  socks: 2,
};

/** Hard ceiling on combinations built, so a large wardrobe can't stall a page. */
const MAX_COMBINATIONS = 900;

/**
 * A cheap score used only to decide which garments are worth combining.
 *
 * Intentionally not the real scorer: this one looks at a garment alone, which
 * is fast and is all that's needed to drop the parka on a summer morning
 * before it gets paired with anything.
 */
function itemAffinity(item: WardrobeItem, context: ScoreContext): number {
  let score = 0;
  const rule = OCCASION_RULES[context.occasion];

  if (item.seasons.length > 0) {
    score += item.seasons.includes(context.season) ? 2 : -3;
  }

  if (typeof item.formality === "number") {
    if (item.formality >= rule.formalityMin && item.formality <= rule.formalityMax) {
      score += 2;
    } else {
      // Distance from the acceptable band, not a flat penalty — a 3 at a formal
      // occasion is a near miss and a 1 is not.
      const distance =
        item.formality < rule.formalityMin
          ? rule.formalityMin - item.formality
          : item.formality - rule.formalityMax;
      score -= distance * 1.5;
    }
  }

  if (rule.avoidRegisters.includes(inferRegister(item.subcategory))) score -= 10;

  const days = context.daysSinceWorn.get(item.id);
  if (days !== undefined) {
    if (days <= 1) score -= 5;
    else if (days <= 3) score -= 2;
    else if (days <= 7) score -= 0.5;
  } else {
    score += 0.5;
  }

  if (item.needs_review) score -= 0.5;

  if (context.forecast) {
    const wet = context.forecast.precipChance >= RAIN_RULES.chanceThreshold;
    if (wet && item.category === "shoes") {
      const text = `${item.subcategory ?? ""} ${item.material ?? ""}`.toLowerCase();
      if (RAIN_RULES.avoidShoeMaterials.some((m) => text.includes(m))) score -= 6;
      if (RAIN_RULES.avoidShoeSubcategories.some((s) => text.includes(s))) score -= 6;
    }

    // The same fabric-weight rule the scorer applies, moved forward so a wool
    // coat never reaches the enumeration on a 30°C day and crowd out something
    // wearable. Cheaper here, and the scorer still has the final say.
    const material = (item.material ?? "").toLowerCase();
    if (
      context.forecast.feelsLikeMax >= HEAVY_FABRIC_CEILING_C &&
      item.category !== "shoes" &&
      FABRIC_WEIGHT.heavy.some((fabric) => material.includes(fabric))
    ) {
      score -= 6;
    }
  }

  return score;
}

function shortlistCategory(
  items: WardrobeItem[],
  category: Category,
  context: ScoreContext,
): WardrobeItem[] {
  return items
    .filter((item) => item.category === category)
    .map((item) => ({ item, affinity: itemAffinity(item, context) }))
    .sort((a, b) => b.affinity - a.affinity)
    .slice(0, KEEP_PER_CATEGORY[category])
    .map((entry) => entry.item);
}

/** Stable identity for a set of garments, so two routes to the same outfit collapse. */
function signature(items: WardrobeItem[]) {
  return items
    .map((item) => item.id)
    .sort()
    .join("|");
}

/**
 * Composes candidates from loose garments.
 *
 * Outerwear is added when the weather asks for it and omitted when it doesn't,
 * rather than being tried both ways — the temperature band has already decided
 * that question and letting the scorer re-litigate it just fills the shortlist
 * with the same outfit twice.
 */
export function composeCandidates(
  items: WardrobeItem[],
  context: ScoreContext,
): ScoredOutfit[] {
  const tops = shortlistCategory(items, "top", context);
  const bottoms = shortlistCategory(items, "bottom", context);
  const shoes = shortlistCategory(items, "shoes", context);
  const outerwear = shortlistCategory(items, "outerwear", context);
  const accessories = shortlistCategory(items, "accessory", context);

  if (tops.length === 0 || bottoms.length === 0 || shoes.length === 0) return [];

  const band = context.forecast ? bandFor(context.forecast.feelsLikeMin) : null;
  const wet =
    context.forecast !== null &&
    context.forecast.precipChance >= RAIN_RULES.chanceThreshold;
  const wantsLayer =
    band !== null &&
    (band.outerwear === "mandatory" || band.outerwear === "recommended" || wet);

  // An accessory is optional everywhere, so it's tried both ways — but only
  // where it's likely to matter, which the rulebook already quantifies.
  const accessoryOptions: (WardrobeItem | null)[] =
    OCCASION_RULES[context.occasion].accessoryWeight >= 1 && accessories.length > 0
      ? [accessories[0], null]
      : [null];

  const layerOptions: (WardrobeItem | null)[] = wantsLayer
    ? outerwear.length > 0
      ? outerwear.slice(0, 3)
      : [null]
    : [null];

  const scored: ScoredOutfit[] = [];
  const seen = new Set<string>();
  let built = 0;

  // Labelled so the ceiling stops the whole enumeration rather than only the
  // innermost loop — an unlabelled break here would let a large wardrobe run
  // the outer loops to completion regardless.
  building: for (const top of tops) {
    for (const bottom of bottoms) {
      for (const shoe of shoes) {
        for (const layer of layerOptions) {
          for (const accessory of accessoryOptions) {
            if (built >= MAX_COMBINATIONS) break building;
            built++;

            const set = [top, bottom, shoe, layer, accessory].filter(
              (item): item is WardrobeItem => item !== null,
            );

            const key = signature(set);
            if (seen.has(key)) continue;
            seen.add(key);

            if (disqualify(set, context)) continue;
            scored.push(scoreOutfit(set, context));
          }
        }
      }
    }
  }

  return scored;
}

/**
 * Saved outfits, scored the same way.
 *
 * These get a standing bonus. An outfit that was composed by hand on a canvas
 * is evidence of taste that no amount of tag arithmetic reconstructs, so when a
 * saved outfit and a generated one score alike, the saved one should win.
 */
const SAVED_OUTFIT_BONUS = 4;

export function scoreSavedOutfits(
  saved: { id: string; itemIds: string[] }[],
  itemsById: Map<string, WardrobeItem>,
  context: ScoreContext,
): ScoredOutfit[] {
  const results: ScoredOutfit[] = [];

  for (const outfit of saved) {
    const items = outfit.itemIds
      .map((id) => itemsById.get(id))
      .filter((item): item is WardrobeItem => item !== undefined);

    // An outfit whose pieces are half gaps isn't wearable today — that's a
    // shopping list, which is what Phase 5 is for.
    if (items.length !== outfit.itemIds.length) continue;
    if (disqualify(items, context)) continue;

    const scored = scoreOutfit(items, context, outfit.id);
    results.push({
      ...scored,
      score: scored.score + SAVED_OUTFIT_BONUS,
      praise: ["One you put together yourself.", ...scored.praise],
    });
  }

  return results;
}

/**
 * The shortlist handed to the model, best first.
 *
 * Capped at ten. Beyond that the model is choosing between candidates that are
 * already worse than several it rejected, and every extra one is prompt tokens
 * spent on an option that won't win.
 */
export function shortlist(
  candidates: ScoredOutfit[],
  limit = 10,
): ScoredOutfit[] {
  const seen = new Set<string>();
  return candidates
    .sort((a, b) => b.score - a.score)
    .filter((candidate) => {
      const key = signature(candidate.items);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, limit);
}
