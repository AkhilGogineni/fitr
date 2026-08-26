import "server-only";

import { CATEGORY_LABELS, type Category } from "@/lib/garments";
import { ITEM_COLUMNS, type WardrobeItem } from "@/lib/items";
import {
  OUTFIT_COLUMNS,
  SLOT_COLUMNS,
  coerceVibe,
  defaultTransform,
  normaliseTransform,
  type Occasion,
  type OutfitRow,
  type SlotRow,
  type SlotView,
  type Vibe,
} from "@/lib/outfits";
import { PROFILE_COLUMNS, hasLocation, type ProfileRow } from "@/lib/profile";
import { publicUrlFor } from "@/lib/r2";
import { composeCandidates, scoreSavedOutfits, shortlist } from "@/lib/styling/compose";
import { pickOutfit } from "@/lib/styling/pick";
import { seasonFor, type ScoreContext } from "@/lib/styling/score";
import { createClient, getUser } from "@/lib/supabase/server";
import { WeatherUnavailable, getForecast, type Forecast } from "@/lib/weather";

/**
 * Assembling the daily screen.
 *
 * Shared by the page and by the actions on it, because "show me today's
 * suggestion" and "show me a different one" differ by one flag and should not
 * differ by a line of logic.
 *
 * The important behaviour here is that **a page load does not compose.** The
 * first visit of the day writes a `suggestions` row; every refresh after that
 * reads it back. Three reasons, in ascending order of importance: it costs a
 * grounded model call each time, it makes the morning's suggestion flicker
 * between refreshes, and — the real one — the acceptance metric is meaningless
 * if the thing being accepted changes every time the page is looked at.
 *
 * Composing happens on exactly two events: the first visit for an occasion
 * today, and an explicit "something else".
 */

/** How far back wear history is read. Beyond three weeks it stops discouraging. */
const WEAR_LOOKBACK_DAYS = 21;

export type DailySuggestion = {
  suggestionId: string;
  occasion: Occasion;
  items: WardrobeItem[];
  outfitId: string | null;
  reason: string;
  pickedBy: string;
  praise: string[];
  gripes: string[];
  /** Ready to hand straight to `OutfitPreview`. */
  slots: SlotView[];
  /** Which attempt of the day this is. */
  rank: number;
};

export type DailyView = {
  occasion: Occasion;
  forecast: Forecast | null;
  /** Set when a forecast was wanted but couldn't be had. */
  weatherNote: string | null;
  hasLocation: boolean;
  suggestion: DailySuggestion | null;
  /** Set when nothing could be suggested, and says plainly why. */
  blocked: string | null;
  wardrobeSize: number;
  /** Whether the item was worn already today, so the button can say so. */
  alreadyWornToday: boolean;
};

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function daysBetween(fromIso: string, toIso: string) {
  const from = Date.parse(`${fromIso}T00:00:00Z`);
  const to = Date.parse(`${toIso}T00:00:00Z`);
  return Math.round((to - from) / 86_400_000);
}

/**
 * Turns a set of garments into something the canvas renderer can draw.
 *
 * A composed suggestion has no saved placement, so each piece falls back to the
 * layer defaults the outfit builder uses when you first drop something on the
 * canvas. That's why those defaults live in `lib/outfits.ts` rather than inside
 * the editor: the daily screen gets a plausible flat lay for free, drawn by the
 * exact renderer the outfits list uses, with no second layout engine to keep in
 * step.
 */
export function slotsForItems(items: WardrobeItem[]): SlotView[] {
  const taken = new Map<Category, number>();

  return items.map((item) => {
    const layer = item.category as Category;
    const index = taken.get(layer) ?? 0;
    taken.set(layer, index + 1);

    return {
      id: item.id,
      outfit_id: "",
      layer,
      item_id: item.id,
      wish_item_id: null,
      gap_spec: null,
      transform: defaultTransform(layer, index),
      created_at: item.created_at,
      imageUrl: publicUrlFor(item.image_cutout_key),
      label: item.brand ?? item.subcategory ?? CATEGORY_LABELS[layer],
    };
  });
}

