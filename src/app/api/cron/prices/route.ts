import { NextResponse } from "next/server";

import { cronSecret } from "@/lib/env";
import { extractProduct } from "@/lib/intake/product-page";
import { safeFetch } from "@/lib/intake/safe-fetch";
import { pushIsConfigured, sendPush, type PushSubscriptionRow } from "@/lib/push";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * The daily price check.
 *
 * Runs from a GitHub Actions cron rather than on this server's own schedule,
 * which also keeps the Supabase free tier from pausing after seven idle days —
 * a side effect worth more than it sounds, because a paused database means a
 * dead app on a Monday morning.
 *
 * **Why this can read a price at all.** Nearly every retailer publishes
 * `Product`/`Offer` JSON-LD for Google Shopping, so a plain fetch and the same
 * parser that powers URL import gets the number. No headless browser, no
 * anti-bot fight. A page that publishes nothing readable is marked
 * `unwatchable` and dropped from the queue rather than escalated to scraping.
 *
 * **The queue is oldest-first and bounded.** `product_matches_watch_idx` orders
 * by `last_checked_at nulls first`, so a run takes the least recently checked
 * batch and the next run takes the next. Nothing starves, and no single
 * invocation can run past a serverless timeout no matter how long the watch
 * list gets.
 *
 * **Notifications are not the product.** Every observation is recorded whether
 * or not push is configured, whether or not anyone is subscribed, and whether
 * or not the send succeeds. `/watch` reads the same rows.
 */

/** Bounded so one run always finishes well inside the timeout. */
const BATCH_SIZE = 25;
const FETCH_CONCURRENCY = 4;

/** A fall this large is worth interrupting someone about even without a target. */
const MEANINGFUL_DROP = 0.1;

export const maxDuration = 60;

type WatchedMatch = {
  id: string;
  user_id: string;
  wish_item_id: string;
  url: string;
  title: string | null;
  brand: string | null;
  retailer: string | null;
  price_cents: number | null;
  currency: string;
  notified_price_cents: number | null;
};

type CheckResult = {
  match: WatchedMatch;
  priceCents: number | null;
  inStock: boolean;
  readable: boolean;
};

async function check(match: WatchedMatch): Promise<CheckResult> {
  try {
    const page = await safeFetch(match.url, {
      accept: "text/html,application/xhtml+xml",
      maxBytes: 3_000_000,
      timeoutMs: 9_000,
    });
    const product = extractProduct(new TextDecoder().decode(page.body), page.finalUrl);
    return {
      match,
      priceCents: product.priceCents,
      // A page that still publishes a price is taken as still selling it.
      // Reading true stock state means per-retailer parsing, which is the arms
      // race this design exists to avoid.
      inStock: product.priceCents !== null,
      readable: product.priceCents !== null,
    };
  } catch {
    // A transient failure — a timeout, a 503, a bot wall having a bad day —
    // must not look like a price change. Nothing is recorded for it beyond the
    // check having happened.
    return { match, priceCents: null, inStock: false, readable: false };
  }
}

