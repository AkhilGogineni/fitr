# Architecture

The map of the codebase, and why things are the way they are. Kept current as
phases land. Full phased plan and rationale live in [`docs/PLAN.md`](docs/PLAN.md);
this is the working reference.

## What this is

A personal wardrobe + shopping app. Two halves that feed each other:

- **Wardrobe** — garments as background-removed cutouts, composed into layered
  outfits on a canvas. An outfit may contain *gaps*: pieces not yet owned.
- **Shopping** — inspiration captured from TikTok/Instagram/web, matched to
  buyable pieces from brands not already in rotation, checked against the
  existing wardrobe, and watched for price drops.

`outfit_slots` is the hinge. A slot holds exactly one of: an owned item, a
wishlist item, or a `gap_spec`. A slot holding a `gap_spec` *is* a shopping
need — so building outfits generates the shopping list as a byproduct, and
buying something fills an outfit that already exists.

## Stack, and why each piece

| Concern | Choice | Reason |
|---|---|---|
| Framework | Next.js 16 (App Router) | React plus a server. The server is non-negotiable: the capture endpoint needs a URL to POST to, JSON-LD price fetching is CORS-blocked in-browser, and the Gemini key can't ship to the client. |
| DB / auth | Supabase (Postgres, RLS, `pgvector`) | Free tier covers this comfortably, and RLS gives real per-user isolation from day one. |
| Images | Cloudflare R2 | 10GB free with zero egress, versus Supabase Storage's 1GB. A 250-item closet is 300–600MB. |
| Background removal | `@huggingface/transformers` in-browser | Free, private, no per-image cost. The hardest-sounding requirement is the cheapest. |
| Embeddings | CLIP client-side → `pgvector` | Keeps similarity search off any metered API. |
| Tagging | Gemini 3 Flash | ~1,000 free requests/day, behind a provider-agnostic interface. |
| Discovery | Gemini + Google Search grounding | 5,000 free grounded prompts/month, and organic results rather than an affiliate feed — no commission incentive to reorder what you see. |
| Price watch | GitHub Actions cron + JSON-LD | Retailers publish `Product`/`Offer` structured data; reading it needs no headless browser and starts no anti-bot fight. |

## Layout

```
src/
  proxy.ts                   Session refresh + optimistic auth redirect
  app/
    manifest.ts              PWA manifest — exists so iOS will deliver a push
    (app)/                   Signed-in shell — nav, auth gate
      today/                 The daily suggestion, phone-first
        actions.ts           Server Actions: wore it, something else, undo
      wardrobe/              Gallery of cutouts
        actions.ts           Server Actions: create, correct, confirm, archive
        add/                 Intake — URL import + camera, cutting, review grid
      outfits/               Flat-lay canvas; [id]/ is the editor
        actions.ts           Server Actions: slots, transforms, duplicate, delete
      inbox/                 Shopping inbox — captures, and the wants they become
        actions.ts           Server Actions: capture, triage, want edits, fill a gap
        want/[id]/           One want: discovery results + the closet check
      watch/                 Watched prices and their history
      settings/              Location, spend ceilings, capture token, push
    login/                   Email + password auth
    api/
      uploads/sign/          Presigned R2 PUT URLs
      import/url/            Reads a product page, returns its metadata
      import/image/          Relays a product photo (CORS, not convenience)
      tag/                   Vision auto-tagging, key stays server-side
      capture/               Share sheet + extension. Bearer token, not a session
      push/subscribe/        Registers and forgets a device for Web Push
      cron/prices/           The daily price check. Shared secret, not a session
  components/
    icons.tsx                The glyphs this app uses, drawn here
    outfit-preview.tsx       Read-only canvas renderer, shared by list/phone/today
  lib/
    env.ts                   Env access that fails loudly and early
    garments.ts              Shared vocabulary: categories, seasons, tag coercion
    items.ts                 Row type + the literal select column list
    outfits.ts               Slot types, canvas coordinate space, layer defaults
    captures.ts              Capture, wish-item and product-match row types
    profile.ts               Profile row, price ceilings, capture-token minting
    weather.ts               Open-Meteo forecast + geocoding (no API key)
    push.ts                  Web Push send, and what to do with a dead endpoint
    r2.ts                    R2 client, key naming, presigning (server-only)
    styling/
      rulebook.ts            What this app believes about clothes. Data, not logic
      score.ts               Evaluates the rulebook against one candidate outfit
      compose.ts             Narrows the wardrobe, then builds the shortlist
      pick.ts                The model picks one and writes the sentence
      daily.ts               Assembles the daily screen (server-only)
    discovery/
      search.ts              Grounded search, then verifies every URL it returns
      rank.ts                Dedupe, price ceiling, brand down-rank
      fit.ts                 "Does this work with what I own?", including "no"
    intake/
      background-removal.ts  RMBG-1.4 in the browser (client-only)
      product-page.ts        JSON-LD + OpenGraph extraction
      safe-fetch.ts          SSRF-guarded outbound fetch (server-only)
      tagging.ts             Provider-agnostic tagger, Gemini behind it
      upload.ts              Browser → R2 via presigned PUT
    supabase/
      client.ts              Browser client
      server.ts              Server client + getUser()
      admin.ts               Service-role client — RLS bypassed, two callers only
      proxy.ts               Session refresh used by src/proxy.ts
public/sw.js                 Service worker. Receives pushes; caches nothing
extension/                   MV3 browser extension, loaded unpacked
scripts/styling-preview.ts   `npm run styling` — watch the rules decide, no DB
supabase/migrations/         SQL, applied by hand via the SQL editor
.github/workflows/prices.yml Daily cron; one authenticated request, no logic
```

