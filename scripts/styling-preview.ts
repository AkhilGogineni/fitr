/**
 * See the styling engine decide, without a database.
 *
 *     npm run styling
 *
 * Not a test suite — there are no assertions and nothing fails. It's a bench:
 * a fixed pretend wardrobe run through the rules under half a dozen different
 * mornings, printing what won and which rules fired. Change a weight in
 * `lib/styling/rulebook.ts`, run this, and the effect is on screen in a second
 * instead of after a deploy and a wait for tomorrow.
 *
 * That loop is the point. Every threshold in the rulebook is a calibration
 * rather than a measured fact, so they will all want moving once real clothes
 * are in front of them — and a change you can't see the effect of is a change
 * you won't make.
 *
 * Two things it caught while being written, both of which are now fixed and
 * worth knowing about as the kind of bug this finds: a sock complaint that
 * attached to every candidate in a wardrobe with no socks in it, and a wool
 * cable knit placing third on a 27°C afternoon.
 */
import { composeCandidates, shortlist } from "@/lib/styling/compose";
import { disqualify, scoreOutfit, seasonFor, type ScoreContext } from "@/lib/styling/score";
import { bandFor, inferRegister, resolveColour, silhouetteOf } from "@/lib/styling/rulebook";
import { describeProspect, assessFit } from "@/lib/discovery/fit";
import type { WardrobeItem } from "@/lib/items";
import type { Forecast } from "@/lib/weather";

let n = 0;
const item = (p: Partial<WardrobeItem>): WardrobeItem => ({
  id: `i${++n}`,
  category: "top",
  subcategory: null,
  brand: null,
  colors: [],
  pattern: null,
  material: null,
  formality: null,
  seasons: [],
  image_cutout_key: "k",
  image_original_key: null,
  source_url: null,
  purchase_price_cents: null,
  needs_review: false,
  created_at: new Date().toISOString(),
  ...p,
});

const wardrobe: WardrobeItem[] = [
  item({ category: "top", subcategory: "oxford shirt", colors: ["white"], formality: 3, material: "cotton", seasons: ["spring", "autumn", "summer"] }),
  item({ category: "top", subcategory: "chunky cable knit", colors: ["cream"], formality: 2, material: "wool", seasons: ["autumn", "winter"] }),
  item({ category: "top", subcategory: "graphic tee", colors: ["black"], formality: 1, material: "cotton", seasons: ["summer"] }),
  item({ category: "bottom", subcategory: "tapered trouser", colors: ["charcoal"], formality: 4, material: "wool", seasons: ["autumn", "winter", "spring"] }),
  item({ category: "bottom", subcategory: "slim jean", colors: ["navy"], formality: 2, material: "denim", seasons: ["spring", "autumn", "winter"] }),
  item({ category: "bottom", subcategory: "wide-leg cargo", colors: ["olive"], formality: 1, seasons: ["summer"] }),
  item({ category: "shoes", subcategory: "chelsea boot", colors: ["black"], formality: 3, material: "leather", seasons: ["autumn", "winter", "spring"] }),
  item({ category: "shoes", subcategory: "suede desert boot", colors: ["tan"], formality: 3, material: "suede", seasons: ["autumn", "spring"] }),
  item({ category: "shoes", subcategory: "running trainer", colors: ["white"], formality: 1, seasons: ["summer", "spring"] }),
  item({ category: "outerwear", subcategory: "wool overcoat", colors: ["camel"], formality: 4, material: "wool", seasons: ["winter", "autumn"] }),
  item({ category: "accessory", subcategory: "leather belt", colors: ["black"], formality: 3, material: "leather", seasons: [] }),
];

const forecast = (over: Partial<Forecast> = {}): Forecast => ({
  feelsLikeMin: 8, feelsLikeMax: 12, tempMin: 9, tempMax: 13,
  precipChance: 10, windMax: 14, code: 3, summary: "chilly, cloud", placeName: "Brooklyn",
  ...over,
});

const ctx = (over: Partial<ScoreContext> = {}): ScoreContext => ({
  occasion: "casual",
  forecast: forecast(),
  daysSinceWorn: new Map(),
  season: "autumn",
  available: new Set(wardrobe.map((i) => i.category as never)),
  ...over,
});

const line = (s: string) => console.log(s);
const rule = () => line("─".repeat(72));

line("\n### rulebook primitives");
line(`resolveColour("dark olive")      -> ${JSON.stringify(resolveColour("dark olive"))}`);
line(`resolveColour("light heather grey") -> ${JSON.stringify(resolveColour("light heather grey"))}`);
line(`resolveColour("chartreuse")      -> ${resolveColour("chartreuse")}`);
line(`inferRegister("gym short")       -> ${inferRegister("gym short")}`);
line(`inferRegister("oxford shirt")    -> ${inferRegister("oxford shirt")}`);
line(`silhouetteOf("wide-leg cargo")   -> ${silhouetteOf("wide-leg cargo")}`);
line(`bandFor(8).outerwear             -> ${bandFor(8).outerwear}`);
line(`bandFor(-2).outerwear            -> ${bandFor(-2).outerwear}`);
line(`bandFor(24).outerwear            -> ${bandFor(24).outerwear}`);
line(`seasonFor(Aug, lat 40)           -> ${seasonFor(new Date("2026-08-13"), 40)}`);
line(`seasonFor(Aug, lat -33)          -> ${seasonFor(new Date("2026-08-13"), -33)}`);

