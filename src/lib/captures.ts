import type { Category } from "@/lib/garments";

/**
 * The shopping inbox: captures, and the wants they become.
 *
 * Same reasons as `items.ts` for living outside the actions file — a
 * `"use server"` module may export only async functions, and `supabase-js`
 * types a query from the literal select string.
 *
 * A capture is raw: a link, maybe a picture, maybe whatever the page said about
 * itself. A wish item is a decision — this is a thing I want, in this category,
 * at about this price. Triage is the step between, and keeping them as separate
 * tables is what lets the inbox be emptied without losing the wants.
 */

export const CAPTURE_COLUMNS =
  "id, source, source_url, image_key, image_url, title, brand, price_cents, currency, note, status, created_at";

export const CAPTURE_SOURCES = ["tiktok", "instagram", "web", "photo", "other"] as const;
export type CaptureSource = (typeof CAPTURE_SOURCES)[number];

export const CAPTURE_SOURCE_LABELS: Record<CaptureSource, string> = {
  tiktok: "TikTok",
  instagram: "Instagram",
  web: "Web",
  photo: "Photo",
  other: "Saved",
};

export type CaptureRow = {
  id: string;
  source: CaptureSource;
  source_url: string | null;
  image_key: string | null;
  image_url: string | null;
  title: string | null;
  brand: string | null;
  price_cents: number | null;
  currency: string | null;
  note: string | null;
  status: "new" | "triaged" | "matched" | "dismissed";
  created_at: string;
};

export const WISH_COLUMNS =
  "id, from_capture_id, title, description, category, target_price_cents, priority, image_key, fulfilled_at, last_discovery_at, fit_note, created_at";

export type WishItemRow = {
  id: string;
  from_capture_id: string | null;
  title: string;
  description: string | null;
  category: Category | null;
  target_price_cents: number | null;
  priority: number;
  image_key: string | null;
  fulfilled_at: string | null;
  last_discovery_at: string | null;
  fit_note: string | null;
  created_at: string;
};

export const MATCH_COLUMNS =
  "id, wish_item_id, url, retailer, brand, title, image_url, price_cents, currency, in_stock, score, unwatchable, watching, notified_price_cents, found_at, last_checked_at";

export type ProductMatchRow = {
  id: string;
  wish_item_id: string;
  url: string;
  retailer: string | null;
  brand: string | null;
  title: string | null;
  image_url: string | null;
  price_cents: number | null;
  currency: string;
  in_stock: boolean | null;
  score: number | null;
  unwatchable: boolean;
  watching: boolean;
  notified_price_cents: number | null;
  found_at: string;
  last_checked_at: string | null;
};

export const PRIORITY_LABELS: Record<number, string> = {
  1: "Someday",
  2: "Low",
  3: "Normal",
  4: "Keen",
  5: "Actively looking",
};

/** A capture's best available picture: our copy first, the remote one second. */
export function captureImage(
  capture: Pick<CaptureRow, "image_key" | "image_url">,
  publicUrlFor: (key: string) => string,
): string | null {
  if (capture.image_key) return publicUrlFor(capture.image_key);
  return capture.image_url;
}
