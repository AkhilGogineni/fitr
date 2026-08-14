"use server";

import { refresh } from "next/cache";
import { redirect } from "next/navigation";

import { isCategory, isSeason, type Category } from "@/lib/garments";
import type { ActionResult } from "@/lib/items";
import {
  OCCASIONS,
  OUTFIT_COLUMNS,
  SLOT_COLUMNS,
  clamp,
  type GapSpec,
  type Occasion,
  type OutfitRow,
  type SlotRow,
  type SlotTransform,
} from "@/lib/outfits";
import { createClient, getUser } from "@/lib/supabase/server";

/**
 * Writes for the outfit canvas.
 *
 * `outfit_slots` carries no `user_id` of its own — ownership comes from its
 * outfit, enforced by the RLS policy in 0001. So slot writes here never mention
 * a user: a slot pointed at someone else's outfit fails the policy's `exists`
 * check in Postgres rather than being caught by a condition in this file.
 *
 * Transform updates arrive on every drag, so they are the hot path. They write
 * one jsonb column and deliberately skip `refresh()` — re-rendering the route
 * mid-drag would fight the pointer.
 */

function trimOrNull(value: unknown, maxLength = 80): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim().slice(0, maxLength);
  return trimmed || null;
}

function coerceTransform(input: Partial<SlotTransform>): SlotTransform {
  return {
    // Slightly outside 0–1 is allowed: letting a sleeve run off the edge is a
    // legitimate composition, not an error to correct.
    x: clamp(Number(input.x), -0.2, 1.2),
    y: clamp(Number(input.y), -0.2, 1.2),
    scale: clamp(Number(input.scale), 0.05, 1.6),
    rotation: clamp(Number(input.rotation ?? 0), -180, 180),
    z: Math.round(clamp(Number(input.z ?? 0), 0, 999)),
  };
}

function coerceGap(input: Partial<GapSpec>): GapSpec | null {
  if (!isCategory(input.category)) return null;
  const formality = Number(input.formality);
  return {
    category: input.category,
    color: trimOrNull(input.color, 30),
    material: trimOrNull(input.material, 40),
    formality: Number.isFinite(formality)
      ? Math.min(5, Math.max(1, Math.round(formality)))
      : null,
    note: trimOrNull(input.note, 120),
  };
}

/**
 * Called straight from a `<form action=…>`, so it returns nothing and throws on
 * failure rather than handing back an `ActionResult` — a form action has no
 * channel to return a value through. That's the right shape here anyway: the
 * only way this fails is the database refusing an insert the signed-in user is
 * plainly entitled to make, which is exceptional rather than routine.
 */
export async function createOutfit(): Promise<void> {
  const user = await getUser();
  if (!user) redirect("/login?next=/outfits");

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("outfits")
    .insert({ user_id: user.id })
    .select("id")
    .single();

  if (error) throw new Error(`Couldn't start a new outfit: ${error.message}`);

  // Straight into the editor — a new outfit with no pieces has nothing to list.
  redirect(`/outfits/${data.id}`);
}