rule();
line("### hard constraints");
const noBottom = [wardrobe[0], wardrobe[6]];
line(`missing a bottom            -> ${disqualify(noBottom, ctx())}`);
line(`0°C with no coat            -> ${disqualify([wardrobe[0], wardrobe[4], wardrobe[6]], ctx({ forecast: forecast({ feelsLikeMin: 0 }) }))}`);
line(`trainers at a formal        -> ${disqualify([wardrobe[0], wardrobe[3], wardrobe[8]], ctx({ occasion: "formal" }))}`);
line(`fine on a chilly casual day -> ${disqualify([wardrobe[0], wardrobe[4], wardrobe[6]], ctx())}`);

rule();
line("### specific rules firing");
const twoLoose = [
  item({ category: "top", subcategory: "oversized hoodie", colors: ["grey"], formality: 1 }),
  item({ category: "bottom", subcategory: "wide-leg trouser", colors: ["stone"], formality: 2 }),
  wardrobe[6],
];
const looseScore = scoreOutfit(twoLoose, ctx());
line(`loose over loose  score ${looseScore.score}  gripes: ${JSON.stringify(looseScore.gripes)}`);

const suedeInRain = scoreOutfit(
  [wardrobe[0], wardrobe[4], wardrobe[7], wardrobe[9]],
  ctx({ forecast: forecast({ precipChance: 80, code: 61, summary: "chilly, rain likely" }) }),
);
line(`suede in rain     score ${suedeInRain.score}  gripes: ${JSON.stringify(suedeInRain.gripes)}`);

const wornYesterday = scoreOutfit(
  [wardrobe[0], wardrobe[3], wardrobe[6]],
  ctx({ daysSinceWorn: new Map([[wardrobe[0].id, 1], [wardrobe[3].id, 1]]) }),
);
line(`worn yesterday    score ${wornYesterday.score}  gripes: ${JSON.stringify(wornYesterday.gripes)}`);

const fresh = scoreOutfit([wardrobe[0], wardrobe[3], wardrobe[6]], ctx());
line(`same, unworn      score ${fresh.score}  praise: ${JSON.stringify(fresh.praise)}`);

rule();
line("### shortlist, chilly autumn casual");
for (const c of shortlist(composeCandidates(wardrobe, ctx()), 4)) {
  line(`  ${String(c.score).padStart(5)}  ${c.items.map((i) => i.subcategory).join(" · ")}`);
  line(`         + ${c.praise.join(" ")}`);
  if (c.gripes.length) line(`         − ${c.gripes.join(" ")}`);
}

rule();
line("### same wardrobe, work at 0°C, raining");
const wet = ctx({ occasion: "work", forecast: forecast({ feelsLikeMin: 0, feelsLikeMax: 4, precipChance: 90, code: 61, summary: "cold, rain likely" }), season: "winter" });
const wetList = shortlist(composeCandidates(wardrobe, wet), 3);
if (wetList.length === 0) line("  (nothing wearable — which is itself an answer)");
for (const c of wetList) {
  line(`  ${String(c.score).padStart(5)}  ${c.items.map((i) => i.subcategory).join(" · ")}`);
  line(`         + ${c.praise.join(" ")}`);
  if (c.gripes.length) line(`         − ${c.gripes.join(" ")}`);
}

rule();
line("### hot summer casual — should refuse the coat");
const hot = ctx({ forecast: forecast({ feelsLikeMin: 27, feelsLikeMax: 33, precipChance: 0, code: 0, summary: "hot, clear" }), season: "summer" });
for (const c of shortlist(composeCandidates(wardrobe, hot), 3)) {
  line(`  ${String(c.score).padStart(5)}  ${c.items.map((i) => i.subcategory).join(" · ")}`);
}

rule();
line("### closet fit");
for (const title of [
  "Merino Wool Overshirt in Charcoal",
  "Neon Pink Sequin Wide-Leg Palazzo Trouser",
  "Suede Chelsea Boot in Tan",
]) {
  const prospect = describeProspect(title);
  const fit = assessFit(prospect, wardrobe, ctx({ forecast: null }));
  line(`  "${title}"`);
  line(`    read as: ${prospect.category}, colours ${JSON.stringify(prospect.colors)}, material ${prospect.material}`);
  line(`    ${fit.verdict.toUpperCase()} — ${fit.note}`);
}

rule();
line("### empty and near-empty wardrobes");
line(`  no items      -> ${shortlist(composeCandidates([], ctx())).length} candidates`);
line(`  only tops     -> ${shortlist(composeCandidates(wardrobe.filter((i) => i.category === "top"), ctx())).length} candidates`);
line("");
