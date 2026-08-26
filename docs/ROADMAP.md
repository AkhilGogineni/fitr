# fitr — roadmap, phases 7–10

> **Status: planning.** `docs/PLAN.md` is the original 4-week build and its
> rationale; every phase in it is code-complete. This file is what comes next,
> and it has a second goal the first plan didn't: the work has to be legible to
> someone reading the GitHub repo and the Vercel link without you in the room.
>
> That second goal changes *which* features get built, never whether they're
> real. Nothing here is a resume prop — each phase is something the app is
> actually missing, chosen from the set of missing things that also happen to be
> the interesting part to talk about.

## Where this picks up

Phases 0–6 shipped: intake (URL + camera, in-browser cutouts, auto-tagging),
the outfit canvas with gap slots, the daily suggestion, the capture inbox, the
grounded discovery pipeline, and the price cron. The wardrobe is loaded and the
app is in daily use.

Three things are conspicuously absent, and all three are the same absence:

1. **`items.embedding` is empty.** The column and its HNSW index have existed
   since `0001` and have never held a value. Phase 5 deliberately matched on
   attributes instead, and at 30 garments that was the right call — but it means
   "find me something like this" is currently a tag comparison, not a visual one.
2. **Discovery never looks at the product photo.** `lib/discovery/search.ts`
   fetches every candidate URL to verify it, reads its JSON-LD, and throws the
   `og:image` away. The ranking is text about a picture rather than the picture.
3. **The rulebook never learns.** `suggestions` has recorded every pick, its
   rank, and its outcome since `0004`. Nothing reads that table back. The
   weights in `rulebook.ts` are the same hand-calibrated numbers they were on
   day one, no matter how many times a suggestion got overridden.

Phases 7, 8 and 9 close those three, in that order, because each one depends on
the one before it. Phase 10 opens the door.

---

## Phase 7 — Visual memory (week 1)

**Fill the embedding column and make the wardrobe searchable by sight.**

Phase 5 wrote the revisit point into `lib/discovery/fit.ts` itself. This is it —
not because attribute matching stopped working, but because the closet outgrew
the size where it was obviously sufficient, and because everything in phases 8
and 9 needs a vector to exist first.

### Part 0 — fold-in
Whatever real use has surfaced goes at the front of this phase and ships in the
same pass. List the bugs before the phase opens.

### Build
- `lib/intake/embedding.ts` — SigLIP (or CLIP ViT-B/32, 512-dim to match the
  existing column) via `@huggingface/transformers`, in the browser, on the
  cutout rather than the original. Same WebGPU-with-WASM-fallback shape as
  `background-removal.ts`, and the same serialised-inference rule: the GPU is
  already saturated by one model, so embedding runs *after* the cut, not beside
  it.
- Intake writes `embedding` on insert — both paths, camera and URL.
- `scripts/backfill-embeddings.ts` — a page that walks existing items, pulls the
  cutout from R2, embeds, and patches. It has to run in the browser, because
  that's where the model is; a signed-in page with a progress bar, not a node
  script.
- `lib/items.ts` — a `findSimilar(itemId, limit)` using the HNSW index. Cosine,
  and *excluding* the item itself, which is the classic first bug.
- Wardrobe UI: "more like this" on an item, opening a row of nearest neighbours.

### Exit
Every non-archived item has an embedding, and the neighbours of five items you
pick by hand are ones you'd agree with. If they aren't, the model or the input
(cutout vs original, padding, background colour) is wrong — find that here,
before two more phases are built on top of it.

### What it earns
On-device inference and a vector index, both real: *"512-dim SigLIP embeddings
computed client-side on WebGPU, indexed with pgvector HNSW for sub-100ms
nearest-neighbour search over the wardrobe."*

---

## Phase 8 — Visual discovery (week 2)

**Rank web results by what the garment looks like, not by what a model said
about it.**

