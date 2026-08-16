import type { Category } from "@/lib/garments";
import type { Occasion } from "@/lib/outfits";

/**
 * The rulebook: what this app believes about putting clothes together.
 *
 * This file is data, not logic. `score.ts` evaluates it and `pick.ts` hands a
 * prose rendering of it to a language model, so the number that penalises an
 * outfit and the sentence explaining the penalty come from the same source and
 * cannot drift apart.
 *
 * It was assembled from a survey of styling sources rather than invented — the
 * research notes behind it are cited per rule. Three things about that are
 * worth knowing before changing anything here:
 *
 * 1. **Weight tracks confidence, deliberately.** Where the sources agreed
 *    unanimously (belt and shoes match; two patterns is the cap; you need a
 *    neutral anchor) the adjustment is large. Where they actively disagreed
 *    (black with navy, sockless with a suit) it is ±1 — present, because the
 *    concern is real, but never enough to decide an outfit on its own. A
 *    contested rule encoded as a hard gate is worse than no rule, because it
 *    is confidently wrong instead of usefully unsure.
 *
 * 2. **Every numeric threshold here is calibration, not measurement.** No
 *    source gives an hue-distance cutoff or a lightness delta; styling writing
 *    is qualitative. "Analogous" became ≤40°, "flat tonal" became <0.12
 *    lightness apart. They are a starting point to tune against real outfits
 *    and real feedback, and the wear log is what will eventually let that
 *    happen.
 *
 * 3. **Trend claims rot; structure doesn't.** The temperature bands, the volume
 *    rule and the formality tolerances will still be true in five years. The
 *    entries under `TREND_NOTES` are dated 2026 and carry an explicit review
 *    date, because a trend baked into code with no expiry becomes a bug that
 *    nobody recognises as one.
 */

// ---------------------------------------------------------------------------
// Colour
// ---------------------------------------------------------------------------

export type ColourEntry = {
  /** The family used for "same colour family" tests. */
  family: string;
  /**
   * True for colours that pair with nearly anything and don't count against
   * the outfit's colour budget.
   *
   * Note this is a wardrobe convention, not colour theory: only black, white
   * and grey are neutral in the strict sense, and navy, camel, tan and taupe
   * are honorary neutrals because they don't compete. Every source surveyed
   * treats them that way, so the app does too.
   */
  neutral: boolean;
  /** Degrees on the wheel, 0–360. Meaningless for achromatics — hence null. */
  hue: number | null;
  /** 0 = black, 1 = white. Drives every contrast rule. */
  lightness: number;
  /** Warm and cool cast, where it's clear enough to be worth knowing. */
  temperature: "warm" | "cool" | "neutral";
};

/**
 * The colour words a vision tagger actually emits, resolved to numbers.
 *
 * These swatch values are representative estimates, not measurements — brands
 * and dye lots disagree wildly about what "olive" or "taupe" means. `taupe` is
 * the worst offender: dictionary taupe is a dark chocolate-grey and garment
 * taupe is usually much lighter. The lighter reading is used because that is
 * what arrives on clothes, and its uncertainty is why no rule leans hard on it.
 */
