-- Phase 1: wardrobe intake
--
-- Intake writes an `items` row the moment a cutout finishes uploading, rather
-- than staging a whole batch in the browser and saving at the end. Photographing
-- 20 garments is 10+ minutes of work and a refresh mid-batch would otherwise
-- throw away every cutout already computed.
--
-- The cost of saving early is that a row exists before anyone has checked what
-- the auto-tagger guessed. `needs_review` makes that state explicit instead of
-- letting half-verified rows blend into the wardrobe silently: intake sets it
-- true, the review grid clears it.

alter table items
  add column needs_review boolean not null default false;

comment on column items.needs_review is
  'True from the moment intake saves the row until its auto-tags are confirmed.';

-- Partial index: the review queue is normally empty, and this only carries rows
-- that are actually waiting.
create index items_needs_review_idx on items (user_id, created_at desc)
  where needs_review;

-- No new grant is needed. Grants are per-table, not per-column, and `items` was
-- already granted to `authenticated` in 0001 — a new column inherits that.
