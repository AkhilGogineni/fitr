# fitr — wardrobe + shopping, phased build plan

> **Status:** Phases 0, 1 and 2 are built. Both are waiting on the part only a
> wardrobe in front of you can settle — ~30 real garments through intake and the
> timed pasting-versus-photographing comparison, then five real outfits with at
> least one gap. Phase 3 ("what do I wear today") is next.
>
> **Decisions this document didn't settle, taken during the build.** Phase 1:
> retailer photos are cut out like every other image rather than stored on white;
> both intake paths auto-tag; rows are written the moment their cutout uploads and
> carry `needs_review` until checked; CLIP embeddings deferred to Phase 5.
> Phase 2: placement is stored as fractions of the canvas rather than pixels, so
> one renderer serves the editor, the list thumbnails and the phone — and Phase 3
> inherits it; a narrow screen gets that read-only renderer instead of a worse
> touch editor.
>
> **One assumption in this plan turned out to be wrong.** Finding 3 below says a
> retailer's product page yields a clean photo and its metadata. That holds for
> Shopify-based brands, which server-render it — verified end to end. It does not
> hold for the large chains, which build the page in the browser, so a server
> fetch sees an empty shell. URL import now keeps whatever it *can* read and asks
> for the photo (⌘V), rather than failing. The structural fix is the Phase 4
> browser extension, which sees the rendered page.
>
> A grant bug found while checking isolation is also fixed: `0001` granted the
> app tables to `authenticated` but never revoked Postgres's default grant from
> `anon`, so the "two independent locks" claim was one lock. `0003` closes it.
>
> For the current build state see [`ARCHITECTURE.md`](../ARCHITECTURE.md); this
> file is the original phased plan and its rationale. The "greenfield / no
> commits" note below reflects the repo when the plan was written.

## Context

Greenfield repo (`/Users/akhilgogineni/Documents/fitr`, empty, no commits). A two-sided
personal app:

- **Wardrobe** — digitize a ~150–300 item closet as background-removed cutouts, build
  layered outfits on a canvas, allow outfits to contain *gaps* (pieces not yet owned).
- **Shopping** — capture inspiration from TikTok/Instagram/web, find similar buyable
  pieces from **brands not already in rotation**, check whether a candidate purchase
  actually works with the existing wardrobe, and alert on price drops.

### Requirements established in interview

| Constraint | Decision |
|---|---|
| Budget | As close to $0/month as possible. Free tiers only. |
| Users | Single user now; others later → RLS from day one, no rewrite. |
| Capture | iPhone share sheet + desktop browser extension → one endpoint. |
| Composing | **Laptop-primary.** Phone is capture + daily suggestion, not composition. |
| Retention hooks | **"What do I wear today"** and **the shopping inbox**. |
| Outfit visual | Flat-lay collage canvas. Silhouette/try-on later. |
| Gap representation | Structured slot (category + attributes), optionally filled by a wishlist item. |
| Closet scope | Outfit-relevant only — tops, bottoms, outerwear, shoes, accessories. No sleepwear, underwear, or gym. |
| Intake | ~50% bought online → **URL import is a co-primary path with the camera**. |
| Sizing | Store sizes on a profile for reference. No fit intelligence. |
| Price range | Per-category ceilings, not one global number. |
| Match quality | "Similar piece" is a win; exact match is a bonus. |
| Timeline | 2–4 weeks, Claude implementing. |
| Prior art disliked | Phia — results clouded by sponsorships. **Unbiased ranking is a requirement.** |

### Four findings that shaped this plan

1. **Background removal is free and local.** RMBG-1.4 runs client-side via
   `@huggingface/transformers` on WebGPU (WASM fallback). No server, no per-image cost,
   photos never leave the device. The hardest-sounding requirement is the cheapest one.

2. **Unbiased discovery is achievable at $0.** Gemini 3.x free tier includes **5,000
   Google-Search-grounded prompts/month** (~165/day). Organic web results, not an
   affiliate feed — so it surfaces small labels and has *no commission incentive to
   reorder results*. That is the structural fix for the Phia complaint. Alternatives were
   checked and rejected: Brave killed its free tier in early 2026; Google Custom Search
   JSON API is closed to new customers and shuts down 2027-01-01.

3. **URL import can halve the onboarding cliff.** For anything bought online the
   retailer's product photo is already shot on white and effectively pre-cut, and the
   same page yields brand, material, and original price. Paste a URL → item in seconds.
   Covers roughly half the closet with no photography.

4. **The daily suggestion writes the wear log for free.** A one-tap *"wore it"* on the
   daily suggestion produces wear history as a byproduct of a feature already wanted —
   no separate diary habit. This dissolves the cold-start problem for the taste model:
   the data accumulates from week one without any discipline required.

### Known risk (accepted, mitigated)

Photographing the non-online half of the closet is still hours of unglamorous work and is
the most likely reason this project dies. **Phase 1 exits at ~30 items, not 300.** The
full intake is only justified after a week of real use proves the flow.

