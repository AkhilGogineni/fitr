import { CATEGORIES, CATEGORY_LABELS, type Category } from "@/lib/garments";
import type { WardrobeItem } from "@/lib/items";
import { COLOUR_TAXONOMY, inferRegister } from "@/lib/styling/rulebook";
import { disqualify, scoreOutfit, type ScoreContext } from "@/lib/styling/score";

/**
 * "Does this actually work with what I own?"
 *
 * The anti-waste feature, and the one that has to be willing to say no. A
 * shopping tool that answers "yes, and here are three ways to wear it" for
 * every single candidate is not answering the question — it's flattering the
 * purchase. So this returns a verdict of three kinds and the middle one,
 * `thin`, is the useful one: it works, but only one way, with one pair of
 * shoes, which is usually the honest state of a marginal buy.
 *
 * It runs on attributes rather than image embeddings, deliberately. At thirty
 * to three hundred garments, "charcoal trousers at formality 3 go with this"
 * is both more accurate and more explicable than a cosine distance — and the
 * explanation is most of the value, because the answer is meant to change a
 * decision. The `embedding` column is in the schema and stays empty; when the
 * wardrobe is large enough for visual similarity to beat tags, this is the file
 * that gets a second opinion added to it.
 */

/** A candidate product, shaped like a garment so the scorer can read it. */
export type ProspectiveItem = Pick<
  WardrobeItem,
  "subcategory" | "colors" | "material" | "pattern" | "formality" | "seasons"
> & {
  title: string;
  /**
   * Narrower than `WardrobeItem.category`, which is the raw `string` a Postgres
   * enum comes back as. A prospect's category is always one this code chose, so
   * it can carry the narrow type and save every caller a cast.
   */
  category: Category;
};

export type FitVerdict = "works" | "thin" | "no";

export type FitResult = {
  verdict: FitVerdict;
  /** One sentence, written to be shown as-is. */
  note: string;
  /** Real outfits from real pieces, best first. Empty when the verdict is "no". */
  outfits: { items: WardrobeItem[]; score: number; praise: string[] }[];
  /** What the wardrobe would need for this to work. Empty unless it's thin or no. */
  missing: Category[];
};

/**
 * Guesses a garment's attributes from its listing text.
 *
 * A retailer's title carries more than it looks — "Merino Wool Overshirt in
 * Charcoal" gives a category, a material and a colour. This is the same job the
 * vision tagger does from a photo, done from words, and it is deliberately
 * conservative: a field it can't read stays null, and every rule in the scorer
 * skips a null rather than guessing.
 */
export function describeProspect(
  title: string,
  hints: { category?: Category | null; description?: string | null } = {},
): ProspectiveItem {
  const text = `${title} ${hints.description ?? ""}`.toLowerCase();

  const CATEGORY_WORDS: Record<Category, string[]> = {
    top: ["shirt", "tee", "t-shirt", "sweater", "knit", "jumper", "polo", "blouse", "cardigan", "hoodie", "sweatshirt", "vest", "henley", "overshirt"],
    bottom: ["trouser", "pant", "jean", "chino", "short", "skirt", "slacks"],
    outerwear: ["jacket", "coat", "parka", "blazer", "trench", "anorak", "gilet", "bomber"],
    shoes: ["shoe", "boot", "sneaker", "trainer", "loafer", "oxford", "derby", "sandal", "mule"],
    socks: ["sock"],
    accessory: ["belt", "scarf", "hat", "cap", "bag", "glove", "watch", "tie", "sunglasses"],
  };

  const category =
    hints.category ??
    CATEGORIES.find((entry) =>
      CATEGORY_WORDS[entry].some((word) => text.includes(word)),
    ) ??
    "top";

  const colors = Object.keys(COLOUR_TAXONOMY).filter((name) =>
    new RegExp(`\\b${name}\\b`).test(text),
  );

  const MATERIALS = ["wool", "merino", "cotton", "linen", "cashmere", "denim", "leather", "suede", "silk", "nylon", "corduroy", "fleece"];
  const material = MATERIALS.find((word) => text.includes(word)) ?? null;

  const PATTERNS = ["striped", "stripe", "check", "plaid", "floral", "printed", "herringbone", "houndstooth"];
  const pattern = PATTERNS.find((word) => text.includes(word)) ?? null;

  // Formality from register, which is itself inferred from the words. Coarse,
  // and left null where the text gives no signal at all rather than defaulting
  // to a middle value the scorer would then treat as fact.
  const register = inferRegister(title);
  const formality =
    register === "tailored" ? 4 : register === "athletic" || register === "lounge" ? 1 : register === "beach" ? 1 : null;

  return {
    title,
    category,
    subcategory: title.slice(0, 60),
    colors: colors.slice(0, 3),
    material,
    pattern,
    formality,
    seasons: [],
  };
}

