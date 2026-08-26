"use server";

import { refresh } from "next/cache";

import { WISH_COLUMNS, type WishItemRow } from "@/lib/captures";
import { isCategory, type Category } from "@/lib/garments";
import { fetchTikTokOEmbed } from "@/lib/intake/oembed";
import { extractProduct } from "@/lib/intake/product-page";
import { FetchRejected, safeFetch } from "@/lib/intake/safe-fetch";
import type { ActionResult } from "@/lib/items";
import { buildObjectKey, putObject } from "@/lib/r2";
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
 * A name from the address itself, for pages that refused to be read.
 *
 * Retailer slugs are written for URLs but they read fine as titles:
 * `/p/anorak-jacket-63490735` becomes "Anorak Jacket". The interesting segment
 * isn't always the last one — Nike parks the real name one level above its
 * style code — so every segment gets scored and the wordiest wins. Segments
 * that are mostly digits are style codes, video ids and locale fragments, and
 * a code is worse than no title at all: those yield nothing.
 */
/** Path fragments that are navigation, never a name. */
const SEGMENT_STOPWORDS = new Set([
  "shop", "store", "products", "product", "item", "items", "p", "dp", "pd",
  "t", "en", "us", "uk", "au", "ca", "de", "fr", "www", "new", "all", "goods",
  "video", "videos", "reel", "reels", "watch", "status", "photo", "post",
]);

function titleFromUrl(url: string): string | null {
  let segments: string[];
  try {
    segments = new URL(url).pathname.split("/").filter(Boolean);
  } catch {
    return null;
  }

  const candidates: { words: number; title: string }[] = [];
  for (const segment of segments.slice(-4)) {
    let text: string;
    try {
      text = decodeURIComponent(segment)
        .replace(/\.(html?|php)$/i, "")
        .replace(/[-_]\d{4,}.*$/, "") // trailing product ids
        .replace(/[-_]+/g, " ")
        .replace(/\s+/g, " ")
        .trim();
    } catch {
      continue;
    }
    if (!text || /^\d+$/.test(text)) continue;
    // Social handles (@user) and bare locale codes are not titles either.
    if (/^@/.test(text) || /^[a-z]{2}$/i.test(text)) continue;
    if (SEGMENT_STOPWORDS.has(text.toLowerCase())) continue;
    const letters = text.replace(/[^a-z]/gi, "");
    const digits = text.replace(/\D/g, "");
    // A style code reads "P09187250"; a name never looks like that.
    if (/^[a-z]?(\d+[ ]?)+$/i.test(text)) continue;
    if (letters.length >= 2 && digits.length / letters.length > 1) continue;

    const words = text.split(" ").filter((word) => /[a-z]{2}/i.test(word)).length;
    candidates.push({ words, title: text });
  }

  const named = candidates.filter((entry) => entry.words >= 2);
  const winner = named.length > 0 ? named[named.length - 1] : candidates[0];
  if (!winner) return null;
  return winner.title.replace(/\b\w/g, (c) => c.toUpperCase()).slice(0, 120);
}

/**
 * Saving a link from the app itself.
 *
 * The share sheet and the extension are the fast paths; this is the one that
 * works when neither is set up, on a machine that isn't yours, or when someone
 * sends you a link in a message. It reads the page the same way the capture
 * endpoint does, so a paste and a share produce the same row.
 *
 * Some sites refuse every automated read — the big fashion chains sit behind
 * bot walls that 403 anything without a real browser. The row still saves:
 * the URL is worth keeping. What changes is that the paste answers honestly
 * ("this site blocks readers") instead of quietly filing an empty card, and
 * the capture carries a name guessed from its own address until a picture is
 * attached by hand.
 */
export async function captureUrl(
  url: string,
  note?: string,
): Promise<ActionResult<string> & { warning?: string }> {
  const user = await getUser();
  if (!user) return { ok: false, error: "Not signed in." };

  const trimmed = url.trim();
  if (!trimmed) return { ok: false, error: "Paste a link first." };

  let title: string | null = null;
  let imageUrl: string | null = null;
  let brand: string | null = null;
  let priceCents: number | null = null;
  let currency: string | null = null;
  let imageKey: string | null = null;
  let blockedBySite = false;

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
    // A link that can't be read is still worth keeping — but a site that
    // answered 403 is a different situation from one that was unreachable,
    // and the difference is worth saying out loud.
    if (error instanceof FetchRejected && error.status === 400) {
      return { ok: false, error: error.message };
    }
    if (error instanceof FetchRejected) blockedBySite = true;
  }

  /*
   * The HTML said nothing — the usual case for TikTok, which renders in the
   * browser. Its public oEmbed endpoint still knows the caption, the thumbnail
   * and who posted it, which turns "Untitled" into a card you can recognise a
   * week later. Best effort by design: a silent endpoint costs nothing here.
   */
  try {
    const embed = await fetchTikTokOEmbed(trimmed);
    if (embed) {
      title ??= embed.title;
      imageUrl ??= embed.imageUrl;
      brand ??= embed.author;
    }
  } catch {
    // oEmbed failing changes what lands in the row, not whether it lands.
  }

  /*
   * Mirror the picture into R2 when we can. Remote retailer and CDN URLs die —
   * they expire, they hotlink-block, they change shape — and a capture whose
   * picture outlives its source is what makes triage possible on Tuesday for
   * something shared on Friday. Failure keeps the remote URL as the fallback.
   */
  if (imageUrl) {
    try {
      const image = await safeFetch(imageUrl, {
        accept: "image/*",
        maxBytes: 8_000_000,
        timeoutMs: 8_000,
      });
      if (image.contentType.startsWith("image/")) {
        imageKey = await putObject(
          buildObjectKey(user.id, "capture", image.contentType),
          image.body,
          image.contentType,
        );
      }
    } catch {
      // Kept the remote URL above; the inbox prefers our copy but shows theirs.
    }
  }

  // Nothing readable anywhere? The address itself usually still names the
  // thing — "anorak-jacket-63490735" is a better card than "Untitled".
  title ??= titleFromUrl(trimmed);

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
      image_key: imageKey,
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

  const host = (() => {
    try {
      return new URL(trimmed).hostname.replace(/^www\./, "");
    } catch {
      return "that site";
    }
  })();

  return {
    ok: true,
    data: data.id,
    warning: blockedBySite
      ? `Saved — but ${host} blocks automated readers, so it couldn't get a picture. Attach one on the card.`
      : imageUrl
        ? undefined
        : `Saved, with no picture — the page didn't offer one. Attach one on the card if you have it.`,
  };
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
 * Attaches a picture to a capture that went in bare.
 *
 * The bytes were uploaded straight to R2 by the browser (same presigned path
 * as intake); this only wires the resulting key to the row. The prefix check
 * is the whole security argument: a capture may only point at an object under
 * the caller's own namespace, so one user can't decorate their captures with
 * another user's objects even by guessing keys.
 */
export async function attachCaptureImage(
  id: string,
  key: string,
): Promise<ActionResult<string>> {
  const user = await getUser();
  if (!user) return { ok: false, error: "Not signed in." };

  if (!key.startsWith(`${user.id}/capture/`)) {
    return { ok: false, error: "That upload doesn't belong to you." };
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("captures")
    .update({ image_key: key })
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