/** The real placement, when the suggestion was a saved outfit. */
async function slotsForOutfit(
  outfitId: string,
  itemsById: Map<string, WardrobeItem>,
): Promise<SlotView[] | null> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("outfit_slots")
    .select(SLOT_COLUMNS)
    .eq("outfit_id", outfitId);

  const rows = (data ?? []) as SlotRow[];
  if (rows.length === 0) return null;

  return rows.map((slot) => {
    const item = slot.item_id ? itemsById.get(slot.item_id) : undefined;
    return {
      ...slot,
      transform: normaliseTransform(slot.transform, slot.layer),
      imageUrl: item ? publicUrlFor(item.image_cutout_key) : undefined,
      label: item
        ? (item.brand ?? item.subcategory ?? CATEGORY_LABELS[slot.layer])
        : CATEGORY_LABELS[slot.layer],
    };
  });
}

type SuggestionRow = {
  id: string;
  for_date: string;
  occasion: Occasion;
  rank: number;
  outfit_id: string | null;
  item_ids: string[];
  reason: string | null;
  picked_by: string | null;
  outcome: string;
  weather: Record<string, unknown> | null;
};

/** The vibe a suggestion was composed for, read back from the weather jsonb. */
function storedVibe(row: SuggestionRow): Vibe {
  return coerceVibe((row.weather as { vibe?: unknown } | null)?.vibe);
}

/**
 * Builds the day's view.
 *
 * `recompose` is the "something else" path: it marks the standing suggestion as
 * overridden and produces the next one. Everything else is a read.
 *
 * The standing suggestion is keyed by occasion *and* vibe — switching from
 * Casual to Casual+Sharp is a real request for a different answer, not a
 * refresh of the old one. Vibes ride in the `weather` jsonb because they are
 * per-composition context like the forecast is, and a column would mean a
 * migration for a value that only ever matters on the day it was written.
 */