---

## Stack (all free tier)

| Concern | Choice | Free allowance |
|---|---|---|
| App | Next.js (App Router) + TypeScript + Tailwind | — |
| Hosting | Vercel Hobby | free |
| DB / Auth | Supabase Postgres + Auth + RLS + `pgvector` | 500MB DB, 50k MAU |
| Image storage | **Cloudflare R2** | 10GB, **$0 egress** |
| Background removal | `@huggingface/transformers` RMBG-1.4, client-side WebGPU | free, local |
| Similarity embeddings | CLIP/SigLIP client-side → `pgvector` | free, local |
| Garment tagging | Gemini 3 Flash (vision) | ~1,000 req/day |
| Product discovery | Gemini 3 Flash + Google Search grounding | 5,000 grounded/mo |
| Weather | Open-Meteo | free, **no API key** |
| Price monitoring | GitHub Actions daily cron + JSON-LD parse | 2,000 min/mo |
| Notifications | Web Push (VAPID) | free |

**Deliberate choices:**

- **Images on R2, not Supabase Storage.** 250 items × (original + cutout) ≈ 300–600MB
  would consume most of Supabase's 1GB. R2's 10GB with zero egress removes the ceiling.
- **Supabase free pauses after 7 days idle** — the daily price cron keeps it warm as a
  side effect. No action needed.
- **Price via JSON-LD, not scraping.** Nearly all retailers publish `Product`/`Offer`
  structured data. A plain `fetch` + parse reads the price with no headless browser and
  no anti-bot fight. Retailers omitting it are marked `unwatchable` rather than starting
  a scraping arms race.
- **Embeddings computed client-side**, keeping "similar items" off the metered API path.
- **Tagging behind a provider-agnostic interface**, so swapping Gemini's free tier for a
  paid key later is a one-line change.

---

## Data model

```
profiles              -- sizes, home location (weather), per-category price ceilings
  user_id, sizes jsonb, location, price_ceilings jsonb

items                 -- the wardrobe
  id, user_id, category, subcategory, colors[], pattern, material, brand,
  formality(1-5), seasons[], image_original_key, image_cutout_key,
  embedding vector(512), source_url, purchase_price_cents, acquired_at, archived_at

outfits
  id, user_id, name, occasion, season, canvas jsonb, created_at

outfit_slots          -- one row per layer; the gap mechanic lives here
  id, outfit_id, layer,           -- top|bottom|outerwear|shoes|accessory
  item_id      NULL,              -- owned piece, OR
  wish_item_id NULL,              -- saved wishlist piece, OR
  gap_spec     jsonb NULL,        -- {category, color, material, formality} = unfilled
  transform    jsonb              -- {x, y, scale, rotation, z}

wears                 -- written by the daily suggestion's one-tap confirm
  id, user_id, item_id, outfit_id NULL, worn_on

captures              -- inbox from share sheet / extension
  id, user_id, source, source_url, image_key, note, status, created_at

wish_items
  id, user_id, from_capture_id, title, description, target_price_cents,
  priority, embedding vector(512)

product_matches
  id, wish_item_id, url, retailer, title, price_cents, currency,
  image_url, in_stock, score, found_at

price_observations    -- append-only; powers drop detection
  id, product_match_id, price_cents, in_stock, observed_at
```

`outfit_slots` is the hinge of the app: a slot holding a `gap_spec` *is* a shopping need,
and filling it with a `wish_item_id` is how the shopping half feeds the wardrobe half.
Building outfits generates the shopping list as a byproduct.

---

## Design direction

Left to me, so: **gallery-leaning for the wardrobe and outfit views** — off-white ground,
generous whitespace, small restrained type, clothes supplying all the color. **Utility-
dense for bulk import and triage** — compact grids, keyboard shortcuts, built for
processing 300 items rather than admiring them. Two registers, one type scale.

One concrete trap to handle early: transparent cutouts of *white* garments vanish against
an off-white ground. Items get a subtle card treatment with a soft shadow so light pieces
stay legible, and cutouts are checked against both light and dark backgrounds.

---

## Phases

Each phase ends in something usable. The two retention hooks land in Phases 3 and 4 —
early, not last.

### Phase 0 — Skeleton (days 1–2)
Next.js + Tailwind scaffold, Supabase project, schema + RLS, R2 bucket with signed-upload
route, Vercel deploy, auth.
**Exit:** log in on phone and laptop, see an empty wardrobe.

### Phase 1 — Wardrobe intake (days 3–6)
Two paths into `items`:
- **URL import (lead path):** paste a product URL → fetch `og:image` + JSON-LD → brand,
  material, price, clean image. Accepts a pasted list for bulk.
- **Camera:** batch upload → client-side background removal (WebGPU, WASM fallback,
  progress UI) → Gemini auto-tag → correct tags in a review grid, not one form at a time.

