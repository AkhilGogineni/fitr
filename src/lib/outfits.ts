import type { Category } from "@/lib/garments";

/**
 * The outfit canvas: types, column lists, and the coordinate space.
 *
 * Same reasons as `items.ts` for living outside the Server Actions file — a
 * `"use server"` module may export only async functions, and `supabase-js`
 * types a query from the literal select string.
 */

export const OUTFIT_COLUMNS =
  "id, name, occasion, seasons, canvas, created_at, updated_at";

export const SLOT_COLUMNS =
  "id, outfit_id, layer, item_id, wish_item_id, gap_spec, transform, created_at";

export const OCCASIONS = ["work", "going_out", "casual", "formal"] as const;
export type Occasion = (typeof OCCASIONS)[number];

export const OCCASION_LABELS: Record<Occasion, string> = {
  work: "Work",
  going_out: "Going out",
  casual: "Casual",
  formal: "Formal",
};

/**
 * Placement is stored in fractions of the canvas, never in pixels.
 *
 * `x` and `y` are the centre of the piece as a fraction of canvas width and
 * height; `scale` is the piece's width as a fraction of canvas width. That makes
 * a saved outfit resolution-independent: the same numbers render identically in
 * the editor, in a 200px thumbnail on the outfits list, and on a phone — which
 * matters because Phase 3's daily suggestion will draw these too, on the
 * smallest screen we have.
 */
export type SlotTransform = {
  x: number;
  y: number;
  scale: number;
  rotation: number;
  z: number;
};

/** The canvas is a 5:7 portrait field — a flat lay is taller than it is wide. */
export const CANVAS_ASPECT = 5 / 7;

/** What an unfilled slot is asking for. A slot holding one of these is a want. */
export type GapSpec = {
  category: Category;
  color?: string | null;
  material?: string | null;
  formality?: number | null;
  note?: string | null;
};

export type OutfitRow = {
  id: string;
  name: string | null;
  occasion: Occasion | null;
  seasons: string[];
  canvas: Record<string, unknown>;
  created_at: string;
  updated_at: string;
};

export type SlotRow = {
  id: string;
  outfit_id: string;
  layer: Category;
  item_id: string | null;
  wish_item_id: string | null;
  gap_spec: GapSpec | null;
  transform: Partial<SlotTransform> | null;
  created_at: string;
};

/** A slot with everything the canvas needs to draw it. */
export type SlotView = SlotRow & {
  transform: SlotTransform;
  /** Absent for gap slots, which draw as a placeholder. */
  imageUrl?: string;
  label: string;
};

/**
 * Where a piece lands when you add it, and what sits in front of what.
 *
 * A flat lay has a conventional reading order — trousers under the shirt, jacket
 * over both, shoes at the bottom of the frame — so adding a garment puts it
 * somewhere sensible rather than in a pile at the centre. Every value is a
 * starting point the user immediately overrides by dragging; the point is that
 * four clicks produce something that already looks like an outfit.
 */
const LAYER_DEFAULTS: Record<Category, { x: number; y: number; scale: number; z: number }> = {
  bottom: { x: 0.5, y: 0.62, scale: 0.44, z: 10 },
  shoes: { x: 0.5, y: 0.88, scale: 0.3, z: 20 },
  socks: { x: 0.76, y: 0.8, scale: 0.16, z: 25 },
  top: { x: 0.5, y: 0.31, scale: 0.44, z: 30 },
  outerwear: { x: 0.22, y: 0.4, scale: 0.42, z: 40 },
  accessory: { x: 0.8, y: 0.18, scale: 0.2, z: 50 },
};

export function defaultTransform(layer: Category, taken: number): SlotTransform {
  const base = LAYER_DEFAULTS[layer];
  // A second top shouldn't land exactly on the first — offset each repeat.
  const nudge = taken * 0.06;
  return {
    x: Math.min(0.92, base.x + nudge),
    y: Math.min(0.92, base.y + nudge * 0.4),
    scale: base.scale,
    rotation: 0,
    z: base.z + taken,
  };
}

/** Fills in anything a stored transform is missing, so a bad row can't blank the canvas. */
export function normaliseTransform(
  transform: Partial<SlotTransform> | null,
  layer: Category,
): SlotTransform {
  const base = LAYER_DEFAULTS[layer];
  return {
    x: clamp(transform?.x ?? base.x, -0.2, 1.2),
    y: clamp(transform?.y ?? base.y, -0.2, 1.2),
    scale: clamp(transform?.scale ?? base.scale, 0.05, 1.6),
    rotation: transform?.rotation ?? 0,
    z: Math.round(transform?.z ?? base.z),
  };
}

export function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, Number.isFinite(value) ? value : min));
}

/** One line describing what a gap is looking for, e.g. "cream wool top". */
export function describeGap(gap: GapSpec, categoryLabel: string) {
  return [gap.color, gap.material, categoryLabel.toLowerCase()]
    .filter(Boolean)
    .join(" ");
}
