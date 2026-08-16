"use server";

import { refresh } from "next/cache";

import { WISH_COLUMNS, type WishItemRow } from "@/lib/captures";
import { isCategory, type Category } from "@/lib/garments";
import { extractProduct } from "@/lib/intake/product-page";
import { FetchRejected, safeFetch } from "@/lib/intake/safe-fetch";
import type { ActionResult } from "@/lib/items";
import { createClient, getUser } from "@/lib/supabase/server";

/**
 * Triage: turning captures into wants, and wants into outfit slots.
 *
 * The inbox is a queue that has to reach empty, so every action here is one
 * click and none of them opens a form. A capture that needs five fields filled
 * in before it can be filed is a capture that stays in the inbox forever, and
 * an inbox that never empties stops being looked at — which is the failure mode
 * for the whole shopping half.
 *
 * So `makeWant` takes what the page already said and asks nothing. The
 * category, the target price and the priority are all editable afterwards, on
 * the want itself, where changing them is a considered act rather than a toll.
 */

function trimOrNull(value: unknown, maxLength = 200): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim().slice(0, maxLength);
  return trimmed || null;
}

/**
 * Saving a link from the app itself.
 *
 * The share sheet and the extension are the fast paths; this is the one that
 * works when neither is set up, on a machine that isn't yours, or when someone
 * sends you a link in a message. It reads the page the same way the capture
 * endpoint does, so a paste and a share produce the same row.
 */
