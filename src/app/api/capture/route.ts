import { NextResponse } from "next/server";

import { extractProduct } from "@/lib/intake/product-page";
import { FetchRejected, safeFetch } from "@/lib/intake/safe-fetch";
import { buildObjectKey, isAllowedContentType, putObject } from "@/lib/r2";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * The capture endpoint — the front door for the shopping half.
 *
 * One URL serves both clients: the iOS Shortcut on the share sheet and the
 * MV3 browser extension. They send the same JSON and present the same bearer
 * token, because two capture paths would mean two things to debug at the exact
 * moment you're trying to save something before the video scrolls away.
 *
 * **Why a token rather than a session.** A Shortcut cannot hold a Supabase
 * session — there is no browser, no cookie jar, and no way to run a refresh. So
 * the credential is a `fitr_…` token minted in Settings, sent as a bearer
 * header, and resolved here to a user id. It authorises exactly one operation.
 *
 * **What keeps that safe.** This route uses the service-role client, which
 * bypasses RLS — so the safety property is not the database's, it's this file's:
 * `user_id` comes from the row the token was found on and never from the
 * request body. A caller with a valid token can create a capture for exactly
 * one account, whatever they put in the payload.
 *
 * **Best-effort enrichment.** Given a URL and nothing else, this reads the page
 * for a title, a brand, a price and an image, using the same parser as URL
 * import. It fails silently: a capture with only a link is still a capture, and
 * a share sheet that spins for eight seconds is one that stops getting used.
 */

/** A phone screenshot base64s to well under this. Bigger is a mistake, not a photo. */
const MAX_IMAGE_BASE64 = 8_000_000;
const CAPTURE_SOURCES = ["tiktok", "instagram", "web", "photo", "other"] as const;

/**
 * Both clients are cross-origin by nature — an extension's service worker has
 * no page origin, and Shortcuts sends no `Origin` at all. Wide-open CORS is
 * safe here specifically because the credential is a bearer token: a browser
 * will never attach it on a site's behalf the way it would attach a cookie, so
 * there is no request a malicious page could forge.
 */
const CORS_HEADERS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "POST, GET, OPTIONS",
  "access-control-allow-headers": "authorization, content-type",
  "access-control-max-age": "86400",
} as const;

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}

function json(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: CORS_HEADERS });
}

/** Resolves a bearer token to a user id, or null. */
async function userForToken(request: Request): Promise<string | null> {
  const header = request.headers.get("authorization") ?? "";
  const token = header.replace(/^Bearer\s+/i, "").trim();
  // A `fitr_` prefix check before touching the database: it costs nothing and
  // keeps random scanner traffic from becoming queries.
  if (!token.startsWith("fitr_") || token.length < 20) return null;

  const supabase = createAdminClient();
  const { data } = await supabase
    .from("profiles")
    .select("user_id")
    .eq("capture_token", token)
    .maybeSingle();

  return data?.user_id ?? null;
}

/**
 * Confirms a token works, for setting up a Shortcut.
 *
 * Configuring a Shortcut is a blind exercise — you get "the operation could not
 * be completed" and no clue whether the token, the URL, or the JSON was wrong.
 * A GET that answers plainly turns that into thirty seconds.
 */
export async function GET(request: Request) {
  const userId = await userForToken(request);
  if (!userId) return json({ ok: false, error: "Bad or missing capture token." }, 401);
  return json({ ok: true, message: "Token is good. Captures will land in your inbox." });
}

export async function POST(request: Request) {
  const userId = await userForToken(request);
  if (!userId) return json({ ok: false, error: "Bad or missing capture token." }, 401);

  let body: {
    sourceUrl?: string;
    source?: string;
    note?: string;
    title?: string;
    imageBase64?: string;
    contentType?: string;
  };
  try {
    body = await request.json();
  } catch {
    return json({ ok: false, error: "Expected a JSON body." }, 400);
  }

  const sourceUrl = typeof body.sourceUrl === "string" ? body.sourceUrl.trim() : "";
  const note = typeof body.note === "string" ? body.note.trim().slice(0, 500) : null;
  let title = typeof body.title === "string" ? body.title.trim().slice(0, 200) : null;

  if (!sourceUrl && !body.imageBase64 && !note) {
    return json({ ok: false, error: "Send at least a link, an image, or a note." }, 400);
  }

  // The source is inferred from the URL when the client didn't say, because a
  // Shortcut on the share sheet knows the URL and not much else.
  const source = (CAPTURE_SOURCES as readonly string[]).includes(body.source ?? "")
    ? body.source!
    : /tiktok\.com/i.test(sourceUrl)
      ? "tiktok"
      : /instagram\.com/i.test(sourceUrl)
        ? "instagram"
        : sourceUrl
          ? "web"
          : "other";

  let imageUrl: string | null = null;
  let brand: string | null = null;
  let priceCents: number | null = null;
  let currency: string | null = null;

  // -- Read the page, if there is one and we need anything from it ----------
  if (sourceUrl && (!title || !body.imageBase64)) {
    try {
      const page = await safeFetch(sourceUrl, {
        accept: "text/html,application/xhtml+xml",
        maxBytes: 3_000_000,
        // Deliberately tight. This runs while a share sheet is open; the
        // capture is worth more than the metadata on it.
        timeoutMs: 6_000,
      });
      const product = extractProduct(
        new TextDecoder().decode(page.body),
        page.finalUrl,
      );
      title = title ?? product.title;
      imageUrl = product.imageUrl;
      brand = product.brand;
      priceCents = product.priceCents;
      currency = product.currency;
    } catch (error) {
      // Unreachable, private, slow, or a bot wall — none of it stops a capture.
      // A social post is the common case here and has no product markup anyway.
      if (!(error instanceof FetchRejected)) {
        console.error("Capture enrichment failed", error);
      }
    }
  }

  // -- Mirror an inline image, when one was sent ---------------------------
  let imageKey: string | null = null;
  if (typeof body.imageBase64 === "string" && body.imageBase64.length > 0) {
    if (body.imageBase64.length > MAX_IMAGE_BASE64) {
      return json({ ok: false, error: "That image is too large." }, 413);
    }
    const contentType = body.contentType ?? "image/jpeg";
    if (!isAllowedContentType("capture", contentType)) {
      return json({ ok: false, error: `Can't store ${contentType}.` }, 415);
    }
    try {
      const bytes = Uint8Array.from(
        atob(body.imageBase64.replace(/^data:[^,]+,/, "")),
        (character) => character.charCodeAt(0),
      );
      imageKey = await putObject(
        buildObjectKey(userId, "capture", contentType),
        bytes,
        contentType,
      );
    } catch {
      // A capture with a broken image is still a capture worth having.
      imageKey = null;
    }
  }

  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("captures")
    .insert({
      // From the token lookup, never from the body. This is the line that makes
      // a service-role write safe.
      user_id: userId,
      source,
      source_url: sourceUrl || null,
      image_key: imageKey,
      image_url: imageUrl,
      title,
      brand,
      price_cents: priceCents,
      currency,
      note,
    })
    .select("id")
    .single();

  if (error) {
    console.error("Capture insert failed", error);
    return json({ ok: false, error: "Couldn't save that." }, 500);
  }

  return json({ ok: true, captureId: data.id, title, imageUrl }, 201);
}