This is the feature you named: searching for similar pieces across the internet.
It exists today as grounded text search, which means the pipeline is
photo → Gemini's description → search words → candidate → *its* text. The
picture is dropped at step two and never picked up again.

### Build
- **Embed the capture.** The inspiration image already lands in R2 via
  `/api/capture`. Embed it at triage time, into `wish_items.embedding` — the
  column exists, also empty.
- **Embed the candidates.** `lib/discovery/search.ts` already fetches every
  returned URL to verify it. It reads JSON-LD there; have it keep the product
  image too, and embed it. This is the only new network cost in the phase, and
  it's a fetch you're already making.
- **Hybrid ranking** in `lib/discovery/rank.ts`: keep the price ceiling as a
  hard filter and keep the brand down-rank — that bias is the entire thesis of
  the shopping half and it stays — then re-rank the survivors by cosine
  similarity to the capture. Attributes decide *eligible*; the vector decides
  *closest*.
- **Say which signal fired.** A result shows "similar cut and colour" (vector)
  or "matches the collar and fabric you tagged" (attributes). The explanation is
  most of the value here, same as in `fit.ts` — the answer is meant to change a
  purchase.
- **`assessFit` gets a second opinion.** `lib/discovery/fit.ts` keeps its
  attribute verdict as the primary, and gains vector evidence for the "thin"
  case, where attributes are least certain.

### Exit
Run the ten real captures the Phase 5 exit criterion asked for, scored by hand,
twice — once with text-only ranking, once hybrid. The number that comes out is
the number you quote for the rest of this project's life, whichever way it goes.
Under 5/10 plausible on *both* still means re-scope the shopping half rather
than polish it; that criterion didn't expire.

### What it earns
A multimodal retrieval pipeline with a measured result: *"multimodal product
retrieval — grounded web search with per-URL verification, re-ranked by image
embedding similarity against the source photo; hand-scored A/B lifted plausible
results from N/10 to M/10."*

---

## Phase 9 — Styling that learns (week 3)

**Turn `suggestions` from a log into a training signal.**

Every morning since Phase 3 has written a row saying what was offered, at what
rank, and what happened to it. `wears` says what was actually worn. That is
implicit-feedback preference data about one specific person's taste, sitting
unread, and it is the most defensible ML in this project because it's data
nobody else has.

### Build
- **Make the score a feature vector.** `scoreOutfit` currently returns one
  number plus `praise`/`gripes`. Have it also return per-rule contributions —
  the rules already fire individually, so this is plumbing, not new logic. That
  vector is the model's input and stays human-readable, which is the point.
- **`lib/styling/learn.ts`** — fit per-user rule weights from accepted vs
  overridden suggestions. Logistic regression over ~20 features, closed-form
  ridge or a few hundred gradient steps; no new dependency, and small enough to
  read in one sitting.
- **Shrink toward the prior.** The learned weights blend with the hand-calibrated
  ones in proportion to how much data exists — ten mornings barely moves them,
  two hundred moves them a lot. This is the cold-start answer, it's the thing an
  interviewer will actually poke at, and it's about fifteen lines.
- **Retrain on a schedule, not on a page load.** The Phase 3 rule holds: a page
  load never composes and now never trains either. Fold it into the existing
  daily cron.
- **`npm run eval`** — extend `scripts/styling-preview.ts` into a replay
  harness. Walk the historical `suggestions` rows, re-rank each morning's
  shortlist under hand-tuned weights, learned weights, and random, and report
  where the outfit you actually wore landed. Mean reciprocal rank and top-1
  accept rate. This is what makes the phase's claim a measurement instead of a
  vibe, and it's the only thing in this plan that catches a regression.
- **`/today` cites it.** "You've turned this down three times in warm weather"
  is a sentence the hand-tuned rulebook can't produce.

### Exit
The eval harness prints learned-vs-hand-tuned over your real history, and the
learned weights win — or they don't, and you know by how much and why, which is
also a real answer. Either way the daily screen still falls back to the
hand-tuned prior on any failure, exactly as it falls back to `shortlist[0]`
today.