## The intake pipeline

Both ways into the wardrobe converge on the same four steps, in the browser:

```
 paste a URL                     take a photo
      │                               │
 /api/import/url  (JSON-LD)           │
      │                               │
 /api/import/image (CORS relay)       │
      └───────────────┬───────────────┘
                      ▼
        RMBG-1.4 cutout, on this machine
                      ▼
   presigned PUT → R2     +     /api/tag → vision model
                      ▼
          INSERT items (needs_review = true)
                      ▼
              review grid corrects it
```

A retailer's photo is cut too, not stored as-is. It arrives on white, and white
is not transparent: dropped onto the Phase 2 collage it would be a garment
inside a white rectangle. One pipeline, one kind of artefact.

Cutting is serialised; uploading and tagging are not. Inference saturates the
GPU, so two garments at once is slower than one after another — but uploads and
the tagging call are network-bound and overlap with the next garment's cut.

## Things that will trip you up

**It's `proxy.ts`, not `middleware.ts`.** Next.js 16 renamed Middleware to Proxy.
Same behaviour, new filename, and it lives next to `app/`.

**`cookies()` is async.** `const cookieStore = await cookies()`.

**Auth is checked twice, deliberately.** The proxy does an optimistic
cookie-based redirect; the `(app)` layout re-checks with `getUser()`. The proxy
runs on prefetches and can't be trusted as the only gate, and neither is the
real boundary — RLS in Postgres is.

**Never `getSession()` on the server.** It trusts whatever the cookie claims.
`getUser()` revalidates against Supabase. `lib/supabase/server.ts` exports
`getUser()` so there's a right thing to reach for.

**Queries don't filter by `user_id`.** That's intentional — RLS does it. If a
query ever returns another user's rows, the policy is wrong, and that's a bug
worth finding rather than papering over with a `.eq()`.

**New tables need a `grant`, not just a policy.** Grants and RLS are separate
layers: grants decide whether a role may touch a table at all, RLS decides which
rows. Supabase stopped auto-exposing public tables to the Data API in May 2026,
so a new table with perfect policies and no grant fails with an opaque
permission error. See the grants block at the foot of the migration.

**Cutouts are transparent, so white garments vanish.** Items always sit on a
`--surface` card with a hairline border, never directly on `--paper`. Check new
image UI against both light and dark themes. Intake has a ground toggle
(Paper / Dark / Grid) for exactly this: a cutout with an opaque white matte
instead of real transparency looks perfect on paper and shows up immediately on
the checker.

**RMBG-1.4 will not load through the `background-removal` pipeline.** Its config
declares `SegformerForSemanticSegmentation`, which the pipeline's model registry
rejects. `lib/intake/background-removal.ts` loads it with `AutoModel` and
`model_type: "custom"` instead, supplying the processor config by hand because
the model ships no `preprocessor_config.json`. The pipeline API works with
`Xenova/modnet`, but that is a portrait matting model and a coat on a hanger is
not a portrait.

