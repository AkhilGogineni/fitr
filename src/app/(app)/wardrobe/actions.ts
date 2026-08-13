"use server";

import { refresh } from "next/cache";

import { coerceTags, type GarmentTags } from "@/lib/garments";
import {
  ITEM_COLUMNS,
  type ActionResult,
  type ItemPatch,
  type NewItemInput,
  type WardrobeItem,
} from "@/lib/items";
import { createClient, getUser } from "@/lib/supabase/server";

/**
 * Writes for the wardrobe.
 *
 * Server Actions rather than route handlers: these are all mutations driven by
 * the intake UI, and an action gives typed arguments and a single round trip
 * instead of a hand-rolled fetch plus JSON contract on both sides.
 *
 * Every action re-checks the session. Actions are reachable by direct POST, not
 * only through our own UI, so "the page checked already" is not a check. RLS is
 * still the real boundary underneath — `user_id` is set from the verified
 * session here, and the insert policy re-verifies it in Postgres.
 */

function priceOrNull(value: unknown): number | null {
  // `Number(null)` is 0, so an unpriced item would otherwise be stored as free
  // rather than as unknown — which is a different claim, and the one that would
  // quietly poison a cost-per-wear number later.
  if (value === null || value === undefined || value === "") return null;

  const cents = Number(value);
  // Retailer markup produces some wild numbers; anything past $100k is a parse bug.
  if (!Number.isFinite(cents) || cents < 0 || cents > 10_000_000) return null;
  return Math.round(cents);
}

function trimOrNull(value: unknown, maxLength = 80): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim().slice(0, maxLength);
  return trimmed || null;
}

/**
 * Saves an item the moment its cutout is in R2, rather than at the end of a
 * batch. Photographing 20 garments is a long session, and a refresh partway
 * through shouldn't discard the work — so rows land early and carry
 * `needs_review` until someone has looked at the auto-tags.
 */
export async function createItem(
  input: NewItemInput,
): Promise<ActionResult<WardrobeItem>> {
  const user = await getUser();
  if (!user) return { ok: false, error: "Not signed in." };

  if (!input.imageCutoutKey) {
    return { ok: false, error: "An item needs a cutout image." };
  }

  const tags = coerceTags(input.tags);
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("items")
    .insert({
      // Set explicitly because the insert policy checks it; the database is
      // what enforces that this matches the session, not this line.
      user_id: user.id,
      category: tags.category,
      subcategory: tags.subcategory,
      brand: trimOrNull(input.brand),
      colors: tags.colors,
      pattern: tags.pattern,
      material: tags.material,
      formality: tags.formality,
      seasons: tags.seasons,
      image_cutout_key: input.imageCutoutKey,
      image_original_key: input.imageOriginalKey ?? null,
      source_url: trimOrNull(input.sourceUrl, 2000),
      purchase_price_cents: priceOrNull(input.purchasePriceCents),
      needs_review: input.needsReview ?? true,
    })
    .select(ITEM_COLUMNS)
    .single();

  if (error) return { ok: false, error: error.message };
  return { ok: true, data: data as WardrobeItem };
}

/**
 * Applies a correction from the review grid.
 *
 * Editing an item is what clears `needs_review` — if you've touched a field,
 * you've looked at the row. That means confirming and correcting are the same
 * gesture, and there's no extra "mark as checked" step to forget.
 */
export async function updateItem(
  id: string,
  patch: ItemPatch,
): Promise<ActionResult<WardrobeItem>> {
  const user = await getUser();
  if (!user) return { ok: false, error: "Not signed in." };

  const tags = coerceTags(patch, (patch.category ?? "top") as GarmentTags["category"]);
  const supabase = await createClient();

  const update: Record<string, unknown> = { needs_review: false };
  if (patch.category !== undefined) update.category = tags.category;
  if (patch.subcategory !== undefined) update.subcategory = tags.subcategory;
  if (patch.colors !== undefined) update.colors = tags.colors;
  if (patch.pattern !== undefined) update.pattern = tags.pattern;
  if (patch.material !== undefined) update.material = tags.material;
  if (patch.formality !== undefined) update.formality = tags.formality;
  if (patch.seasons !== undefined) update.seasons = tags.seasons;
  if (patch.brand !== undefined) update.brand = trimOrNull(patch.brand);
  if (patch.purchasePriceCents !== undefined) {
    update.purchase_price_cents = priceOrNull(patch.purchasePriceCents);
  }

  // No `.eq("user_id", ...)`: RLS scopes the update, so a guessed id from
  // another account matches zero rows rather than being quietly rewritten.
  const { data, error } = await supabase
    .from("items")
    .update(update)
    .eq("id", id)
    .select(ITEM_COLUMNS)
    .single();

  if (error) return { ok: false, error: error.message };
  return { ok: true, data: data as WardrobeItem };
}

/** Accepts the auto-tags as they are, for rows that came out right. */
export async function confirmItems(ids: string[]): Promise<ActionResult<number>> {
  const user = await getUser();
  if (!user) return { ok: false, error: "Not signed in." };
  if (ids.length === 0) return { ok: true, data: 0 };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("items")
    .update({ needs_review: false })
    .in("id", ids)
    .select("id");

  if (error) return { ok: false, error: error.message };

  refresh();
  return { ok: true, data: data?.length ?? 0 };
}

/**
 * Archives rather than deletes.
 *
 * A mis-cut item is usually worth re-cutting, not losing, and by Phase 3 the
 * `wears` history hanging off an item is worth more than the item row itself.
 * The R2 objects stay; 10GB is a lot of forgiveness.
 */
export async function archiveItem(id: string): Promise<ActionResult<string>> {
  const user = await getUser();
  if (!user) return { ok: false, error: "Not signed in." };

  const supabase = await createClient();
  const { error } = await supabase
    .from("items")
    .update({ archived_at: new Date().toISOString(), needs_review: false })
    .eq("id", id);

  if (error) return { ok: false, error: error.message };

  refresh();
  return { ok: true, data: id };
}