### What it earns
The bullet with the most substance in it: *"learned per-user outfit ranking from
implicit accept/override feedback — logistic model over interpretable rule
features, shrunk toward a hand-calibrated prior for cold start; offline replay
harness measured +X% top-1 acceptance over N days of real use."*

---

## Phase 10 — Open the door (week 4)

**Make it something a stranger can look at, and a second person can use.**

RLS has been enforced since `0001` and multi-user was designed in from day one —
`docs/PLAN.md` called it a config change, and this phase is where that claim
gets tested rather than asserted.

### Build
- **Signup and first run.** There's a login page; there's no signup, and no
  answer to "the wardrobe is empty and I have no idea what to do." A first-run
  path that gets someone to their first item.
- **A demo account.** Seeded with a plausible wardrobe and a few outfits,
  linked from the README, no signup required, and hard read-only — the seed
  script and a guard that rejects writes, not just a UI that hides buttons.
  Assume it will be found and poked at.
- **Quota partitioning.** Every Gemini call site (`intake/tagging.ts`,
  `styling/pick.ts`, `discovery/search.ts`) is currently spending one shared
  free tier. Per-user daily caps, and degrade to rules-only rather than erroring
  when the cap is hit — Phase 3 already proved the screen works without the
  model, so this is wiring an existing fallback to a new trigger.
- **README rewrite.** The problem in your own words, the demo link, an
  architecture diagram, a 60-second recording of the daily screen and the
  capture flow, and the two numbers from phases 8 and 9. This is the artefact
  most readers will actually consume — treat it as a deliverable, not a chore.

### Exit
Someone who has never seen the app opens the Vercel link, lands in the demo,
and understands what it is within a minute. A second real account can be created
and used without touching your data — verified the way `docs/PLAN.md` verified
Phase 0, by trying to read the other user's rows and failing.

### What it earns
*"Multi-tenant from day one on Postgres RLS with per-user quota partitioning and
graceful degradation to a rules-only path when the model budget is exhausted."*

---

## Backlog — named, not scheduled

Out of scope for this month, written down so they stop taking up room:

- **Cost-per-wear**, now that `wears` and `purchase_price_cents` both exist.
  Cheap to build, and the wear log is finally deep enough to make it interesting.
- **Silhouette / try-on rendering.** The layered canvas is the groundwork; this
  is a much larger piece of work than it looks.
- **Packing and trip planning** — the daily engine plus a date range and a
  destination forecast. Mostly a UI on top of what's already there.
- **Calendar integration** for the occasion picker.
- **Outfit history as a grid** — the wear log made visual.

## Two decisions to make during this month

1. **Gemini independence, per call site.** Phases 7 and 8 put a local image
   model in the browser, which quietly changes the shape of this: tagging
   (`intake/tagging.ts`) and the daily pick (`styling/pick.ts`) become
   substitutable with local inference, and discovery's grounded search does not,
   because live web search has no free local equivalent. Worth deciding
   deliberately after Phase 8 rather than drifting into it — the honest framing
   is two of three, not all or nothing.
2. **Commit cadence.** One reviewable commit per phase is already the working
   agreement in `docs/PLAN.md`. Worth keeping to it here specifically, since the
   history is part of what gets read.

## Working agreement — unchanged

Everything in `docs/PLAN.md` still holds: conventional Next.js, no clever
abstractions, each phase opens with its architecture decisions written down
before the code, non-obvious choices get a comment explaining *why*, and
`ARCHITECTURE.md` stays current as the map.

Two additions specific to this stretch:

- **No test suite**, by decision. The Phase 9 eval harness is the only
  regression net in the plan, which is worth knowing when changing
  `rulebook.ts` or `score.ts`.
- **Verification stays split** the way it always has: types, lint, build,
  parsers and the eval harness run from the terminal; anything needing a
  signed-in browser, a real device, a WebGPU check, or a judgement about whether
  a cutout looks right is yours.