export const COLOUR_TAXONOMY: Record<string, ColourEntry> = {
  black: { family: "grey", neutral: true, hue: null, lightness: 0.05, temperature: "neutral" },
  charcoal: { family: "grey", neutral: true, hue: 204, lightness: 0.26, temperature: "cool" },
  grey: { family: "grey", neutral: true, hue: null, lightness: 0.5, temperature: "neutral" },
  slate: { family: "grey", neutral: true, hue: 210, lightness: 0.5, temperature: "cool" },
  silver: { family: "grey", neutral: true, hue: null, lightness: 0.75, temperature: "cool" },
  white: { family: "off-white", neutral: true, hue: null, lightness: 0.98, temperature: "neutral" },
  cream: { family: "off-white", neutral: true, hue: 57, lightness: 0.91, temperature: "warm" },
  ivory: { family: "off-white", neutral: true, hue: 55, lightness: 0.93, temperature: "warm" },
  ecru: { family: "off-white", neutral: true, hue: 45, lightness: 0.63, temperature: "warm" },
  oatmeal: { family: "tan", neutral: true, hue: 34, lightness: 0.78, temperature: "warm" },
  stone: { family: "tan", neutral: true, hue: 36, lightness: 0.68, temperature: "warm" },
  beige: { family: "tan", neutral: true, hue: 35, lightness: 0.72, temperature: "warm" },
  taupe: { family: "tan", neutral: true, hue: 31, lightness: 0.66, temperature: "warm" },
  tan: { family: "tan", neutral: true, hue: 34, lightness: 0.69, temperature: "warm" },
  khaki: { family: "tan", neutral: true, hue: 37, lightness: 0.67, temperature: "warm" },
  camel: { family: "tan", neutral: true, hue: 33, lightness: 0.59, temperature: "warm" },
  brown: { family: "brown", neutral: true, hue: 25, lightness: 0.32, temperature: "warm" },
  chocolate: { family: "brown", neutral: true, hue: 22, lightness: 0.22, temperature: "warm" },
  navy: { family: "blue", neutral: true, hue: 212, lightness: 0.14, temperature: "cool" },
  denim: { family: "blue", neutral: true, hue: 213, lightness: 0.38, temperature: "cool" },
  blue: { family: "blue", neutral: false, hue: 215, lightness: 0.45, temperature: "cool" },
  teal: { family: "teal", neutral: false, hue: 180, lightness: 0.35, temperature: "cool" },
  olive: { family: "green", neutral: false, hue: 65, lightness: 0.33, temperature: "warm" },
  sage: { family: "green", neutral: false, hue: 89, lightness: 0.61, temperature: "cool" },
  forest: { family: "green", neutral: false, hue: 152, lightness: 0.24, temperature: "cool" },
  green: { family: "green", neutral: false, hue: 130, lightness: 0.4, temperature: "cool" },
  mustard: { family: "yellow", neutral: false, hue: 42, lightness: 0.55, temperature: "warm" },
  yellow: { family: "yellow", neutral: false, hue: 55, lightness: 0.6, temperature: "warm" },
  rust: { family: "orange", neutral: false, hue: 19, lightness: 0.45, temperature: "warm" },
  orange: { family: "orange", neutral: false, hue: 30, lightness: 0.55, temperature: "warm" },
  burgundy: { family: "red", neutral: false, hue: 344, lightness: 0.3, temperature: "warm" },
  red: { family: "red", neutral: false, hue: 0, lightness: 0.45, temperature: "warm" },
  pink: { family: "pink", neutral: false, hue: 340, lightness: 0.75, temperature: "warm" },
  purple: { family: "purple", neutral: false, hue: 275, lightness: 0.4, temperature: "cool" },
  lilac: { family: "purple", neutral: false, hue: 280, lightness: 0.75, temperature: "cool" },
};

/**
 * Resolves whatever the tagger said into an entry.
 *
 * The tagger is told to answer in plain colour words, but it produces
 * "washed indigo" and "light heather grey" anyway, so an exact lookup would
 * miss most of the time. Longest-substring wins, so "dark olive" resolves to
 * olive rather than to nothing — and an unrecognised word returns null, which
 * every rule treats as "don't score this", never as a default colour.
 */
export function resolveColour(name: string | null | undefined): ColourEntry | null {
  if (!name) return null;
  const needle = name.toLowerCase().trim();
  if (COLOUR_TAXONOMY[needle]) return COLOUR_TAXONOMY[needle];

  let best: ColourEntry | null = null;
  let bestLength = 0;
  for (const [key, entry] of Object.entries(COLOUR_TAXONOMY)) {
    if (needle.includes(key) && key.length > bestLength) {
      best = entry;
      bestLength = key.length;
    }
  }

  // Modifiers the tagger loves and the table doesn't carry. Applied after the
  // family is known, so "light olive" is olive with the lightness moved rather
  // than an unknown colour.
  if (best) {
    if (/\b(light|pale|washed|faded|pastel)\b/.test(needle)) {
      return { ...best, lightness: Math.min(0.95, best.lightness + 0.18) };
    }
    if (/\b(dark|deep|midnight|espresso)\b/.test(needle)) {
      return { ...best, lightness: Math.max(0.05, best.lightness - 0.15) };
    }
  }
  return best;
}

