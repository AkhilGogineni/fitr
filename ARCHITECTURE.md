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
    (app)/                   Signed-in shell — nav, auth gate
      wardrobe/              Gallery of cutouts
        actions.ts           Server Actions: create, correct, confirm, archive
        add/                 Intake — URL import + camera, cutting, review grid
      outfits/               Phase 2
      today/                 Phase 3
      inbox/                 Phase 4
    login/                   Email + password auth
    api/
      uploads/sign/          Presigned R2 PUT URLs
      import/url/            Reads a product page, returns its metadata
      import/image/          Relays a product photo (CORS, not convenience)
      tag/                   Vision auto-tagging, key stays server-side
  components/
    icons.tsx                The six glyphs this app uses, drawn here
  lib/
    env.ts                   Env access that fails loudly and early
    garments.ts              Shared vocabulary: categories, seasons, tag coercion
    items.ts                 Row type + the literal select column list
    r2.ts                    R2 client, key naming, presigning (server-only)
    intake/
      background-removal.ts  RMBG-1.4 in the browser (client-only)
      product-page.ts        JSON-LD + OpenGraph extraction
      safe-fetch.ts          SSRF-guarded outbound fetch (server-only)
      tagging.ts             Provider-agnostic tagger, Gemini behind it
      upload.ts              Browser → R2 via presigned PUT
    supabase/
      client.ts              Browser client
      server.ts              Server client + getUser()
      proxy.ts               Session refresh used by src/proxy.ts
supabase/migrations/         SQL, applied by hand via the SQL editor
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

**API routes answer 401 rather than redirecting.** The proxy sends signed-out
page requests to `/login`, but anything under `/api` gets JSON instead: a fetch
that follows a redirect to an HTML login page reports a parse error, not an
expired session.

**The cookie dance in `lib/supabase/proxy.ts` is load-bearing.** Refreshed tokens
must be written to both the request and the response. Dropping either produces
intermittent logouts that are miserable to track down.

## Status

- **Phase 0 — complete.** Scaffold, schema + RLS, auth, R2 uploads, app shell.
- **Phase 1 — built, awaiting real use.** URL import, camera intake, in-browser
  background removal, auto-tagging, review grid. The exit condition is ~30 real
  garments in the app and a timed comparison of the two paths — that is a
  wardrobe-in-front-of-you job, not a code one.
- Phase 2 — outfit canvas with gap slots.
- Phase 3 — "what do I wear today" + wear logging.
- Phase 4 — capture inbox (iOS Shortcut + browser extension).
- Phase 5 — discovery.
- Phase 6 — price watch + push.
