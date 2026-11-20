/**
 * Is the page the kind of garment the brief asked for?
 *
 * The grounded model sometimes hands back a real, priced, in-stock page for
 * the wrong thing — observed 2026-11-18: an L.L.Bean earband for "black
 * lightweight packable down jacket". This is the cheapest check that catches
 * that and can be explained in one sentence: **the page's own product name
 * must name the same kind of garment as the brief.**
 *
 * "Kind" is a small word list, below, grouped so that synonyms agree (a chino
 * is a trouser, a tee is a t-shirt, a parka is a jacket). The comparison is
 * one-directional and deliberately lenient:
 *
 *   - `match` — the page names a kind the brief names.
 *   - `mismatch` — the page names some kind, and none of them is one the brief
 *     names. This is the only verdict that drops a result (`off_brief`).
 *   - `unknown` — the page's name doesn't name a garment kind at all
 *     ("Cavalier | Dark Brown", "Stockman - Fudge"). Kept: a name like that is
 *     usually a real product with a brand-ish name, and dropping it would cost
 *     more true matches than it saves.
 *
 * The page's own names are what is judged — never the model's title, and
 * never the URL slug when the page names the item, because they disagree: a
 * Proper Cloth URL whose slug says "oxford-cloth-button-down" served a page
 * titled "Japanese Dark Indigo Chambray Shirt". The names are tried in order
 * (JSON-LD Product name, `<title>`, `og:title` — see `readTitles`) and the
 * first that names a kind decides; Florsheim's og:title "Rucci Lug by
 * Florsheim Shoes" names none, its `<title>` "Rucci Lug Plain Toe Chelsea
 * Boot" does. Only when no name names a kind is secondary evidence read — the page's breadcrumbs and Product `category`,
 * then the final URL's path — and that evidence can only turn `unknown` into
 * `match`, never into `mismatch`: Nudie files its jeans under the category
 * "Clothing > Pants", with the breadcrumb "Men's Jeans".
 *
 * Fabric, colour and fit are not checked. "Oxford" vs "chambray" is a real
 * miss that this lets through; catching it needs more than a word list, and
 * a word list that tried would start rejecting "button-down shirt" for an
 * "oxford" brief.
 */

const KINDS: Record<string, string[]> = {
  sweater: ["sweater", "jumper", "pullover", "cardigan", "knitwear"],
  tee: ["tee", "tshirt"],
  shirt: ["shirt", "buttondown", "button-down", "overshirt", "blouse"],
  polo: ["polo"],
  sweatshirt: ["sweatshirt", "hoodie"],
  jeans: ["jean", "jeans", "denim"],
  trousers: ["chino", "chinos", "trouser", "trousers", "pant", "pants", "slacks"],
  shorts: ["shorts"],
  skirt: ["skirt"],
  dress: ["dress"],
  sneakers: ["sneaker", "sneakers", "trainer", "trainers", "plimsoll"],
  boots: ["boot", "boots"],
  shoes: ["loafer", "loafers", "derby", "sandal", "sandals", "slipper", "slippers", "mule", "mules"],
  jacket: ["jacket", "coat", "parka", "puffer", "anorak", "overcoat", "peacoat", "windbreaker"],
  vest: ["vest", "gilet"],
  headwear: ["beanie", "hat", "cap", "toque", "earband", "headband", "balaclava"],
  scarf: ["scarf"],
  gloves: ["glove", "gloves", "mitten", "mittens"],
  socks: ["sock", "socks"],
  bag: ["bag", "tote", "backpack", "wallet"],
  belt: ["belt"],
};

/** When the brief's own title names no kind, its category stands in. */
const CATEGORY_KINDS: Record<string, string[]> = {
  top: ["sweater", "tee", "shirt", "polo", "sweatshirt"],
  bottom: ["jeans", "trousers", "shorts", "skirt"],
  shoes: ["sneakers", "boots", "shoes"],
  outerwear: ["jacket", "vest"],
  accessory: ["headwear", "scarf", "gloves", "socks", "bag", "belt"],
};

const WORD_TO_KIND = new Map<string, string>();
for (const [kind, words] of Object.entries(KINDS)) {
  for (const word of words) WORD_TO_KIND.set(word, kind);
}

/** The garment kinds a piece of text names. */
export function kindsIn(text: string): Set<string> {
  const normalised = text
    .toLowerCase()
    // "T-shirt", "t shirt", "tshirt" are one word here, and not a "shirt".
    .replace(/\bt[\s-]?shirts?\b/g, " tshirt ")
    .replace(/\bbutton[\s-]?downs?\b/g, " buttondown ")
    .replace(/[^a-z]+/g, " ");
  const kinds = new Set<string>();
  for (const word of normalised.split(" ")) {
    const kind = WORD_TO_KIND.get(word);
    if (kind) kinds.add(kind);
  }
  return kinds;
}

export type Relevance = "match" | "mismatch" | "unknown";

export function briefKinds(title: string, category?: string | null): Set<string> {
  const kinds = kindsIn(title);
  if (kinds.size === 0 && category) for (const kind of CATEGORY_KINDS[category] ?? []) kinds.add(kind);
  return kinds;
}

export function judgeRelevance(
  brief: { title: string; category?: string | null },
  page: { titles: (string | null)[]; url: string; hints?: string[] },
): Relevance {
  const wanted = briefKinds(brief.title, brief.category);
  if (wanted.size === 0) return "unknown";

  for (const title of page.titles) {
    const named = kindsIn(title ?? "");
    if (named.size === 0) continue;
    for (const kind of named) if (wanted.has(kind)) return "match";
    return "mismatch";
  }

  let path = "";
  try {
    path = new URL(page.url).pathname.replace(/[-_/]+/g, " ");
  } catch {
    path = "";
  }
  for (const evidence of [...(page.hints ?? []), path]) {
    for (const kind of kindsIn(evidence)) if (wanted.has(kind)) return "match";
  }
  return "unknown";
}