/** Circular distance between two hues, 0–180. */
export function hueDistance(a: number, b: number) {
  const raw = Math.abs(a - b) % 360;
  return raw > 180 ? 360 - raw : raw;
}

/**
 * Hue-relationship thresholds.
 *
 * Calibration, not sourced fact. "Analogous" and "complementary" are described
 * qualitatively everywhere and numerically nowhere; the awkward middle band is
 * the interesting one, and it comes from a repeated specific complaint (navy
 * with olive or mustard "reads flat") rather than from the wheel itself.
 */
export const HUE_BANDS = {
  monochrome: 15,
  analogous: 40,
  awkwardLow: 60,
  awkwardHigh: 120,
  complementaryLow: 150,
} as const;

/** Lightness-delta thresholds for the contrast rules. Also calibration. */
export const CONTRAST = {
  /** Below this, a same-family pairing reads as accidental rather than tonal. */
  flat: 0.12,
  /** The tonal-dressing sweet spot's upper edge. */
  tonalMax: 0.45,
  /** Above this, top and bottom are plainly contrasted. */
  clear: 0.25,
  lightEnd: 0.65,
  darkEnd: 0.35,
} as const;

// ---------------------------------------------------------------------------
// Register — the thing formality 1–5 can't say
// ---------------------------------------------------------------------------

/**
 * A garment's register: which world it comes from.
 *
 * The numeric formality field cannot express why a gym short and an oxford
 * shirt don't go together. Both are within a point of each other, and the
 * pairing is still plainly wrong — the mismatch is athletic against tailored,
 * not 1 against 3. Rather than add a column and re-tag every garment, register
 * is inferred from the subcategory text that intake already wrote.
 */
export const REGISTERS = [
  "tailored",
  "casual",
  "athletic",
  "utility",
  "beach",
  "lounge",
] as const;
export type Register = (typeof REGISTERS)[number];

const REGISTER_KEYWORDS: Record<Register, string[]> = {
  tailored: [
    "suit", "blazer", "sport coat", "sportcoat", "dress shirt", "oxford shirt",
    "dress trouser", "trouser", "slacks", "waistcoat", "tie", "oxford", "derby",
    "brogue", "loafer", "monk", "dress short",
  ],
  casual: [
    "t-shirt", "tee", "jean", "denim", "chino", "sweater", "knit", "cardigan",
    "hoodie", "sweatshirt", "polo", "flannel", "henley", "chelsea", "sneaker",
    "trainer", "boot", "overshirt", "chore",
  ],
  athletic: [
    "gym", "running", "track", "jersey", "athletic", "sport short", "legging",
    "compression", "trainer sock", "windbreaker", "performance",
  ],
  utility: ["cargo", "utility", "workwear", "carhartt", "coverall", "field jacket"],
  beach: ["swim", "board short", "sandal", "flip-flop", "flip flop", "slide", "espadrille"],
  lounge: ["pyjama", "pajama", "sweatpant", "lounge", "slipper", "robe"],
};

export function inferRegister(subcategory: string | null | undefined): Register {
  const needle = (subcategory ?? "").toLowerCase();
  if (!needle) return "casual";
  // Checked most-specific-first: "sport short" must beat "sport coat"'s prefix,
  // and athletic/beach/lounge are the registers whose misplacement actually
  // ruins an outfit, so they get first refusal.
  for (const register of ["athletic", "beach", "lounge", "utility", "tailored"] as const) {
    if (REGISTER_KEYWORDS[register].some((word) => needle.includes(word))) {
      return register;
    }
  }
  return "casual";
}

// ---------------------------------------------------------------------------
// Silhouette — the volume rule
// ---------------------------------------------------------------------------

/**
 * The one rule every source agreed on without qualification: at most one half
 * of an outfit is allowed to be voluminous. Loose over loose reads as a
 * mistake; fitted over fitted is merely a bit stiff — so the two penalties are
 * deliberately not the same size.
 */
export const LOOSE_KEYWORDS = [
  "oversized", "wide-leg", "wide leg", "relaxed", "boxy", "palazzo", "chunky",
  "baggy", "cargo", "slouchy", "balloon", "pleated",
];

export const FITTED_KEYWORDS = [
  "slim", "tapered", "skinny", "fitted", "cropped", "straight", "skinny-fit",
  "narrow", "pencil",
];