export async function buildDailyView(
  occasion: Occasion,
  { recompose = false, vibe = "any" }: { recompose?: boolean; vibe?: Vibe } = {},
): Promise<DailyView> {
  const supabase = await createClient();
  const today = todayIso();

  const [
    { data: profileRow },
    { data: itemRows },
    { data: suggestionRows },
  ] = await Promise.all([
    supabase.from("profiles").select(PROFILE_COLUMNS).single(),
    supabase.from("items").select(ITEM_COLUMNS).is("archived_at", null),
    supabase
      .from("suggestions")
      .select(
        "id, for_date, occasion, rank, outfit_id, item_ids, reason, picked_by, outcome, weather",
      )
      .eq("for_date", today)
      .eq("occasion", occasion)
      .order("rank", { ascending: false }),
  ]);

  const profile = (profileRow ?? null) as ProfileRow | null;
  const items = (itemRows ?? []) as WardrobeItem[];
  const itemsById = new Map(items.map((item) => [item.id, item]));
  const existing = (suggestionRows ?? []) as SuggestionRow[];

  /*
   * The forecast starts here but is not awaited until a view is actually being
   * built. It used to block every render — including the common one where a
   * stored suggestion was about to be reused after two database calls — which
   * put Open-Meteo's latency on the critical path of the app's most-used
   * screen. In flight, it overlaps with the slot query on cache hits and with
   * the wear/outfit reads on compose; somebody's wait always covers it.
   */
  const located = hasLocation(profile);
  const weatherPromise = loadWeather(profile);

  /** The view's static half, filled in once the weather lands. */
  const baseOf = (forecast: Forecast | null, weatherNote: string | null): DailyView => ({
    occasion,
    forecast,
    weatherNote,
    hasLocation: located,
    suggestion: null,
    blocked: null,
    wardrobeSize: items.length,
    alreadyWornToday: false,
  });

  // -- Reuse the standing suggestion, unless asked for another --------------
  const standing = existing.find(
    (row) => row.outcome !== "overridden" && storedVibe(row) === vibe,
  );
  if (standing && !recompose) {
    const suggestion = await hydrate(standing, itemsById);
    if (suggestion) {
      const { forecast, note } = await weatherPromise;
      return {
        ...baseOf(forecast, note),
        suggestion,
        alreadyWornToday: standing.outcome === "worn",
      };
    }
    // The stored row referenced an item that has since been archived or
    // deleted. Falling through to compose is the right repair — the row stays
    // as a record of what was suggested, and today gets a fresh answer.
  }

  // -- Compose -------------------------------------------------------------
  if (items.length === 0) {
    const { forecast, note } = await weatherPromise;
    return { ...baseOf(forecast, note), blocked: "Nothing in the wardrobe yet." };
  }

  const wearCutoff = new Date(Date.now() - WEAR_LOOKBACK_DAYS * 86_400_000)
    .toISOString()
    .slice(0, 10);

  const [{ data: wearRows }, { data: outfitRows }, { data: allSlotRows }] =
    await Promise.all([
      supabase.from("wears").select("item_id, worn_on").gte("worn_on", wearCutoff),
      supabase.from("outfits").select(OUTFIT_COLUMNS),
      supabase.from("outfit_slots").select(SLOT_COLUMNS),
    ]);

  const { forecast, note: weatherNote } = await weatherPromise;

  const daysSinceWorn = new Map<string, number>();
  for (const wear of (wearRows ?? []) as { item_id: string; worn_on: string }[]) {
    const days = daysBetween(wear.worn_on, today);
    const known = daysSinceWorn.get(wear.item_id);
    if (known === undefined || days < known) daysSinceWorn.set(wear.item_id, days);
  }

  const context: ScoreContext = {
    occasion,
    vibe,
    forecast,
    daysSinceWorn,
    season: seasonFor(new Date(), profile?.location_lat ?? null),
    // So the scorer can tell "no socks in this outfit" from "no socks in this
    // wardrobe" — only the first is worth mentioning.
    available: new Set(items.map((item) => item.category as Category)),
  };

  // Saved outfits, reduced to the owned pieces they contain. An outfit whose
  // slots are gaps or wishlist items isn't wearable today by definition.
  const slotsByOutfit = new Map<string, string[]>();
  for (const slot of (allSlotRows ?? []) as SlotRow[]) {
    if (!slot.item_id) {
      // Mark it unwearable by pushing an id that won't resolve, so the
      // "every slot filled" check in `scoreSavedOutfits` fails honestly.
      slotsByOutfit.set(slot.outfit_id, [
        ...(slotsByOutfit.get(slot.outfit_id) ?? []),
        `gap:${slot.id}`,
      ]);
      continue;
    }
    slotsByOutfit.set(slot.outfit_id, [
      ...(slotsByOutfit.get(slot.outfit_id) ?? []),
      slot.item_id,
    ]);
  }

  const saved = ((outfitRows ?? []) as OutfitRow[])
    .map((outfit) => ({ id: outfit.id, itemIds: slotsByOutfit.get(outfit.id) ?? [] }))
    .filter((outfit) => outfit.itemIds.length > 0);

  const candidates = shortlist([
    ...scoreSavedOutfits(saved, itemsById, context),
    ...composeCandidates(items, context),
  ]);

  if (candidates.length === 0) {
    return { ...baseOf(forecast, weatherNote), blocked: explainEmpty(items, context, forecast) };
  }

  // Anything already suggested today is off the table for a reshuffle —
  // "something else" that offers the same clothes again is not something else.
  const alreadyOffered = new Set(
    existing.map((row) => row.item_ids.slice().sort().join("|")),
  );
  const fresh = candidates.filter(
    (candidate) =>
      !alreadyOffered.has(
        candidate.items
          .map((item) => item.id)
          .sort()
          .join("|"),
      ),
  );
  const pool = fresh.length > 0 ? fresh : candidates;

  const picked = await pickOutfit(pool, { occasion, forecast, vibe });
  const rank = (existing[0]?.rank ?? 0) + 1;

  // Mark what's being replaced as overridden before writing the new row, so a
  // reshuffle is recorded as a rejection rather than quietly disappearing.
  if (recompose && standing) {
    await supabase
      .from("suggestions")
      .update({ outcome: "overridden" })
      .eq("id", standing.id)
      .eq("outcome", "pending");
  }

  // From the verified session, not from the profile row — the insert policy
  // checks this column, and reading it from a row we just selected would be
  // trusting a value to prove itself.
  const user = await getUser();

  // The slot read for a saved outfit doesn't depend on the insert — they're
  // different tables keyed by the same outfit id — so both go at once. On a
  // ~90ms database round trip, one saved serial step per compose adds up.
  const [{ data: inserted }, savedSlots] = await Promise.all([
    supabase
      .from("suggestions")
      .insert({
        user_id: user?.id,
        for_date: today,
        occasion,
        rank,
        outfit_id: picked.outfit.outfitId,
        item_ids: picked.outfit.items.map((item) => item.id),
        reason: picked.reason,
        picked_by: picked.pickedBy,
        weather: forecast ? { ...forecast, vibe } : { vibe },
      })
      .select("id")
      .single(),
    picked.outfit.outfitId
      ? slotsForOutfit(picked.outfit.outfitId, itemsById)
      : Promise.resolve(null),
  ]);

  const slots = savedSlots ?? slotsForItems(picked.outfit.items);

  return {
    ...baseOf(forecast, weatherNote),
    suggestion: {
      // A failed insert costs the acceptance metric for this suggestion, not
      // the suggestion itself — the screen still works, the buttons that need
      // an id are what degrade.
      suggestionId: inserted?.id ?? "",
      occasion,
      items: picked.outfit.items,
      outfitId: picked.outfit.outfitId,
      reason: picked.reason,
      pickedBy: picked.pickedBy,
      praise: picked.outfit.praise,
      gripes: picked.outfit.gripes,
      slots,
      rank,
    },
  };
}

