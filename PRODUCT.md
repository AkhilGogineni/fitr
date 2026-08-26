# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Built and used first by its maker — a style-conscious person who buys online,
saves inspiration from TikTok/Instagram, and stands in front of a wardrobe at
7am deciding what to wear. Single-account today; multi-user (Supabase auth + RLS
already per-user) is the intended future.

## Product Purpose

A personal wardrobe + shopping app in two feeding halves: garments as
background-removed cutouts composed into layered outfits on a canvas (outfits
may contain *gaps* for pieces not yet owned), and a shopping side where saved
inspiration becomes wants, grounded search finds real buyable pieces, a closet
check says whether they'd actually work, and watched prices are tracked daily.
Success: the daily suggestion gets worn (acceptance rate > ~40%), and outfit
gaps quietly become the shopping list.

## Positioning

`outfit_slots` is the hinge no neighbour has: one row holds an owned item, a
wishlist item, or a gap spec — so composing outfits *generates* the shopping
list as a byproduct, discovery is checked against what you actually own (and is
willing to say "no"), and every discovered URL is verified real before it's
shown. No affiliate feed, no commission incentive.

## Operating Context

- Morning, phone, standing at the wardrobe: `/today` must answer instantly with
  zero decisions beyond yes/no.
- Laptop sessions: intake batches (~20 garments), outfit composition on canvas.
- Capture happens anywhere via iOS share sheet / browser extension / paste,
  authenticated by bearer token rather than session.
- Price checks run on a GitHub Actions cron reading JSON-LD; `/watch` is the
  primary surface, push notifications are opt-in convenience only.

## Capabilities and Constraints

- Cutouts are transparent PNGs cut **in-browser** (RMBG-1.4); white/light
  garments vanish on light grounds, so items always sit on `--surface` cards,
  never directly on the page ground. Check all image UI in both themes.
- Outfit placement is fractional (`x`,`y`,`scale` as fractions of canvas), so
  one renderer draws the same composition at thumbnail and editor scale. Never
  store pixels.
- Next.js 16 App Router; Middleware is renamed Proxy (`src/proxy.ts`);
  `cookies()` async; `"use server"` files export async functions only.
- Supabase RLS scopes every query — pages never filter by `user_id`.
- Images live in Cloudflare R2; plain `<img>` deliberately (Vercel optimiser is
  metered on this tier).
- A page load never composes an outfit (server pre-computes the day's
  suggestion; model picks from a shortlist, cannot invent garments).
- Discovery verifies URLs before storing; unwatchable pages are flagged, never
  scraped.

## Brand Commitments

None binding — name "fitr", tagline "Your wardrobe, and what belongs in it
next.", and the incumbent quiet paper-and-ink look are all replaceable
(confirmed by owner, 2026-08-25).

## Evidence on Hand

Real app, six phases built and deployed (Vercel), awaiting real-use exit
criteria. No marketing site, no testimonials, no press. Demo data must not be
fabricated as product claims; garment/outfit imagery comes only from the user's
own uploads or clearly synthetic placeholders.

## Product Principles

1. The 7am test: anything on the phone that adds hesitation costs the wear log.
2. Honesty over delight-theatre: states say what is true (cutter down, search
   budget spent, price unreadable) rather than papering over.
3. One artefact kind: every garment image is a transparent cutout, everywhere.
4. Local and cheap beats remote and metered when quality holds.
5. Explanation is part of the value (why this outfit, why this verdict).

## Accessibility & Inclusion

Keyboard operability expected on desktop surfaces (canvas already supports
nudge/restack/delete keys). Reduced-motion respected. Both colour schemes are
first-class; light-on-light and dark-on-dark garment legibility is a functional
requirement, not a taste question.
