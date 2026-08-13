/**
 * The shared vocabulary for a garment.
 *
 * These lists mirror the Postgres enums in `0001_initial_schema.sql`. They live
 * in one file because four places need to agree on them: the Gemini response
 * schema, the review grid's controls, the validation that runs before an insert,
 * and (from Phase 2) the outfit canvas's layer ordering. Duplicating the strings
 * in each is how you end up with a category the database rejects at 2am.
 *
 * Safe to import from both server and client code — no secrets, no node APIs.
 */

export const CATEGORIES = [
  "top",
  "bottom",
  "outerwear",
  "shoes",
  "socks",
  "accessory",
] as const;

export type Category = (typeof CATEGORIES)[number];

export const CATEGORY_LABELS: Record<Category, string> = {
  top: "Top",
  bottom: "Bottom",
  outerwear: "Outerwear",
  shoes: "Shoes",
  socks: "Socks",
  accessory: "Accessory",
};

export const SEASONS = ["spring", "summer", "autumn", "winter"] as const;

export type Season = (typeof SEASONS)[number];

export const SEASON_LABELS: Record<Season, string> = {
  spring: "Spring",
  summer: "Summer",
  autumn: "Autumn",
  winter: "Winter",
};

/**
 * Formality is 1–5 in the schema. Bare numbers are meaningless in a picker, so
 * each step gets a name — and the names are wardrobe language, not a Likert
 * scale.
 */
export const FORMALITY_LABELS: Record<number, string> = {
  1: "Lounge",
  2: "Casual",
  3: "Smart casual",
  4: "Sharp",
  5: "Formal",
};

/** What the auto-tagger produces, and what the review grid edits. */
export type GarmentTags = {
  category: Category;
  subcategory: string | null;
  colors: string[];
  pattern: string | null;
  material: string | null;
  formality: number | null;
  seasons: Season[];
};

export function isCategory(value: unknown): value is Category {
  return (
    typeof value === "string" && (CATEGORIES as readonly string[]).includes(value)
  );
}

export function isSeason(value: unknown): value is Season {
  return typeof value === "string" && (SEASONS as readonly string[]).includes(value);
}

function cleanString(value: unknown, maxLength = 80): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim().slice(0, maxLength);
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * Narrows anything shaped roughly like tags into tags we'd let near the
 * database.
 *
 * Both entry points run through here: a model's JSON response and a form
 * submission. Neither is trusted — the model can invent a category despite the
 * response schema, and a form post can be hand-crafted. Anything unrecognised
 * is dropped rather than rejected, because losing a colour is better than
 * failing an import the user just waited 30 seconds for.
 */
export function coerceTags(raw: unknown, fallbackCategory: Category = "top"): GarmentTags {
  const input = (raw ?? {}) as Record<string, unknown>;

  const formalityRaw = Number(input.formality);
  const formality = Number.isFinite(formalityRaw)
    ? Math.min(5, Math.max(1, Math.round(formalityRaw)))
    : null;

  return {
    category: isCategory(input.category) ? input.category : fallbackCategory,
    subcategory: cleanString(input.subcategory, 60),
    colors: Array.isArray(input.colors)
      ? input.colors
          .map((color) => cleanString(color, 30))
          .filter((color): color is string => color !== null)
          .slice(0, 3)
      : [],
    pattern: cleanString(input.pattern, 40),
    material: cleanString(input.material, 60),
    formality,
    seasons: Array.isArray(input.seasons)
      ? [...new Set(input.seasons.filter(isSeason))]
      : [],
  };
}

/**
 * Formats cents for display. Intake shows prices scraped from wildly
 * inconsistent retailer markup, so the currency is whatever the page claimed.
 */
export function formatPrice(cents: number | null, currency: string | null) {
  if (cents === null) return null;
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency: currency ?? "USD",
      maximumFractionDigits: cents % 100 === 0 ? 0 : 2,
    }).format(cents / 100);
  } catch {
    // An unknown currency code from a retailer's JSON-LD shouldn't break a card.
    return `${(cents / 100).toFixed(2)} ${currency ?? ""}`.trim();
  }
}