**`supabase-js` types a query from the literal select string.** Build that string
by concatenation and the row type collapses to `GenericStringError`, which
surfaces as a wall of "property does not exist" errors nowhere near the cause.
`lib/items.ts` holds one literal, imported everywhere.

**A `"use server"` file may only export async functions.** Types are fine (they
erase), but a shared constant in `actions.ts` is a build error — which is the
other reason `lib/items.ts` exists.

**Outfit placement is fractional, never pixels.** `transform` stores `x`/`y` as
the piece's centre as a fraction of the canvas and `scale` as its width as a
fraction of canvas width. One renderer then draws the same composition in a
180px thumbnail, in the editor, and on a phone — and Phase 3 gets it for free.
Storing pixels would pin an outfit to whatever window it was built in.

**A retailer page with no image is not a failed import.** Most large chains
render product data in the browser, so a server fetch sees a shell. The route
answers 200 with `reason: "no-image" | "no-markup"` and whatever it did read; the
intake card then asks for a paste rather than erroring. Only unreachable hosts
and non-URLs are 4xx.

**API routes answer 401 rather than redirecting.** The proxy sends signed-out
page requests to `/login`, but anything under `/api` gets JSON instead: a fetch
that follows a redirect to an HTML login page reports a parse error, not an
expired session.

**The cookie dance in `lib/supabase/proxy.ts` is load-bearing.** Refreshed tokens
must be written to both the request and the response. Dropping either produces
intermittent logouts that are miserable to track down.

**Two routes authenticate themselves, and the proxy checks them first.**
`/api/capture` and `/api/cron` are listed in `SELF_AUTHENTICATING` and returned
from the proxy before anything else runs. Their callers — an iOS Shortcut and a
scheduled job — have no cookie, so the blanket "no session under `/api/` means
401" rule below would reject every request they exist to serve, before the
handler that knows how to check a token ever ran. If a capture starts answering
401 with a token you know is good, check that ordering first.

**`lib/supabase/admin.ts` bypasses RLS, so its safety lives in its callers.**
Everywhere else, "queries don't filter by `user_id`" is safe because the client
*can't* see other rows. This client can see everything. The two routes using it
derive `user_id` from something they verified — a token looked up in `profiles`,
or the row already being updated — and never from the request body. Reaching for
it because a query is inconvenient is how the guarantee stops being one.

**Weather rules read `apparent_temperature`, not `temperature_2m`.** Open-Meteo
has already folded wind and humidity into it, so a separate wind adjustment
would count the same effect twice. The forecast is also reduced over 07:00–21:00
rather than the calendar day, because a 24-hour minimum is usually 4am and
nobody dresses for 4am.

**The rulebook's numbers are calibration, not measurement.** No styling source
gives a hue-distance cutoff or a lightness delta — that writing is qualitative.
"Analogous" became ≤40°, "flat tonal" became <0.12 apart. Weights track how much
the sources agreed: unanimous rules (belt matches shoes, two patterns is the
cap) are large, contested ones (black with navy, denim at work) are ±1 on
purpose. Run `npm run styling` to see the effect of changing any of them without
a deploy or a database.

**An absent tag never penalises an outfit.** Half this wardrobe arrives from
product pages that state no material, and an item with no formality is unrated
rather than badly rated. Rules that can't be evaluated score zero. Adding a rule
that treats null as a bad value would quietly sink every under-tagged garment to
the bottom of every ranking.

**The scorer needs to know what the wardrobe *has*.** `ScoreContext.available`
is why: without it, a closet with no socks catalogued gets "nothing on the socks
front" on every candidate — a constant offset that changes no ranking and puts a
complaint on every explanation about something unfixable from that screen. This
was a real bug, found by `npm run styling`.

**Discovery verifies before it stores.** Never trust a URL a model returned.
`lib/discovery/search.ts` fetches each one and reads it with the same JSON-LD
parser as URL import: dead links are dropped, the price comes from the page, and
a page with no structured price is kept but flagged `unwatchable` so the cron
skips it rather than starting a scraping arms race.

**The brand down-rank is a deliberate bias, written down.** `lib/discovery/rank.ts`
ranks familiar brands down on purpose — "find me something new" is the actual
request. The difference from an affiliate feed isn't neutrality; it's that this
bias is twenty readable lines, serves the person searching, and has no field a
retailer could pay to influence.