export function silhouetteOf(
  subcategory: string | null | undefined,
): "loose" | "fitted" | "unknown" {
  const needle = (subcategory ?? "").toLowerCase();
  if (!needle) return "unknown";
  if (LOOSE_KEYWORDS.some((word) => needle.includes(word))) return "loose";
  if (FITTED_KEYWORDS.some((word) => needle.includes(word))) return "fitted";
  return "unknown";
}

// ---------------------------------------------------------------------------
// Formality
// ---------------------------------------------------------------------------

/**
 * How far apart two pieces may sit on the 1–5 scale.
 *
 * Asymmetric, which is the non-obvious part. A blazer over a t-shirt is a
 * recognised look; a hoodie under a dinner jacket is a costume. Dressing a
 * formal piece *down* is forgiven roughly two points, dressing a casual piece
 * *up* only one — unless something in the outfit bridges the gap.
 */
export const FORMALITY_TOLERANCE = {
  downward: 2,
  upward: 1,
  /** A bridge buys one more point in either direction. */
  bridgeBonus: 1,
} as const;

/**
 * Pairings famous enough to override the tolerance.
 *
 * Each is a gap the arithmetic would flag and the world plainly accepts. Kept
 * as an explicit list rather than softening the tolerance for everyone, because
 * the tolerance is right and these are genuinely exceptions.
 */
export const FORMALITY_EXCEPTIONS: {
  when: { a: string[]; b: string[] };
  note: string;
}[] = [
  {
    when: { a: ["blazer", "sport coat", "suit"], b: ["sneaker", "trainer"] },
    note: "Tailoring with a clean minimal sneaker — mainstream since the mid-2020s, provided the jacket is soft-shouldered and there's no tie.",
  },
  {
    when: { a: ["blazer", "sport coat"], b: ["jean", "denim", "t-shirt", "tee"] },
    note: "The smart-casual bridge. Works when the shoe and shirt connect the two registers rather than widening the gap.",
  },
  {
    when: { a: ["trouser", "slacks"], b: ["sweatshirt", "crewneck", "knit polo"] },
    note: "Elevated casual — the trouser does the formality work and the top is deliberately relaxed.",
  },
];

// ---------------------------------------------------------------------------
// Occasion
// ---------------------------------------------------------------------------

export type OccasionRule = {
  formalityMin: number;
  formalityMax: number;
  /** Registers that are wrong here regardless of the numeric formality. */
  avoidRegisters: Register[];
  /** How much an accessory contributes. Going out and formal miss one; casual doesn't. */
  accessoryWeight: number;
  note: string;
};

export const OCCASION_RULES: Record<Occasion, OccasionRule> = {
  work: {
    formalityMin: 3,
    formalityMax: 4,
    avoidRegisters: ["athletic", "beach", "lounge"],
    accessoryWeight: 0.5,
    // Whether denim belongs at work is the one thing the sources split hardest
    // on, so it's a nudge in `score.ts` rather than an exclusion here.
    note: "Smart casual to sharp. Nothing athletic, nothing with a logo. Denim is a judgement call, not a rule.",
  },
  going_out: {
    formalityMin: 3,
    formalityMax: 5,
    avoidRegisters: ["athletic", "beach", "lounge"],
    accessoryWeight: 1.5,
    note: "The widest legitimate range, from drinks to a proper dinner. This is the one occasion where a missing accessory actually reads as underdressed.",
  },
  casual: {
    formalityMin: 1,
    formalityMax: 3,
    avoidRegisters: [],
    accessoryWeight: 0.25,
    note: "Permissive by design. The only rule that still applies is proportion — casual is not the same as sloppy.",
  },
  formal: {
    formalityMin: 4,
    formalityMax: 5,
    avoidRegisters: ["athletic", "beach", "lounge", "utility"],
    accessoryWeight: 1.5,
    note: "Four and up, and the sneaker exception does not reach here. An accessory is close to required.",
  },
};

// ---------------------------------------------------------------------------
// Weather
// ---------------------------------------------------------------------------