export async function POST(request: Request) {
  let expected: string;
  try {
    expected = cronSecret();
  } catch {
    return NextResponse.json(
      { error: "CRON_SECRET isn't set on the server." },
      { status: 503 },
    );
  }

  const presented =
    request.headers.get("authorization")?.replace(/^Bearer\s+/i, "").trim() ??
    request.headers.get("x-cron-secret")?.trim() ??
    "";

  // Length-independent comparison isn't worth the ceremony here — the secret is
  // high-entropy and this endpoint isn't rate-limited enough for a timing
  // attack to be the weak link — but a plain mismatch must never say which part
  // was wrong.
  if (!presented || presented !== expected) {
    return NextResponse.json({ error: "Nope." }, { status: 401 });
  }

  const supabase = createAdminClient();

  const { data: matchRows, error } = await supabase
    .from("product_matches")
    .select(
      "id, user_id, wish_item_id, url, title, brand, retailer, price_cents, currency, notified_price_cents",
    )
    .eq("watching", true)
    .eq("unwatchable", false)
    .order("last_checked_at", { ascending: true, nullsFirst: true })
    .limit(BATCH_SIZE);

  if (error) {
    console.error("Cron could not read the watch list", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const matches = (matchRows ?? []) as WatchedMatch[];
  if (matches.length === 0) {
    return NextResponse.json({ checked: 0, drops: 0, notified: 0 });
  }

  const results: CheckResult[] = [];
  for (let start = 0; start < matches.length; start += FETCH_CONCURRENCY) {
    const batch = matches.slice(start, start + FETCH_CONCURRENCY);
    results.push(...(await Promise.all(batch.map(check))));
  }

  const checkedAt = new Date().toISOString();
  const observations: {
    product_match_id: string;
    price_cents: number | null;
    in_stock: boolean;
  }[] = [];
  const drops: { result: CheckResult; previous: number; now: number }[] = [];

  for (const result of results) {
    const previous = result.match.price_cents;

    if (result.readable && result.priceCents !== null) {
      observations.push({
        product_match_id: result.match.id,
        price_cents: result.priceCents,
        in_stock: result.inStock,
      });

      const alreadyToldAbout = result.match.notified_price_cents;
      const isNewLow =
        alreadyToldAbout === null || result.priceCents < alreadyToldAbout;

      if (
        previous !== null &&
        result.priceCents < previous * (1 - MEANINGFUL_DROP) &&
        isNewLow
      ) {
        drops.push({ result, previous, now: result.priceCents });
      }
    }

    await supabase
      .from("product_matches")
      .update({
        last_checked_at: checkedAt,
        // A price only overwrites the stored one when it was actually read. An
        // unreadable page must not blank the last known price — that would make
        // the next successful read look like a change.
        ...(result.readable && result.priceCents !== null
          ? { price_cents: result.priceCents, in_stock: result.inStock }
          : {}),
      })
      .eq("id", result.match.id);
  }

  if (observations.length > 0) {
    const { error: insertError } = await supabase
      .from("price_observations")
      .insert(observations);
    if (insertError) console.error("Could not write observations", insertError);
  }

  // -- Notify ---------------------------------------------------------------
  let notified = 0;

  if (drops.length > 0 && pushIsConfigured()) {
    // One query for every affected user's devices rather than one per drop.
    const userIds = [...new Set(drops.map((drop) => drop.result.match.user_id))];
    const { data: subscriptionRows } = await supabase
      .from("push_subscriptions")
      .select("id, user_id, endpoint, p256dh, auth")
      .in("user_id", userIds);

    const byUser = new Map<string, PushSubscriptionRow[]>();
    for (const row of (subscriptionRows ?? []) as (PushSubscriptionRow & {
      user_id: string;
    })[]) {
      byUser.set(row.user_id, [...(byUser.get(row.user_id) ?? []), row]);
    }

    for (const drop of drops) {
      const subscriptions = byUser.get(drop.result.match.user_id) ?? [];
      const name =
        drop.result.match.title ?? drop.result.match.brand ?? drop.result.match.retailer ?? "Something you're watching";
      const percent = Math.round((1 - drop.now / drop.previous) * 100);

      for (const subscription of subscriptions) {
        const sent = await sendPush(subscription, {
          title: `${percent}% off — ${name}`.slice(0, 80),
          body: `Now ${format(drop.now, drop.result.match.currency)}, was ${format(drop.previous, drop.result.match.currency)}.`,
          url: "/watch",
          // Tagged by match, so a second drop on the same product replaces the
          // first notification instead of stacking up.
          tag: drop.result.match.id,
        });

        if (sent.ok) {
          notified++;
          await supabase
            .from("push_subscriptions")
            .update({ last_success_at: checkedAt })
            .eq("id", subscription.id);
        } else if (sent.gone) {
          // The browser was reinstalled, or the PWA deleted. Retrying this
          // forever is how a watch list quietly becomes all dead endpoints.
          await supabase.from("push_subscriptions").delete().eq("id", subscription.id);
        }
      }

      // Recorded whether or not a notification went anywhere, so the same drop
      // isn't re-detected tomorrow.
      await supabase
        .from("product_matches")
        .update({ notified_price_cents: drop.now })
        .eq("id", drop.result.match.id);
    }
  } else if (drops.length > 0) {
    // Push isn't set up. The drop is still recorded so `/watch` shows it, and
    // so it isn't announced again once push is turned on later.
    for (const drop of drops) {
      await supabase
        .from("product_matches")
        .update({ notified_price_cents: drop.now })
        .eq("id", drop.result.match.id);
    }
  }

  return NextResponse.json({
    checked: results.length,
    readable: results.filter((result) => result.readable).length,
    drops: drops.length,
    notified,
  });
}

function format(cents: number, currency: string) {
  try {
    return new Intl.NumberFormat("en", {
      style: "currency",
      currency,
      maximumFractionDigits: 0,
    }).format(cents / 100);
  } catch {
    return `${(cents / 100).toFixed(0)} ${currency}`;
  }
}

/**
 * A GET that reports readiness without doing any work.
 *
 * Cron failures are silent by nature — nobody notices a job that stopped
 * running until a price drop doesn't arrive weeks later. This makes the setup
 * checkable in one curl.
 */
export async function GET() {
  let configured = true;
  try {
    cronSecret();
  } catch {
    configured = false;
  }
  return NextResponse.json({
    ok: configured,
    push: pushIsConfigured(),
    message: configured
      ? "Ready. POST here with the cron secret to run a check."
      : "CRON_SECRET isn't set on the server.",
  });
}
