"use server";

import { refresh } from "next/cache";

import type { ActionResult } from "@/lib/items";
import { OCCASIONS, type Occasion } from "@/lib/outfits";
import { buildDailyView } from "@/lib/styling/daily";
import { createClient, getUser } from "@/lib/supabase/server";

/**
 * The two things you can do on the daily screen.
 *
 * Both are one tap, and that is the whole design. The wear log only exists
 * because confirming an outfit is easier than not confirming it — the moment
 * it costs a form, a date picker, or a second screen, it stops being written
 * and the taste model it feeds never gets its data.
 */

function coerceOccasion(value: unknown): Occasion {
  return (OCCASIONS as readonly string[]).includes(value as string)
    ? (value as Occasion)
    : "casual";
}

/**
 * "Wore it" — the tap that writes the wear log.
 *
 * One row per garment rather than one per outfit, because the interesting
 * questions later are all about garments: what never gets worn, what gets worn
 * to death, what a piece actually costs per wearing. The outfit id rides along
 * so the outfit-level view is still recoverable.
 *
 * Confirming twice in a day is a double-tap, not two wearings — the unique
 * constraint on `(item_id, worn_on)` says so, and `ignoreDuplicates` lets the
 * second tap succeed quietly instead of erroring at someone who did nothing
 * wrong.
 */
export async function wearIt(suggestionId: string): Promise<ActionResult<number>> {
  const user = await getUser();
  if (!user) return { ok: false, error: "Not signed in." };

  const supabase = await createClient();

  const { data: suggestion, error: readError } = await supabase
    .from("suggestions")
    .select("id, item_ids, outfit_id, for_date")
    .eq("id", suggestionId)
    .single();

  if (readError) return { ok: false, error: readError.message };
  const itemIds = (suggestion.item_ids ?? []) as string[];
  if (itemIds.length === 0) return { ok: false, error: "That suggestion has no pieces." };

  const { error: wearError } = await supabase.from("wears").upsert(
    itemIds.map((itemId) => ({
      user_id: user.id,
      item_id: itemId,
      outfit_id: suggestion.outfit_id,
      worn_on: suggestion.for_date,
    })),
    { onConflict: "item_id,worn_on", ignoreDuplicates: true },
  );

  if (wearError) return { ok: false, error: wearError.message };

  const { error: markError } = await supabase
    .from("suggestions")
    .update({ outcome: "worn" })
    .eq("id", suggestionId);

  if (markError) return { ok: false, error: markError.message };

  refresh();
  return { ok: true, data: itemIds.length };
}

/**
 * "Something else" — records the rejection and composes the next one.
 *
 * The rejection is the point. `wears` records what was worn and is silent
 * about what was turned down, so without this the acceptance rate the plan
 * asks for can't be computed at all. `buildDailyView` marks the standing
 * suggestion overridden before writing its replacement.
 */
export async function somethingElse(occasion: string): Promise<ActionResult<string>> {
  const user = await getUser();
  if (!user) return { ok: false, error: "Not signed in." };

  const view = await buildDailyView(coerceOccasion(occasion), { recompose: true });

  refresh();
  if (view.blocked) return { ok: false, error: view.blocked };
  return { ok: true, data: view.suggestion?.suggestionId ?? "" };
}

/**
 * Undoes a "wore it".
 *
 * Present because the tap is deliberately frictionless, and anything that easy
 * to press is easy to press by mistake. Deleting the wear rows matters more
 * than it looks: a phantom wearing suppresses those garments from suggestions
 * for the next week.
 */
export async function undoWear(suggestionId: string): Promise<ActionResult<string>> {
  const user = await getUser();
  if (!user) return { ok: false, error: "Not signed in." };

  const supabase = await createClient();

  const { data: suggestion, error: readError } = await supabase
    .from("suggestions")
    .select("item_ids, for_date")
    .eq("id", suggestionId)
    .single();

  if (readError) return { ok: false, error: readError.message };

  const { error: deleteError } = await supabase
    .from("wears")
    .delete()
    .in("item_id", (suggestion.item_ids ?? []) as string[])
    .eq("worn_on", suggestion.for_date);

  if (deleteError) return { ok: false, error: deleteError.message };

  const { error: markError } = await supabase
    .from("suggestions")
    .update({ outcome: "pending" })
    .eq("id", suggestionId);

  if (markError) return { ok: false, error: markError.message };

  refresh();
  return { ok: true, data: suggestionId };
}