export type TemperatureBand = {
  /** Inclusive lower bound in °C. The top band has no upper bound. */
  min: number;
  label: string;
  outerwear: "mandatory" | "recommended" | "optional" | "unneeded";
  /** What this band wants, in the app's own vocabulary. */
  wants: string;
};

/**
 * Bands keyed off *apparent* temperature, which is why there is no separate
 * wind rule: Open-Meteo has already folded wind and humidity into the number
 * these are compared against. A hand-rolled wind adjustment on top would be
 * counting it twice.
 */
export const TEMPERATURE_BANDS: TemperatureBand[] = [
  { min: 31, label: "extreme heat", outerwear: "unneeded", wants: "the loosest, lightest, palest thing you own, and something on your head" },
  { min: 26, label: "hot", outerwear: "unneeded", wants: "cotton or linen only; sunglasses and a hat stop being decorative" },
  { min: 21, label: "warm", outerwear: "unneeded", wants: "short sleeves, light bottoms, no layer" },
  { min: 16, label: "warm-mild", outerwear: "unneeded", wants: "short sleeves and light trousers; a layer only if it's windy or wet" },
  { min: 11, label: "mild", outerwear: "optional", wants: "a light jacket if you're out at either end of the day, otherwise nothing" },
  { min: 6, label: "transitional", outerwear: "recommended", wants: "a light jacket, a cardigan, or a heavy sweater standing in for one" },
  { min: 0, label: "cool-cold", outerwear: "mandatory", wants: "a real coat, long sleeves, closed shoes" },
  { min: -10, label: "cold", outerwear: "mandatory", wants: "a winter coat over a mid layer, plus a scarf and something on your hands" },
  { min: -273, label: "extreme cold", outerwear: "mandatory", wants: "insulated everything — coat, base layer, scarf, hat, gloves, warm socks" },
];

export function bandFor(feelsLikeC: number): TemperatureBand {
  return (
    TEMPERATURE_BANDS.find((band) => feelsLikeC >= band.min) ??
    TEMPERATURE_BANDS[TEMPERATURE_BANDS.length - 1]
  );
}

/**
 * Fabric weight, which the temperature band cares about independently of the
 * layer count.
 *
 * A wool cable knit and a linen shirt are both "a top", and at 27°C they are
 * not remotely the same decision. Without this the season tags carry the whole
 * load, and season tags are the field most often left blank — so a heavy
 * garment with no seasons set sails through a heatwave unchallenged.
 *
 * Only materials that genuinely commit are listed. Cotton is a jersey tee and a
 * canvas chore coat, so it appears as light with the understanding that the
 * signal is weak; the ambiguous ones are simply absent, and an absent material
 * scores nothing rather than being guessed at.
 */
export const FABRIC_WEIGHT = {
  heavy: ["wool", "merino", "cashmere", "fleece", "shearling", "down", "corduroy", "tweed", "flannel", "leather", "suede", "quilted"],
  light: ["linen", "chambray", "seersucker", "silk", "mesh"],
} as const;

/** At or above this apparent temperature, a heavy fabric is a mistake. */
export const HEAVY_FABRIC_CEILING_C = 22;
/** At or below this, an outfit made entirely of light fabric is underdressed. */
export const LIGHT_FABRIC_FLOOR_C = 6;

/** Rain forces a layer at any temperature, and rules two shoe kinds out. */
export const RAIN_RULES = {
  /** Above this chance, treat the day as wet. */
  chanceThreshold: 50,
  avoidShoeMaterials: ["suede", "nubuck", "canvas"],
  avoidShoeSubcategories: ["sandal", "espadrille", "slide", "flip-flop", "flip flop"],
} as const;

/** Shoes that conventionally go sockless, and only when it's genuinely warm. */
export const NO_SOCK_SHOES = ["sandal", "slide", "flip-flop", "flip flop", "espadrille", "boat shoe"];

// ---------------------------------------------------------------------------
// Which categories an outfit needs
// ---------------------------------------------------------------------------

/** Always. An outfit without these three isn't an outfit. */
export const REQUIRED_CATEGORIES: Category[] = ["top", "bottom", "shoes"];

// ---------------------------------------------------------------------------
// Trend material — dated, and due for review
// ---------------------------------------------------------------------------