/** Wraps a prospect so the scorer, which expects rows, can read it. */
function asWardrobeItem(prospect: ProspectiveItem): WardrobeItem {
  return {
    id: "prospect",
    category: prospect.category,
    subcategory: prospect.subcategory,
    brand: null,
    colors: prospect.colors,
    pattern: prospect.pattern,
    material: prospect.material,
    formality: prospect.formality,
    seasons: prospect.seasons,
    image_cutout_key: "",
    image_original_key: null,
    source_url: null,
    purchase_price_cents: null,
    // Its tags are inferred from a product title, which is exactly the state
    // `needs_review` describes — and the scorer's small deduction for that is
    // appropriate here rather than something to work around.
    needs_review: true,
    created_at: new Date().toISOString(),
  };
}

/** How many of each supporting category are tried. Keeps this well under a second. */
const TRY_PER_CATEGORY = 5;

export function assessFit(
  prospect: ProspectiveItem,
  wardrobe: WardrobeItem[],
  context: ScoreContext,
): FitResult {
  const candidateItem = asWardrobeItem(prospect);
  const slot = prospect.category;

  // Everything the prospect isn't. It fills its own slot, so a second top is
  // not a supporting piece — it's a competitor.
  const pool = (category: Category) =>
    wardrobe.filter((item) => item.category === category).slice(0, TRY_PER_CATEGORY);

  const needed: Category[] = (["top", "bottom", "shoes"] as Category[]).filter(
    (category) => category !== slot,
  );

  const missing = needed.filter((category) => pool(category).length === 0);
  if (missing.length > 0) {
    return {
      verdict: "no",
      note: `Nothing to wear this with — there's no ${missing
        .map((category) => CATEGORY_LABELS[category].toLowerCase())
        .join(" and no ")} in the wardrobe yet.`,
      outfits: [],
      missing,
    };
  }

  // Enumerate the supporting cast. Three categories at five each is at most
  // 125 combinations, which is nothing.
  const combos: WardrobeItem[][] = [[candidateItem]];
  for (const category of needed) {
    const next: WardrobeItem[][] = [];
    for (const partial of combos) {
      for (const item of pool(category)) next.push([...partial, item]);
    }
    combos.splice(0, combos.length, ...next);
  }

  const scored = combos
    .filter((set) => disqualify(set, context) === null)
    .map((set) => scoreOutfit(set, context))
    .sort((a, b) => b.score - a.score);

  // The threshold is what makes this able to say no. A set that merely passed
  // the hard constraints isn't an endorsement — a coat and trousers that
  // technically coexist is not "this works".
  const good = scored.filter((outfit) => outfit.score >= 6);
  const passable = scored.filter((outfit) => outfit.score >= 2);

  if (good.length >= 2) {
    return {
      verdict: "works",
      note: `Works with things you own — ${good.length} combinations, best of them ${describeSet(good[0].items, slot)}.`,
      outfits: good.slice(0, 3).map(summarise),
      missing: [],
    };
  }

  if (passable.length >= 1) {
    return {
      verdict: "thin",
      note: `Only really works one way: ${describeSet(passable[0].items, slot)}. Worth knowing before you buy it.`,
      outfits: passable.slice(0, 2).map(summarise),
      missing: [],
    };
  }

  // The genuinely useful negative. Naming the gap is the difference between
  // "no" and a reason not to buy it.
  const gap = needed.find((category) => pool(category).length > 0) ?? needed[0];
  return {
    verdict: "no",
    note: `Nothing in the wardrobe works with this. You'd be buying the ${CATEGORY_LABELS[gap].toLowerCase()} to go with it too.`,
    outfits: [],
    missing: [gap],
  };
}

function summarise(outfit: { items: WardrobeItem[]; score: number; praise: string[] }) {
  return {
    // The prospect itself isn't a wardrobe row and shouldn't be rendered as one.
    items: outfit.items.filter((item) => item.id !== "prospect"),
    score: outfit.score,
    praise: outfit.praise,
  };
}

function describeSet(items: WardrobeItem[], exclude: Category) {
  return items
    .filter((item) => item.id !== "prospect" && item.category !== exclude)
    .map(
      (item) =>
        item.subcategory ?? item.brand ?? CATEGORY_LABELS[item.category as Category].toLowerCase(),
    )
    .slice(0, 3)
    .join(" and ");
}