export async function updateOutfit(
  id: string,
  patch: { name?: string | null; occasion?: string | null; seasons?: string[] },
): Promise<ActionResult<OutfitRow>> {
  const user = await getUser();
  if (!user) return { ok: false, error: "Not signed in." };

  const update: Record<string, unknown> = {};
  if (patch.name !== undefined) update.name = trimOrNull(patch.name, 80);
  if (patch.occasion !== undefined) {
    update.occasion = (OCCASIONS as readonly string[]).includes(patch.occasion ?? "")
      ? (patch.occasion as Occasion)
      : null;
  }
  if (patch.seasons !== undefined) {
    update.seasons = [...new Set(patch.seasons.filter(isSeason))];
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("outfits")
    .update(update)
    .eq("id", id)
    .select(OUTFIT_COLUMNS)
    .single();

  if (error) return { ok: false, error: error.message };
  return { ok: true, data: data as OutfitRow };
}

export type NewSlot = {
  outfitId: string;
  layer: Category;
  itemId?: string | null;
  gapSpec?: Partial<GapSpec> | null;
  transform: Partial<SlotTransform>;
};

/**
 * Adds an owned piece or a gap.
 *
 * The database enforces that a slot holds exactly one occupant, so this refuses
 * the ambiguous case up front rather than letting the check constraint answer
 * with something unreadable.
 */
export async function addSlot(input: NewSlot): Promise<ActionResult<SlotRow>> {
  const user = await getUser();
  if (!user) return { ok: false, error: "Not signed in." };
  if (!isCategory(input.layer)) return { ok: false, error: "Unknown layer." };

  const gap = input.gapSpec ? coerceGap(input.gapSpec) : null;
  if ((input.itemId ? 1 : 0) + (gap ? 1 : 0) !== 1) {
    return { ok: false, error: "A slot holds either a piece or a gap, not both." };
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("outfit_slots")
    .insert({
      outfit_id: input.outfitId,
      layer: input.layer,
      item_id: input.itemId ?? null,
      gap_spec: gap,
      transform: coerceTransform(input.transform),
    })
    .select(SLOT_COLUMNS)
    .single();

  if (error) return { ok: false, error: error.message };
  return { ok: true, data: data as SlotRow };
}

/** The drag path: one jsonb write, no route refresh. */
export async function updateSlotTransform(
  slotId: string,
  transform: Partial<SlotTransform>,
): Promise<ActionResult<string>> {
  const user = await getUser();
  if (!user) return { ok: false, error: "Not signed in." };

  const supabase = await createClient();
  const { error } = await supabase
    .from("outfit_slots")
    .update({ transform: coerceTransform(transform) })
    .eq("id", slotId);

  if (error) return { ok: false, error: error.message };
  return { ok: true, data: slotId };
}

export async function updateGap(
  slotId: string,
  gapSpec: Partial<GapSpec>,
): Promise<ActionResult<SlotRow>> {
  const user = await getUser();
  if (!user) return { ok: false, error: "Not signed in." };

  const gap = coerceGap(gapSpec);
  if (!gap) return { ok: false, error: "A gap needs a category." };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("outfit_slots")
    .update({ gap_spec: gap, layer: gap.category })
    .eq("id", slotId)
    .select(SLOT_COLUMNS)
    .single();

  if (error) return { ok: false, error: error.message };
  return { ok: true, data: data as SlotRow };
}

export async function removeSlot(slotId: string): Promise<ActionResult<string>> {
  const user = await getUser();
  if (!user) return { ok: false, error: "Not signed in." };

  const supabase = await createClient();
  const { error } = await supabase.from("outfit_slots").delete().eq("id", slotId);

  if (error) return { ok: false, error: error.message };
  return { ok: true, data: slotId };
}

/**
 * Copies an outfit and every slot in it.
 *
 * Two round trips rather than one clever SQL statement: an outfit holds a
 * handful of slots, and a readable copy is worth more here than a saved query.
 */
export async function duplicateOutfit(id: string): Promise<ActionResult<string>> {
  const user = await getUser();
  if (!user) return { ok: false, error: "Not signed in." };

  const supabase = await createClient();

  const { data: source, error: readError } = await supabase
    .from("outfits")
    .select(OUTFIT_COLUMNS)
    .eq("id", id)
    .single();

  if (readError) return { ok: false, error: readError.message };
  const outfit = source as OutfitRow;

  const { data: created, error: createError } = await supabase
    .from("outfits")
    .insert({
      user_id: user.id,
      name: outfit.name ? `${outfit.name} (copy)` : null,
      occasion: outfit.occasion,
      seasons: outfit.seasons,
      canvas: outfit.canvas,
    })
    .select("id")
    .single();

  if (createError) return { ok: false, error: createError.message };

  const { data: slots, error: slotsError } = await supabase
    .from("outfit_slots")
    .select(SLOT_COLUMNS)
    .eq("outfit_id", id);

  if (slotsError) return { ok: false, error: slotsError.message };

  if (slots && slots.length > 0) {
    const { error: copyError } = await supabase.from("outfit_slots").insert(
      (slots as SlotRow[]).map((slot) => ({
        outfit_id: created.id,
        layer: slot.layer,
        item_id: slot.item_id,
        wish_item_id: slot.wish_item_id,
        gap_spec: slot.gap_spec,
        transform: slot.transform,
      })),
    );
    if (copyError) return { ok: false, error: copyError.message };
  }

  refresh();
  return { ok: true, data: created.id };
}

export async function deleteOutfit(id: string): Promise<ActionResult<string>> {
  const user = await getUser();
  if (!user) return { ok: false, error: "Not signed in." };

  const supabase = await createClient();
  // Slots cascade with the outfit; the items themselves are untouched.
  const { error } = await supabase.from("outfits").delete().eq("id", id);

  if (error) return { ok: false, error: error.message };

  refresh();
  return { ok: true, data: id };
}