**Push is never load-bearing.** Every function in `lib/push.ts` treats "not
configured" as an ordinary state and returns. The cron records every observation
and flags every drop whether or not a single subscription exists — `/watch` is
the primary surface, and the notification is a convenience on top. On iOS it
only works from a home-screen install, which no amount of code can change.

## How a morning's suggestion gets made

```
  first visit of the day for this occasion
                 │
   profile ──────┼────── Open-Meteo (keyless, cached 30 min)
   items ────────┤       reduced over 07:00–21:00 on apparent temp
   wears (21d) ──┤
   saved outfits ┘
                 ▼
       narrow each category by cheap per-item signals
       (season, formality, worn yesterday, fabric vs °C)
                 ▼
       enumerate, drop anything disqualified, score the rest
       (rulebook.ts → score.ts)          hard constraints reject;
                 ▼                        everything else adjusts
             shortlist of ~10
                 ▼
       Gemini picks one and writes the sentence
       (falls back to shortlist[0] on any failure at all)
                 ▼
       INSERT suggestions  ← every refresh after this reads it back
                 ▼
       "Wore it" → INSERT wears     "Something else" → mark overridden
```

Two properties this shape buys, both deliberate:

**A page load never composes.** Composing on every render would spend a model
call each time, make the morning's answer flicker between refreshes, and — the
real reason — make the acceptance rate meaningless, because the thing being
accepted would keep changing while you looked at it.

**The model cannot invent a garment.** It returns an index into a list the
engine built. The worst outcome of a bad model day is the second-best wearable
outfit, never a coat with shorts, never something in the wash.

## The shopping half

```
  share sheet / extension / paste
                 ▼
      POST /api/capture  (bearer token → user_id, service role)
                 ▼
            captures  ──── triage ────▶  wish_items
                                            │
                        ┌───────────────────┴─────────────────┐
                        ▼                                     ▼
          grounded search → verify every URL          assess against `items`
          → rank (brand down-rank)                    → works / thin / no
                        ▼
                 product_matches ── watch ──▶ daily cron
                                                  ▼
                                        price_observations
                                                  ▼
                                       /watch  +  optional push
```

**Every discovered URL is fetched before it is stored.** A grounded model still
invents plausible product links, and a shopping list of 404s is worse than an
empty one. Verification also means the price comes from the page rather than
from the model's memory, and that a match is known-readable by the time the
cron inherits it.

## Status

- **Phase 0 — complete.** Scaffold, schema + RLS, auth, R2 uploads, app shell.
- **Phase 1 — built, awaiting real use.** URL import, camera intake, in-browser
  background removal, auto-tagging, review grid. The exit condition is ~30 real
  garments in the app and a timed comparison of the two paths — that is a
  wardrobe-in-front-of-you job, not a code one.
- **Phase 2 — built, awaiting real use.** Flat-lay canvas with drag, resize,
  rotate, restack and gap slots; duplicate and delete; read-only on a phone. Exit
  condition is five real outfits, one containing a gap.
- **Phase 3 — built, awaiting real use.** Daily screen, Open-Meteo forecast,
  occasion picker, rules engine plus model pick, one-tap wear logging, and a
  `suggestions` table recording what was offered so acceptance is measurable.
  Exit condition is five consecutive mornings and an acceptance rate over ~40%.
- **Phase 4 — built, awaiting real use.** `/api/capture` on a bearer token, the
  iOS Shortcut recipe, the MV3 extension, and inbox triage into wants.
- **Phase 5 — built, awaiting real use.** Grounded search with URL verification,
  ranking with the brand down-rank, and the attribute-based closet check that is
  willing to say no. Exit condition is 10 real captures scored by hand — under
  5/10 plausible means re-scope the shopping half rather than polish it.
- **Phase 6 — built, awaiting real use.** Daily cron, JSON-LD price parse,
  append-only observations, `/watch` with price history, opt-in Web Push.

Everything from Phase 3 on is code-complete and unexercised against real data.
The remaining work is all of the kind only a wardrobe and a week can do.

**Not built, and deliberately.** CLIP embeddings — the `embedding` column and
its HNSW index exist and stay empty. At this closet size an attribute match is
both more accurate and explicable, and the explanation is most of the value
because the answer is meant to change a purchase. `lib/discovery/fit.ts` is
where a second opinion would be added if the wardrobe ever outgrows tags.
