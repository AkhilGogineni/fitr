import type { GarmentTags } from "@/lib/garments";

/**
 * The shape of a wardrobe row, and the column list that produces it.
 *
 * This lives outside the Server Actions file for two reasons. A `"use server"`
 * module may only export async functions, so a shared constant can't sit there.
 * And `supabase-js` types a query from the *literal* select string — build the
 * list by concatenation and the row type silently collapses to
 * `GenericStringError`, which surfaces as a wall of "property does not exist"
 * errors far away from the cause. One literal, imported everywhere.
 */
export const ITEM_COLUMNS =
  "id, category, subcategory, brand, colors, pattern, material, formality, seasons, image_cutout_key, image_original_key, source_url, purchase_price_cents, needs_review, created_at";

export type WardrobeItem = {
  id: string;
  category: string;
  subcategory: string | null;
  brand: string | null;
  colors: string[];
  pattern: string | null;
  material: string | null;
  formality: number | null;
  seasons: string[];
  image_cutout_key: string;
  image_original_key: string | null;
  source_url: string | null;
  purchase_price_cents: number | null;
  needs_review: boolean;
  created_at: string;
};

/** A correction from the review grid. Absent keys are left alone. */
export type ItemPatch = {
  brand?: string | null;
  purchasePriceCents?: number | null;
} & Partial<GarmentTags>;

export type NewItemInput = {
  imageCutoutKey: string;
  imageOriginalKey?: string | null;
  sourceUrl?: string | null;
  purchasePriceCents?: number | null;
  brand?: string | null;
  tags: Partial<GarmentTags>;
  /** False only when the user typed every field themselves. */
  needsReview?: boolean;
};

export type ActionResult<T> = { ok: true; data: T } | { ok: false; error: string };