**Exit:** ~30 real garments in the app. *Then a week of real use before completing intake.*

> **Photography spec** (my call, since you delegated it): garment on a hanger against a
> blank wall, phone at chest height, same spot and same daylight each time, one item per
> frame. Flat-lay on a plain sheet for knitwear, shoes, and accessories, which hang badly.
> Batches of 20. Consistency matters far more than quality — the model wants clean edges,
> not good photography.

### Phase 2 — Outfit builder (days 7–10)
Laptop-first drag/resize/layer canvas over cutouts, z-ordering by garment layer,
structured gap slots with an attribute picker, save/duplicate. Phone view is read-only.
**Exit:** 5 real outfits saved, at least one containing a gap.

### Phase 3 — Daily: "what do I wear today" (days 11–13) — *hook #1*
Phone-first single screen. Inputs: wardrobe + Open-Meteo forecast + a one-tap occasion
picker (work / going out / casual). Suggests a saved outfit or composes one from items,
avoiding recent repeats. One-tap **"wore it"** writes to `wears`.
Rules-and-weather driven first; the accumulating wear log is what makes the later taste
model actually good.
**Exit:** used for 5 consecutive mornings and the suggestions aren't embarrassing.

### Phase 4 — Capture inbox (days 14–16) — *hook #2*
`POST /api/capture` + iOS Shortcut on the share sheet + MV3 browser extension. Triage a
capture into a wishlist item or straight into an outfit's gap slot.
**Exit:** save a piece from TikTok on the phone in under 5 seconds.

### Phase 5 — Discovery (days 17–21)
Gemini vision describes the captured garment → grounded Google search → candidate product
links, deduped, ranked, filtered by that category's price ceiling and **down-ranked for
brands already in the wardrobe** (the "find me something new" requirement made explicit
in the ranking function). "Does this fit my closet?" runs the candidate's embedding
against `items` and auto-generates 2–3 outfits from real pieces — **and says plainly when
it can't**, which is the anti-waste feature.
**Exit:** save a TikTok fit, get 5 buyable candidates from unfamiliar brands, see it
styled against pieces already owned.

### Phase 6 — Price watch (days 22–24)
Daily GitHub Actions cron over watched `product_matches`, JSON-LD price parse, append to
`price_observations`, web push on a drop past threshold. (iOS push requires the PWA
installed to the home screen — one-time setup, documented in the README.)
**Exit:** a real price-drop notification lands on the phone.

### Explicitly out of scope for these 4 weeks
Taste model trained on wear history, cost-per-wear analytics, silhouette layout mode, AI
try-on rendering, calendar integration, packing/trip planning, multi-user launch.

---

## Working agreement

You want to review, adjust, *and* understand. Concretely:

- Conventional, boring Next.js structure. No clever abstractions, no bespoke framework.
- Each phase opens with a short written explanation of its architecture decisions, before
  the code.
- Non-obvious choices (ML pipeline, JSON-LD extraction, RLS policies) get comments
  explaining *why*, not *what*.
- One PR-sized commit per phase, reviewable in a sitting.
- `ARCHITECTURE.md` maintained alongside the code as the map.

---

## Verification

- **Phase 0:** deploy reachable; a second seeded user cannot read the first user's rows.
  RLS proven, not assumed — this is what makes multi-user later a config change.
- **Phase 1:** items round-trip via *both* paths. Cutouts checked for true transparency
  against light and dark grounds (a common failure is an opaque white matte that only
  shows up on dark). Time 5 URL imports vs 5 photographs to confirm which path actually
  wins before committing to the full intake.
- **Phase 2:** outfit saves, reloads with identical layout, z-order survives refresh.
- **Phase 3:** five consecutive mornings of real use. Track how often the suggestion is
  accepted vs overridden — under ~40% acceptance means the rules need work before any
  taste model would help.
- **Phase 4:** iOS Shortcut and extension both produce a `captures` row with image + URL.
- **Phase 5:** run 10 real saved captures through discovery and manually score how many
  return a plausible, in-stock, buyable piece. **Under 5/10, stop and re-scope the
  shopping half rather than polishing it.** Web-wide product matching for free is the
  genuinely uncertain part of this build — better to learn that in week 3 than week 8.
- **Phase 6:** seed an inflated `price_observations` row, run the cron, confirm the push
  arrives on the phone.

Browser work verified live via the Browser tools. WebGPU background removal needs
real-device checking — Safari's WebGPU differs from Chrome's, and the phone is a primary
target.

---

## Open items (not blocking)

1. **Home location** for weather — needed at Phase 3, one profile field.
2. **Per-category price ceilings** — needed at Phase 5; I'll seed defaults and you adjust.
3. **iOS Shortcut distribution** — needs a signed iCloud link; setup docs to follow.
4. **Gemini free-tier data use** — accepted for now; provider-agnostic interface keeps the
   switch to a paid key cheap.
5. **Domain** — Vercel subdomain to start.
