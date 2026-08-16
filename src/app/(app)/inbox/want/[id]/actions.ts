"use server";

import { refresh } from "next/cache";

import { MATCH_COLUMNS, WISH_COLUMNS, type WishItemRow } from "@/lib/captures";
import { assessFit, describeProspect } from "@/lib/discovery/fit";
import { rankCandidates } from "@/lib/discovery/rank";
import { DiscoveryError, findProducts } from "@/lib/discovery/search";
import type { Category } from "@/lib/garments";
import { ITEM_COLUMNS, type ActionResult, type WardrobeItem } from "@/lib/items";
import { PROFILE_COLUMNS, priceCeilings, type ProfileRow } from "@/lib/profile";
import { seasonFor, type ScoreContext } from "@/lib/styling/score";
import { createClient, getUser } from "@/lib/supabase/server";

/**
 * Running discovery for one want.
 *
 * Behind an explicit button, never on page load. Grounded search is 5,000
 * prompts a month and a page that spends one every time it renders would burn
 * through that in an afternoon of browsing — so `last_discovery_at` records
 * when it last ran and the button says how long ago that was.
 *
 * The order matters. Search and verify first, because that's what can fail;
 * then rank; then the closet check, which is local and free and would be a
 * waste to compute for candidates that turned out not to exist.
 */

/** Below this, running again is almost certainly an accident. */
const RERUN_COOLDOWN_MS = 60_000;

export type DiscoveryOutcome = {
  found: number;
  /** How many the model proposed before verification dropped the dead links. */
  proposed: number;
  fitNote: string;
  fitVerdict: string;
};

export async function runDiscovery(
  wishItemId: string,
  { force = false }: { force?: boolean } = {},
): Promise<ActionResult<DiscoveryOutcome>> {
  const user = await getUser();
  if (!user) return { ok: false, error: "Not signed in." };

  const supabase = await createClient();

  const [{ data: wantRow, error: wantError }, { data: profileRow }, { data: itemRows }] =
    await Promise.all([
      supabase.from("wish_items").select(WISH_COLUMNS).eq("id", wishItemId).single(),
      supabase.from("profiles").select(PROFILE_COLUMNS).maybeSingle(),
      supabase.from("items").select(ITEM_COLUMNS).is("archived_at", null),
    ]);

  if (wantError) return { ok: false, error: wantError.message };

  const want = wantRow as WishItemRow;
  const profile = (profileRow ?? null) as ProfileRow | null;
  const wardrobe = (itemRows ?? []) as WardrobeItem[];

  if (!force && want.last_discovery_at) {
    const elapsed = Date.now() - Date.parse(want.last_discovery_at);
    if (elapsed < RERUN_COOLDOWN_MS) {
      return {
        ok: false,
        error: "That just ran. Give it a minute before searching again.",
      };
    }
  }

  // The brands to steer away from. Lower-cased and de-duplicated here rather
  // than in the ranker, so the ranker stays a pure function of its inputs.
  const familiarBrands = new Set(
    wardrobe
      .map((item) => item.brand?.toLowerCase().trim())
      .filter((brand): brand is string => Boolean(brand)),
  );

  const ceilings = priceCeilings(profile?.price_ceilings);
  const ceilingCents = want.category ? ceilings[want.category] : null;

  let outcome;
  try {
    outcome = await findProducts({
      title: want.title,
      description: want.description,
      category: want.category,
      ceilingCents,
      familiarBrands: [...familiarBrands],
    });
  } catch (error) {
    if (error instanceof DiscoveryError) return { ok: false, error: error.message };
    console.error("Discovery failed", error);
    return { ok: false, error: "The search didn't work." };
  }

  const ranked = rankCandidates({
    candidates: outcome.candidates,
    ceilingCents,
    familiarBrands,
    targetCents: want.target_price_cents,
  });

  if (ranked.length > 0) {
    const { error: upsertError } = await supabase.from("product_matches").upsert(
      ranked.map((candidate) => ({
        user_id: user.id,
        wish_item_id: wishItemId,
        url: candidate.url,
        retailer: candidate.retailer,
        brand: candidate.brand,
        title: candidate.title,
        image_url: candidate.imageUrl,
        price_cents: candidate.priceCents,
        currency: candidate.currency ?? "USD",
        in_stock: candidate.priceCents !== null,
        score: candidate.score,
        unwatchable: candidate.unwatchable,
        last_checked_at: new Date().toISOString(),
      })),
      // Re-running discovery refreshes what's known about a link already found,
      // rather than colliding with the unique constraint or duplicating it.
      { onConflict: "wish_item_id,url" },
    );

    if (upsertError) return { ok: false, error: upsertError.message };
  }

  // -- The closet check ----------------------------------------------------
  const context: ScoreContext = {
    // A purchase is judged against the register it's for, and casual is the
    // honest default when the want doesn't say.
    occasion: "casual",
    forecast: null,
    daysSinceWorn: new Map(),
    season: seasonFor(new Date(), profile?.location_lat ?? null),
    available: new Set(wardrobe.map((item) => item.category as Category)),
  };

  const fit = assessFit(
    describeProspect(want.title, {
      category: (want.category as Category | null) ?? null,
      description: want.description,
    }),
    wardrobe,
    context,
  );

  await supabase
    .from("wish_items")
    .update({ last_discovery_at: new Date().toISOString(), fit_note: fit.note })
    .eq("id", wishItemId);

  refresh();
  return {
    ok: true,
    data: {
      found: ranked.length,
      proposed: outcome.proposed,
      fitNote: fit.note,
      fitVerdict: fit.verdict,
    },
  };
}

/**
 * Starts or stops watching a match's price.
 *
 * Opt-in per match rather than automatic: the cron's work queue is every
 * watched match across every want, and a discovery run that produced ten links
 * shouldn't quietly add ten daily fetches. A match with no readable price can't
 * be watched at all, which is what `unwatchable` records.
 */
export async function setWatching(
  matchId: string,
  watching: boolean,
): Promise<ActionResult<boolean>> {
  const user = await getUser();
  if (!user) return { ok: false, error: "Not signed in." };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("product_matches")
    .update({ watching })
    .eq("id", matchId)
    .eq("unwatchable", false)
    .select(MATCH_COLUMNS)
    .maybeSingle();

  if (error) return { ok: false, error: error.message };
  if (!data) {
    return {
      ok: false,
      error: "That page publishes no price, so there's nothing to watch.",
    };
  }

  refresh();
  return { ok: true, data: watching };
}

export async function dismissMatch(matchId: string): Promise<ActionResult<string>> {
  const user = await getUser();
  if (!user) return { ok: false, error: "Not signed in." };

  const supabase = await createClient();
  const { error } = await supabase.from("product_matches").delete().eq("id", matchId);

  if (error) return { ok: false, error: error.message };
  refresh();
  return { ok: true, data: matchId };
}
