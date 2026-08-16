import { CATEGORIES, type Category } from "@/lib/garments";

/**
 * The profile row: home location, spend ceilings, and the capture token.
 *
 * Same reasons as `items.ts` and `outfits.ts` for living outside an actions
 * file — a `"use server"` module may export only async functions, and
 * `supabase-js` derives the row type from the *literal* select string.
 */

export const PROFILE_COLUMNS =
  "user_id, display_name, sizes, location_name, location_lat, location_lon, price_ceilings, capture_token, capture_token_created_at";

export type ProfileRow = {
  user_id: string;
  display_name: string | null;
  sizes: Record<string, unknown>;
  location_name: string | null;
  location_lat: number | null;
  location_lon: number | null;
  price_ceilings: Record<string, number>;
  capture_token: string | null;
  capture_token_created_at: string | null;
};

/**
 * Ceilings the discovery ranker uses until you set your own.
 *
 * Per-category rather than one global number, which was an explicit
 * requirement: a number that makes sense for a t-shirt makes no sense for a
 * coat, and a single ceiling ends up set high enough to be meaningless.
 * These are placeholders in cents — deliberately unremarkable, because the
 * point is that you adjust them in Settings once and forget them.
 */
export const DEFAULT_PRICE_CEILINGS: Record<Category, number> = {
  top: 9_000,
  bottom: 12_000,
  outerwear: 30_000,
  shoes: 20_000,
  socks: 2_500,
  accessory: 8_000,
};

/** Merges stored ceilings over the defaults, dropping anything unrecognised. */
export function priceCeilings(
  stored: Record<string, unknown> | null | undefined,
): Record<Category, number> {
  const ceilings = { ...DEFAULT_PRICE_CEILINGS };
  for (const category of CATEGORIES) {
    const value = Number(stored?.[category]);
    if (Number.isFinite(value) && value > 0) {
      ceilings[category] = Math.round(value);
    }
  }
  return ceilings;
}

/**
 * Mints a capture token.
 *
 * Prefixed so that finding one in a Shortcut, a clipboard, or a log makes it
 * obvious what it is and what to revoke — the same reason `sk-` and `ghp_`
 * exist. 32 bytes of `crypto.getRandomValues` is well past guessable; the
 * alphabet is URL-safe because this travels in a header and, when someone is
 * debugging a Shortcut at midnight, in a query string.
 */
export function generateCaptureToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  const alphabet =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
  let token = "";
  for (const byte of bytes) token += alphabet[byte % alphabet.length];
  return `fitr_${token}`;
}

/** True when this profile has enough of a location to ask for a forecast. */
export function hasLocation(
  profile: Pick<ProfileRow, "location_lat" | "location_lon"> | null,
): boolean {
  return (
    typeof profile?.location_lat === "number" &&
    typeof profile?.location_lon === "number"
  );
}
