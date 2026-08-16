import { type Category } from "@/lib/garments";
import type { WardrobeItem } from "@/lib/items";
import type { Occasion } from "@/lib/outfits";
import type { Forecast } from "@/lib/weather";
import {
  CONTRAST,
  FABRIC_WEIGHT,
  FORMALITY_EXCEPTIONS,
  FORMALITY_TOLERANCE,
  HEAVY_FABRIC_CEILING_C,
  HUE_BANDS,
  LIGHT_FABRIC_FLOOR_C,
  NO_SOCK_SHOES,
  OCCASION_RULES,
  RAIN_RULES,
  REQUIRED_CATEGORIES,
  bandFor,
  hueDistance,
  inferRegister,
  resolveColour,
  silhouetteOf,
  type ColourEntry,
} from "@/lib/styling/rulebook";

/**
 * Scoring a candidate outfit against the rulebook.
 *
 * Every rule returns a number and a sentence. The number ranks candidates; the
 * sentence is what the screen shows and what the model is told, so an outfit
 * can never be recommended for a reason the engine didn't actually apply.
 *
 * Two structural decisions:
 *
 * **Disqualification is separate from scoring.** A missing bottom or a coat
 * demanded by a 2°C morning isn't a low score, it's not an outfit — and
 * letting a strong colour story outweigh "you'll be cold" is exactly how a
 * scoring system produces something absurd. Hard constraints reject;
 * everything else adjusts.
 *
 * **Absent tags never penalise.** Roughly half this wardrobe arrives from
 * product pages that don't state a material, and an item with no formality
 * rating is unrated rather than badly rated. A rule that can't be evaluated
 * scores zero rather than guessing, so an under-tagged garment doesn't quietly
 * sink to the bottom of every ranking.
 */

export type ScoredOutfit = {
  items: WardrobeItem[];
  /** Set when this came from a saved outfit rather than being composed. */
  outfitId: string | null;
  score: number;
  /** Why it scored well, in the order the rules fired. */
  praise: string[];
  /** What's imperfect about it. Shown when the user asks. */
  gripes: string[];
};

export type ScoreContext = {
  occasion: Occasion;
  forecast: Forecast | null;
  /** item id → days since it was last worn. Absent means never worn. */
  daysSinceWorn: Map<string, number>;
  /** Northern/southern-agnostic season for today, from the date. */
  season: string;
  /**
   * Which categories the wardrobe can actually supply.
   *
   * Needed so the scorer can tell "you left the socks off" apart from "there
   * are no socks in this wardrobe". Without it, a closet with no socks
   * catalogued gets the same deduction on every single candidate — a constant
   * offset that changes no ranking and puts a complaint on every explanation
   * about something the user cannot fix from here.
   *
   * Omit it and nothing is assumed missing, which is the safe default for
   * callers that don't have the full wardrobe to hand.
   */
  available?: Set<Category>;
};

/** First recognisable colour on a garment, or null. */
function colourOf(item: WardrobeItem): ColourEntry | null {
  for (const name of item.colors) {
    const entry = resolveColour(name);
    if (entry) return entry;
  }
  return null;
}

function byCategory(items: WardrobeItem[], category: Category) {
  return items.filter((item) => item.category === category);
}

function textOf(item: WardrobeItem) {
  return `${item.subcategory ?? ""} ${item.material ?? ""}`.toLowerCase();
}

/**
 * Hard constraints. Returns the reason it's not wearable, or null.
 *
 * Deliberately short: a rule belongs here only when the outfit is genuinely
 * unwearable rather than merely worse, because anything listed here can make
 * the whole suggester return nothing on a small wardrobe.
 */