/**
 * The forecast, resolved into a result rather than thrown.
 *
 * A missing forecast weakens the suggestion; it doesn't stop it. Every weather
 * rule in the scorer is skipped when `forecast` is null, so the result is a
 * season-and-occasion suggestion rather than no suggestion — which is why the
 * failure lands as a note on the ticket instead of an error.
 */
async function loadWeather(
  profile: ProfileRow | null,
): Promise<{ forecast: Forecast | null; note: string | null }> {
  const lat = profile?.location_lat;
  const lon = profile?.location_lon;
  const placeName = profile?.location_name ?? null;
  if (typeof lat !== "number" || typeof lon !== "number") {
    return { forecast: null, note: "Set where you live to factor in the weather." };
  }
  try {
    const forecast = await getForecast(lat, lon, placeName);
    return { forecast, note: null };
  } catch (error) {
    return {
      forecast: null,
      note:
        error instanceof WeatherUnavailable
          ? error.message
          : "Couldn't get the forecast.",
    };
  }
}

/** Rebuilds a suggestion from its stored row. Null if a garment has gone. */
async function hydrate(
  row: SuggestionRow,
  itemsById: Map<string, WardrobeItem>,
): Promise<DailySuggestion | null> {
  const items = row.item_ids
    .map((id) => itemsById.get(id))
    .filter((item): item is WardrobeItem => item !== undefined);

  if (items.length === 0 || items.length !== row.item_ids.length) return null;

  const slots = row.outfit_id
    ? ((await slotsForOutfit(row.outfit_id, itemsById)) ?? slotsForItems(items))
    : slotsForItems(items);

  return {
    suggestionId: row.id,
    occasion: row.occasion,
    items,
    outfitId: row.outfit_id,
    reason: row.reason ?? "",
    pickedBy: row.picked_by ?? "rules",
    // The stored row keeps the sentence, not the rule-by-rule breakdown —
    // those are cheap to recompute and not worth a column.
    praise: [],
    gripes: [],
    slots,
    rank: row.rank,
  };
}

/**
 * Says plainly why there's nothing to suggest.
 *
 * "No suggestion" with no explanation is the worst possible answer here,
 * because every cause has a different fix and the user can act on all of them.
 * So this works out which constraint actually emptied the list.
 */
function explainEmpty(
  items: WardrobeItem[],
  context: ScoreContext,
  forecast: Forecast | null,
): string {
  const has = (category: Category) =>
    items.some((item) => item.category === category);

  const missing = (["top", "bottom", "shoes"] as Category[]).filter(
    (category) => !has(category),
  );
  if (missing.length > 0) {
    return `Nothing to build with — the wardrobe has no ${missing.map((m) => CATEGORY_LABELS[m].toLowerCase()).join(", no ")}.`;
  }

  if (forecast && !has("outerwear")) {
    return `It's ${forecast.feelsLikeMin}°C, which wants a coat, and there isn't one in the wardrobe yet.`;
  }

  return `Nothing in the wardrobe fits ${context.occasion.replace("_", " ")} in this weather. Try another occasion, or add a few more pieces.`;
}
