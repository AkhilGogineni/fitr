"use server";

import { refresh } from "next/cache";

import { CATEGORIES, type Category } from "@/lib/garments";
import type { ActionResult } from "@/lib/items";
import { PROFILE_COLUMNS, generateCaptureToken, type ProfileRow } from "@/lib/profile";
import { createClient, getUser } from "@/lib/supabase/server";
import { WeatherUnavailable, geocode, type GeocodeHit } from "@/lib/weather";

/**
 * Profile writes: home location, spend ceilings, and the capture token.
 *
 * Three settings that each unblock a different phase — the forecast needs
 * coordinates, discovery needs ceilings, and the share sheet needs a token —
 * which is why they arrived together rather than as a settings screen for its
 * own sake.
 *
 * Every profile row is created by the `handle_new_user` trigger at signup, so
 * these all update rather than upsert. If an update ever affects zero rows the
 * trigger didn't fire, and that is worth surfacing rather than papering over
 * with an insert that would hide it.
 */

/**
 * Place search runs as an action rather than a client-side fetch so the
 * geocoder is called from one place and can be swapped without touching the UI.
 * It's a read, but an action is the cheapest way to give the client a typed
 * function instead of a hand-rolled endpoint.
 */
export async function searchPlaces(
  query: string,
): Promise<ActionResult<GeocodeHit[]>> {
  const user = await getUser();
  if (!user) return { ok: false, error: "Not signed in." };

  const trimmed = query.trim();
  if (trimmed.length < 2) return { ok: true, data: [] };

  try {
    return { ok: true, data: await geocode(trimmed) };
  } catch (error) {
    if (error instanceof WeatherUnavailable) {
      return { ok: false, error: error.message };
    }
    return { ok: false, error: "Place lookup failed." };
  }
}

export async function saveLocation(input: {
  name: string;
  lat: number;
  lon: number;
}): Promise<ActionResult<ProfileRow>> {
  const user = await getUser();
  if (!user) return { ok: false, error: "Not signed in." };

  const lat = Number(input.lat);
  const lon = Number(input.lon);
  if (!Number.isFinite(lat) || lat < -90 || lat > 90) {
    return { ok: false, error: "That latitude isn't on Earth." };
  }
  if (!Number.isFinite(lon) || lon < -180 || lon > 180) {
    return { ok: false, error: "That longitude isn't on Earth." };
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("profiles")
    .update({
      location_name: input.name.trim().slice(0, 120) || null,
      // Four decimal places is ~11m, which is far more than a forecast needs
      // and keeps a home address from being stored more precisely than the
      // feature justifies.
      location_lat: Number(lat.toFixed(4)),
      location_lon: Number(lon.toFixed(4)),
    })
    .eq("user_id", user.id)
    .select(PROFILE_COLUMNS)
    .single();

  if (error) return { ok: false, error: error.message };
  refresh();
  return { ok: true, data: data as ProfileRow };
}

export async function savePriceCeilings(
  input: Partial<Record<Category, number | null>>,
): Promise<ActionResult<ProfileRow>> {
  const user = await getUser();
  if (!user) return { ok: false, error: "Not signed in." };

  const ceilings: Record<string, number> = {};
  for (const category of CATEGORIES) {
    const value = Number(input[category]);
    // Anything unset, zero, or absurd is simply omitted, which falls back to
    // the default for that category rather than storing a ceiling of nothing.
    if (Number.isFinite(value) && value > 0 && value <= 10_000_000) {
      ceilings[category] = Math.round(value);
    }
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("profiles")
    .update({ price_ceilings: ceilings })
    .eq("user_id", user.id)
    .select(PROFILE_COLUMNS)
    .single();

  if (error) return { ok: false, error: error.message };
  refresh();
  return { ok: true, data: data as ProfileRow };
}

/**
 * Mints a new capture token, invalidating the old one.
 *
 * The same call creates the first token and rotates an existing one — there is
 * no separate "create" path, because a token that can't be rotated is one you
 * are reluctant to paste anywhere, and this one gets pasted into a Shortcut and
 * an extension.
 */
export async function regenerateCaptureToken(): Promise<ActionResult<string>> {
  const user = await getUser();
  if (!user) return { ok: false, error: "Not signed in." };

  const token = generateCaptureToken();

  const supabase = await createClient();
  const { error } = await supabase
    .from("profiles")
    .update({ capture_token: token, capture_token_created_at: new Date().toISOString() })
    .eq("user_id", user.id);

  if (error) return { ok: false, error: error.message };
  refresh();
  return { ok: true, data: token };
}