export function disqualify(
  items: WardrobeItem[],
  context: ScoreContext,
): string | null {
  for (const category of REQUIRED_CATEGORIES) {
    if (byCategory(items, category).length === 0) {
      return `No ${category}.`;
    }
  }

  const forecast = context.forecast;
  if (forecast) {
    const band = bandFor(forecast.feelsLikeMin);
    const wet = forecast.precipChance >= RAIN_RULES.chanceThreshold;
    const hasOuterwear = byCategory(items, "outerwear").length > 0;

    if (band.outerwear === "mandatory" && !hasOuterwear) {
      return `${forecast.feelsLikeMin}°C needs a coat.`;
    }
    if (wet && !hasOuterwear && band.outerwear !== "unneeded") {
      return "Rain, and nothing to put over it.";
    }
  }

  const rule = OCCASION_RULES[context.occasion];
  for (const item of items) {
    // Register, not formality: an athletic shoe is wrong at a formal occasion
    // whatever number the tagger gave it, and this is the one place that
    // distinction is worth refusing over rather than merely deducting for.
    if (rule.avoidRegisters.includes(inferRegister(item.subcategory))) {
      return `${item.subcategory ?? item.category} is the wrong register for ${context.occasion.replace("_", " ")}.`;
    }
  }

  return null;
}