/**
 * Observations that were current when this was written and will not stay that
 * way. They are deliberately quarantined here, weighted low, and stamped —
 * a trend hard-coded with no expiry is a bug nobody recognises as one.
 */
export const TREND_NOTES = {
  asOf: "2026-08",
  reviewAfter: "2027-08",
  notes: [
    "Tailoring is worn soft and unstructured, often over a knit polo or crewneck rather than a dress shirt.",
    "Trousers taper from the knee down; the fully-wide leg of the early 2020s now reads as of its moment.",
    "Crew socks have displaced no-shows as the deliberate choice outside athletic and beach contexts.",
    "Sage, navy, camel and stone are the neutrals of the moment — a preference, not a rule.",
  ],
} as const;

// ---------------------------------------------------------------------------
// The prose rendering, for the model
// ---------------------------------------------------------------------------

/**
 * The same rulebook, written out for a language model.
 *
 * Generated from the constants above wherever it can be, so that changing a
 * threshold changes both the score and the explanation. The parts that are
 * genuinely prose are written once, here, and say plainly which rules are firm
 * and which are contested — a model told "never mix black and brown" will
 * obey a rule the sources don't actually agree on.
 */
export function stylingBrief(): string {
  const bands = TEMPERATURE_BANDS.slice()
    .reverse()
    .map((band) => `  ${band.min}°C and up — ${band.label}: outerwear ${band.outerwear}. ${band.wants}.`)
    .join("\n");

  const occasions = (Object.entries(OCCASION_RULES) as [Occasion, OccasionRule][])
    .map(
      ([occasion, rule]) =>
        `  ${occasion}: formality ${rule.formalityMin}–${rule.formalityMax}. ${rule.note}`,
    )
    .join("\n");

  return `You are choosing what someone wears today, from clothes they already own.

WHAT MAKES AN OUTFIT
An outfit is a top, a bottom and shoes at minimum. Outerwear is required by the
weather, not by taste. Socks are assumed unless the shoe is a sandal or similar
and it is warm. An accessory is doing real work only when it bridges a formality
gap or supplies actual warmth; otherwise it is decoration and should not be
counted toward the outfit being complete.

TEMPERATURE (apparent temperature — wind and humidity are already in it)
${bands}
Rain forces a layer at any temperature, and rules out suede and open shoes.

OCCASION
${occasions}

FORMALITY
Keep the top, bottom and shoes within about two points of each other. The
tolerance is asymmetric: dressing a formal piece down is forgiven more readily
than dressing a casual piece up. A blazer over a tee works; a hoodie under a
dinner jacket does not, at the same arithmetic gap.
Some subcategories carry a register the number can't see — athletic, utility,
beach, lounge. A gym short and an oxford shirt are one point apart and still
wrong. Register mismatches matter more than numeric gaps.

COLOUR
Neutrals — black, white, grey, charcoal, navy, brown, tan, camel, khaki, stone,
cream, ecru — pair with anything and don't count toward the colour budget.
One non-neutral colour reads clean. Two is fine when one clearly dominates.
Three or more starts to read busy unless the third is a small accent.
An outfit wants at least one neutral anchor, and the bottom is the best place
for it.
Colours close together on the wheel work. Opposites work when one is clearly an
accent rather than an equal partner. The awkward zone is the middle distance —
navy with olive, mustard with burgundy — which reads flat rather than composed.
Same-family top and bottom need a visible difference in lightness, or texture
doing that job instead, or the outfit reads accidental rather than tonal.

CONTESTED — treat these as mild preferences, not rules. The sources genuinely
disagree, so do not refuse an outfit over them:
  Black with navy, and black with brown. Both are fine given enough contrast in
  lightness; both look like a mistake when the two pieces are nearly the same
  darkness.
  Denim at work.
  Bare ankles with tailoring.

FIRM — these were unanimous:
  Belt and shoes share a leather family. Brown with black is wrong.
  At most two patterns. Two of the same type need different scales; two of
  different types want similar scales; patterns should share a colour.
  At most one half of the outfit is voluminous. Loose over loose reads sloppy.

OF THE MOMENT (${TREND_NOTES.asOf}, revisit after ${TREND_NOTES.reviewAfter} — weight these lightly)
${TREND_NOTES.notes.map((note) => `  ${note}`).join("\n")}`;
}