export async function captureUrl(
  url: string,
  note?: string,
): Promise<ActionResult<string>> {
  const user = await getUser();
  if (!user) return { ok: false, error: "Not signed in." };

  const trimmed = url.trim();
  if (!trimmed) return { ok: false, error: "Paste a link first." };

  let title: string | null = null;
  let imageUrl: string | null = null;
  let brand: string | null = null;
  let priceCents: number | null = null;
  let currency: string | null = null;

  try {
    const page = await safeFetch(trimmed, {
      accept: "text/html,application/xhtml+xml",
      maxBytes: 3_000_000,
      timeoutMs: 8_000,
    });
    const product = extractProduct(new TextDecoder().decode(page.body), page.finalUrl);
    title = product.title;
    imageUrl = product.imageUrl;
    brand = product.brand;
    priceCents = product.priceCents;
    currency = product.currency;
  } catch (error) {
    // A link that can't be read is still worth keeping — most social posts
    // carry no product markup at all, and those are the ones worth capturing.
    if (error instanceof FetchRejected && error.status === 400) {
      return { ok: false, error: error.message };
    }
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("captures")
    .insert({
      user_id: user.id,
      source: /tiktok\.com/i.test(trimmed)
        ? "tiktok"
        : /instagram\.com/i.test(trimmed)
          ? "instagram"
          : "web",
      source_url: trimmed,
      image_url: imageUrl,
      title,
      brand,
      price_cents: priceCents,
      currency,
      note: trimOrNull(note, 500),
    })
    .select("id")
    .single();

  if (error) return { ok: false, error: error.message };

  refresh();
  return { ok: true, data: data.id };
}

export async function dismissCapture(id: string): Promise<ActionResult<string>> {
  const user = await getUser();
  if (!user) return { ok: false, error: "Not signed in." };

  const supabase = await createClient();
  // Marked rather than deleted: the row is the evidence that this link was
  // already looked at, which is what stops the same TikTok being re-triaged
  // every time it's shared again.
  const { error } = await supabase
    .from("captures")
    .update({ status: "dismissed" })
    .eq("id", id);

  if (error) return { ok: false, error: error.message };
  refresh();
  return { ok: true, data: id };
}

export async function restoreCapture(id: string): Promise<ActionResult<string>> {
  const user = await getUser();
  if (!user) return { ok: false, error: "Not signed in." };

  const supabase = await createClient();
  const { error } = await supabase
    .from("captures")
    .update({ status: "new" })
    .eq("id", id);

  if (error) return { ok: false, error: error.message };
  refresh();
  return { ok: true, data: id };
}

/**
 * Promotes a capture to a want, in one click.
 *
 * The capture is marked `triaged` rather than deleted, and the want keeps
 * `from_capture_id`, so the link back to where this came from survives — which
 * matters when a match turns up six weeks later and you want to see the video
 * that started it.
 */
export async function makeWant(captureId: string): Promise<ActionResult<WishItemRow>> {
  const user = await getUser();
  if (!user) return { ok: false, error: "Not signed in." };

  const supabase = await createClient();

  const { data: capture, error: readError } = await supabase
    .from("captures")
    .select("id, title, note, source_url, image_key, price_cents")
    .eq("id", captureId)
    .single();

  if (readError) return { ok: false, error: readError.message };

  const { data, error } = await supabase
    .from("wish_items")
    .insert({
      user_id: user.id,
      from_capture_id: capture.id,
      // A capture with no title at all is rare but possible — a bare link from
      // a JS-rendered page. Naming it after the source beats an empty string.
      title: capture.title ?? capture.note ?? "Saved piece",
      description: capture.source_url,
      image_key: capture.image_key,
      // The listing price becomes the opening target. It's the number you'd
      // have paid, so it's the right thing to want a drop below.
      target_price_cents: capture.price_cents,
    })
    .select(WISH_COLUMNS)
    .single();

  if (error) return { ok: false, error: error.message };

  await supabase.from("captures").update({ status: "triaged" }).eq("id", captureId);

  refresh();
  return { ok: true, data: data as WishItemRow };
}

export async function updateWant(
  id: string,
  patch: {
    title?: string;
    category?: string | null;
    targetPriceCents?: number | null;
    priority?: number;
  },
): Promise<ActionResult<WishItemRow>> {
  const user = await getUser();
  if (!user) return { ok: false, error: "Not signed in." };

  const update: Record<string, unknown> = {};
  if (patch.title !== undefined) {
    const title = trimOrNull(patch.title, 160);
    if (!title) return { ok: false, error: "A want needs a name." };
    update.title = title;
  }
  if (patch.category !== undefined) {
    update.category = isCategory(patch.category) ? (patch.category as Category) : null;
  }
  if (patch.targetPriceCents !== undefined) {
    const cents = Number(patch.targetPriceCents);
    update.target_price_cents =
      Number.isFinite(cents) && cents > 0 && cents < 10_000_000
        ? Math.round(cents)
        : null;
  }
  if (patch.priority !== undefined) {
    const priority = Number(patch.priority);
    update.priority = Number.isFinite(priority)
      ? Math.min(5, Math.max(1, Math.round(priority)))
      : 3;
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("wish_items")
    .update(update)
    .eq("id", id)
    .select(WISH_COLUMNS)
    .single();

  if (error) return { ok: false, error: error.message };
  refresh();
  return { ok: true, data: data as WishItemRow };
}

/** Marks a want as bought. Its matches stop being watched. */
export async function fulfilWant(id: string): Promise<ActionResult<string>> {
  const user = await getUser();
  if (!user) return { ok: false, error: "Not signed in." };

  const supabase = await createClient();
  const { error } = await supabase
    .from("wish_items")
    .update({ fulfilled_at: new Date().toISOString() })
    .eq("id", id);

  if (error) return { ok: false, error: error.message };

  // Watching a price for something already owned is how a notification becomes
  // noise, and noise is how notifications get turned off entirely.
  await supabase
    .from("product_matches")
    .update({ watching: false })
    .eq("wish_item_id", id);

  refresh();
  return { ok: true, data: id };
}

export async function deleteWant(id: string): Promise<ActionResult<string>> {
  const user = await getUser();
  if (!user) return { ok: false, error: "Not signed in." };

  const supabase = await createClient();
  const { error } = await supabase.from("wish_items").delete().eq("id", id);

  if (error) return { ok: false, error: error.message };
  refresh();
  return { ok: true, data: id };
}

/**
 * Drops a want into an outfit's gap — the move the whole data model was shaped
 * around.
 *
 * A slot holds exactly one of an item, a wish item, or a gap spec, enforced by
 * a check constraint. So filling a gap means clearing `gap_spec` in the same
 * statement that sets `wish_item_id`; setting one without clearing the other
 * fails in Postgres, which is the constraint doing its job.
 */
export async function fillGapWithWant(
  slotId: string,
  wishItemId: string,
): Promise<ActionResult<string>> {
  const user = await getUser();
  if (!user) return { ok: false, error: "Not signed in." };

  const supabase = await createClient();
  const { error } = await supabase
    .from("outfit_slots")
    .update({ wish_item_id: wishItemId, gap_spec: null, item_id: null })
    .eq("id", slotId);

  if (error) return { ok: false, error: error.message };
  refresh();
  return { ok: true, data: slotId };
}