export function scoreOutfit(
  items: WardrobeItem[],
  context: ScoreContext,
  outfitId: string | null = null,
): ScoredOutfit {
  let score = 0;
  const praise: string[] = [];
  const gripes: string[] = [];

  const add = (points: number, note: string, positive = points > 0) => {
    score += points;
    if (note) (positive ? praise : gripes).push(note);
  };

  const top = byCategory(items, "top")[0];
  const bottom = byCategory(items, "bottom")[0];
  const shoes = byCategory(items, "shoes")[0];
  const outerwear = byCategory(items, "outerwear")[0];
  const core = [top, bottom, shoes].filter(Boolean);

  // -- Weather ------------------------------------------------------------
  const forecast = context.forecast;
  if (forecast) {
    const band = bandFor(forecast.feelsLikeMin);
    const wet = forecast.precipChance >= RAIN_RULES.chanceThreshold;

    if (outerwear) {
      if (band.outerwear === "mandatory" || band.outerwear === "recommended") {
        add(3, `${outerwear.subcategory ?? "A layer"} for ${forecast.feelsLikeMin}°C.`);
      } else if (band.outerwear === "unneeded" && !wet) {
        add(-3, `You won't want a layer at ${forecast.feelsLikeMax}°C.`);
      }
    } else if (band.outerwear === "recommended") {
      add(-1, `Might want something over it at ${forecast.feelsLikeMin}°C.`);
    }

    if (wet && shoes) {
      const shoeText = textOf(shoes);
      if (RAIN_RULES.avoidShoeMaterials.some((m) => shoeText.includes(m))) {
        add(-4, `${shoes.subcategory ?? "Those shoes"} won't enjoy the rain.`);
      }
      if (RAIN_RULES.avoidShoeSubcategories.some((s) => shoeText.includes(s))) {
        add(-4, "Open shoes, in rain.");
      }
    }

    // Socks are their own category and only sometimes wanted. Below 10°C with
    // an enclosed shoe their absence is a real omission rather than a style
    // choice — the engine can't see an ankle, so the shoe has to say.
    //
    // Only raised when the wardrobe actually holds socks. Otherwise this is a
    // complaint about the catalogue rather than the outfit, and it would attach
    // to every candidate identically.
    const hasSocks = byCategory(items, "socks").length > 0;
    const socklessShoe =
      shoes && NO_SOCK_SHOES.some((s) => textOf(shoes).includes(s));
    const socksExist = context.available?.has("socks") ?? true;
    if (socksExist && !hasSocks && !socklessShoe && forecast.feelsLikeMin < 10) {
      add(-1, "Nothing on the socks front, and it's cold.");
    }

    // Fabric weight against the thermometer. Season tags would cover this if
    // they were always filled in; they aren't, and a wool jumper with no
    // seasons set would otherwise pass a 27°C afternoon unremarked.
    if (forecast.feelsLikeMax >= HEAVY_FABRIC_CEILING_C) {
      const heavy = items.filter((item) =>
        FABRIC_WEIGHT.heavy.some((fabric) => (item.material ?? "").toLowerCase().includes(fabric)),
      );
      // Shoes are exempt: leather shoes are worn all summer and always have
      // been. This rule is about what's against you, not what's under you.
      const heavyGarments = heavy.filter((item) => item.category !== "shoes");
      if (heavyGarments.length > 0) {
        add(
          -4 * heavyGarments.length,
          `${heavyGarments[0].material} at ${forecast.feelsLikeMax}°C.`,
        );
      }
    } else if (forecast.feelsLikeMin <= LIGHT_FABRIC_FLOOR_C) {
      const core = [top, bottom].filter(Boolean);
      const allLight =
        core.length > 0 &&
        core.every((item) =>
          FABRIC_WEIGHT.light.some((fabric) =>
            (item.material ?? "").toLowerCase().includes(fabric),
          ),
        );
      if (allLight) add(-3, `Summer fabrics at ${forecast.feelsLikeMin}°C.`);
    }
  }

  // -- Season -------------------------------------------------------------
  // Only counted when the item actually declares seasons; an untagged garment
  // is unrated, not out of season.
  const seasonal = items.filter((item) => item.seasons.length > 0);
  if (seasonal.length > 0) {
    const inSeason = seasonal.filter((item) =>
      item.seasons.includes(context.season),
    ).length;
    const ratio = inSeason / seasonal.length;
    if (ratio === 1) add(2, "Everything here is in season.");
    else if (ratio < 0.5) add(-2, "Several pieces are out of season.");
  }

  // -- Occasion and formality ---------------------------------------------
  const rule = OCCASION_RULES[context.occasion];
  const rated = core.filter((item) => typeof item.formality === "number");

  if (rated.length > 0) {
    const inRange = rated.filter(
      (item) =>
        item.formality! >= rule.formalityMin && item.formality! <= rule.formalityMax,
    ).length;
    if (inRange === rated.length) {
      add(3, `Pitched right for ${context.occasion.replace("_", " ")}.`);
    } else if (inRange === 0) {
      add(-4, `Too far off for ${context.occasion.replace("_", " ")}.`);
    } else {
      add(-1, "Mixed signals about how dressed-up this is.");
    }
  }

  // Formality coherence across the core three, asymmetric and bridge-aware.
  if (rated.length >= 2) {
    const levels = rated.map((item) => item.formality!);
    const spread = Math.max(...levels) - Math.min(...levels);
    const dressiest = rated[levels.indexOf(Math.max(...levels))];
    const plainest = rated[levels.indexOf(Math.min(...levels))];

    const excused = FORMALITY_EXCEPTIONS.find((exception) => {
      const a = textOf(dressiest);
      const b = textOf(plainest);
      return (
        exception.when.a.some((word) => a.includes(word)) &&
        exception.when.b.some((word) => b.includes(word))
      );
    });

    // The gap is being closed downward — a dressy piece worn casually — which
    // is the forgiving direction.
    const tolerance =
      FORMALITY_TOLERANCE.downward +
      (excused ? FORMALITY_TOLERANCE.bridgeBonus : 0);

    if (spread <= FORMALITY_TOLERANCE.upward) {
      add(2, "Everything sits at the same level.");
    } else if (spread <= tolerance) {
      if (excused) add(1, excused.note);
    } else {
      add(-2 * (spread - tolerance), "The pieces disagree about the occasion.");
    }
  }

  if (context.occasion === "work" && bottom && /jean|denim/.test(textOf(bottom))) {
    // Flagged, not refused. This is the point the sources split hardest on, so
    // it's a nudge you can ignore rather than a verdict.
    add(-1, "Denim at work — your call.");
  }

  // -- Silhouette ---------------------------------------------------------
  if (top && bottom) {
    const topShape = silhouetteOf(top.subcategory);
    const bottomShape = silhouetteOf(bottom.subcategory);
    if (topShape === "loose" && bottomShape === "loose") {
      add(-3, "Loose over loose — one half wants to be fitted.");
    } else if (topShape === "fitted" && bottomShape === "fitted") {
      add(-1, "Safe, if a little rigid.");
    } else if (
      (topShape === "loose" && bottomShape === "fitted") ||
      (topShape === "fitted" && bottomShape === "loose")
    ) {
      add(2, "The proportions balance.");
    }
  }

  // -- Colour -------------------------------------------------------------
  const colours = items
    .map((item) => ({ item, colour: colourOf(item) }))
    .filter((entry): entry is { item: WardrobeItem; colour: ColourEntry } =>
      entry.colour !== null,
    );

  if (colours.length >= 2) {
    const nonNeutral = colours.filter((entry) => !entry.colour.neutral);
    const families = new Set(nonNeutral.map((entry) => entry.colour.family));

    if (families.size === 0) {
      add(1, "All neutrals — quiet and hard to get wrong.");
    } else if (families.size === 1) {
      add(3, "One colour against neutrals.");
    } else if (families.size === 2) {
      const [a, b] = nonNeutral.filter(
        (entry, index, all) =>
          all.findIndex((other) => other.colour.family === entry.colour.family) === index,
      );
      if (a.colour.hue !== null && b.colour.hue !== null) {
        const distance = hueDistance(a.colour.hue, b.colour.hue);
        if (distance <= HUE_BANDS.analogous) {
          add(2, "Two colours that sit next to each other.");
        } else if (distance >= HUE_BANDS.complementaryLow) {
          add(1, "Opposites — works because one is clearly the accent.");
        } else if (
          distance >= HUE_BANDS.awkwardLow &&
          distance <= HUE_BANDS.awkwardHigh
        ) {
          add(-1, "Those two colours land in the flat middle distance.");
          // Warm against cool in that same middle band is the specific case
          // that reads muddy. Small, because the sourcing is thin.
          if (
            a.colour.temperature !== b.colour.temperature &&
            a.colour.temperature !== "neutral" &&
            b.colour.temperature !== "neutral"
          ) {
            add(-1, "");
          }
        }
      }
    } else {
      add(-2, `${families.size} colours going at once.`);
    }

    // Neutral anchor, and where it sits.
    const anchors = colours.filter((entry) => entry.colour.neutral);
    if (anchors.length === 0) {
      add(-2, "Nothing neutral to anchor it.");
    } else if (bottom && colourOf(bottom)?.neutral) {
      add(1, "Neutral bottom holding it together.");
    }
  }

  // Value contrast between top and bottom.
  const topColour = top ? colourOf(top) : null;
  const bottomColour = bottom ? colourOf(bottom) : null;
  if (topColour && bottomColour) {
    const delta = Math.abs(topColour.lightness - bottomColour.lightness);
    const sameFamily = topColour.family === bottomColour.family;
    const textured =
      Boolean(top?.pattern) ||
      Boolean(bottom?.pattern) ||
      (top?.material ?? "") !== (bottom?.material ?? "");

    if (sameFamily) {
      if (delta < CONTRAST.flat) {
        // Texture standing in for value contrast is a real escape hatch, and
        // this wardrobe's materials are tagged often enough to test it.
        if (!textured) add(-2, "Same colour, same depth — reads accidental.");
      } else if (delta <= CONTRAST.tonalMax) {
        add(3, "Tonal, and deliberately so.");
      } else {
        add(1, "Light against dark in one family.");
      }
    } else {
      const bothLight =
        topColour.lightness > CONTRAST.lightEnd &&
        bottomColour.lightness > CONTRAST.lightEnd;
      const bothDark =
        topColour.lightness < CONTRAST.darkEnd &&
        bottomColour.lightness < CONTRAST.darkEnd;

      if (bothLight || bothDark) {
        // A mid-toned third piece breaks up two pieces at the same end.
        const breaker = items.some((item) => {
          if (item === top || item === bottom) return false;
          const colour = colourOf(item);
          return (
            colour !== null &&
            colour.lightness >= CONTRAST.darkEnd &&
            colour.lightness <= CONTRAST.lightEnd
          );
        });
        if (!breaker) {
          add(-1, bothDark ? "All dark, with nothing to break it." : "All pale, with nothing to break it.");
        }
      } else if (delta >= CONTRAST.clear) {
        add(1, "Clean contrast top to bottom.");
      }
    }
  }

  // -- Pattern ------------------------------------------------------------
  const patterned = items.filter(
    (item) => item.pattern && item.pattern.toLowerCase() !== "solid",
  );
  if (patterned.length === 1) {
    add(1, `One pattern, everything else plain.`);
  } else if (patterned.length === 2) {
    const [a, b] = patterned;
    const sameType = (a.pattern ?? "").toLowerCase() === (b.pattern ?? "").toLowerCase();
    const sharedColour = a.colors.some((colour) => {
      const resolved = resolveColour(colour);
      return b.colors.some(
        (other) => resolveColour(other)?.family === resolved?.family,
      );
    });
    // The engine can't see stripe width, so the same-type case is a mild
    // caution rather than the confident penalty the sources would justify.
    if (sameType) add(-1, "Two of the same pattern — they'll compete.");
    if (sharedColour) add(1, "The two patterns share a colour.");
    else add(-1, "The patterns have no colour in common.");
  } else if (patterned.length > 2) {
    add(-3, `${patterned.length} patterns is past the limit.`);
  }

  // -- Accessories --------------------------------------------------------
  // Weighted by occasion: an accessory is close to required for going out and
  // barely registers for a Tuesday. It never counts toward completeness.
  const accessories = byCategory(items, "accessory");
  if (accessories.length > 0) {
    add(rule.accessoryWeight, "");
  } else if (rule.accessoryWeight >= 1.5) {
    add(-1, "Nothing finishing it off.");
  }

  // -- Recency ------------------------------------------------------------
  // The point of the daily screen is not to recommend yesterday's clothes.
  // Scaled rather than binary, so a piece worn last week is only slightly
  // discouraged and one worn yesterday is strongly so.
  let recencyPenalty = 0;
  let mostRecent = Infinity;
  for (const item of items) {
    const days = context.daysSinceWorn.get(item.id);
    if (days === undefined) continue;
    mostRecent = Math.min(mostRecent, days);
    if (days <= 1) recencyPenalty += 4;
    else if (days <= 3) recencyPenalty += 2;
    else if (days <= 7) recencyPenalty += 0.5;
  }
  if (recencyPenalty > 0) {
    add(
      -recencyPenalty,
      mostRecent <= 1 ? "You wore some of this yesterday." : "Worn fairly recently.",
    );
  } else if (items.every((item) => !context.daysSinceWorn.has(item.id))) {
    add(1, "Nothing here has been worn yet.");
  }

  // -- Tag confidence -----------------------------------------------------
  // An unreviewed item's tags are a model's guess, and every rule above ran on
  // those tags. A small deduction keeps unchecked rows from winning on the
  // strength of numbers nobody has confirmed.
  const unchecked = items.filter((item) => item.needs_review).length;
  if (unchecked > 0) {
    add(-0.5 * unchecked, "");
  }

  return {
    items,
    outfitId,
    score: Math.round(score * 10) / 10,
    praise: praise.filter(Boolean),
    gripes: gripes.filter(Boolean),
  };
}

/** Which season today falls in, by hemisphere. */
export function seasonFor(date: Date, latitude: number | null): string {
  const month = date.getMonth(); // 0-11
  const northern = [
    "winter", "winter", "spring", "spring", "spring", "summer",
    "summer", "summer", "autumn", "autumn", "autumn", "winter",
  ][month];
  if (latitude !== null && latitude < 0) {
    const flip: Record<string, string> = {
      winter: "summer",
      summer: "winter",
      spring: "autumn",
      autumn: "spring",
    };
    return flip[northern];
  }
  return northern;
}
