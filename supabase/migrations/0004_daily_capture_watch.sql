-- Phases 3–6: the daily suggestion, the capture inbox, discovery, price watch.
--
-- Most of what these phases need already exists. `0001` created `wears`,
-- `captures`, `wish_items`, `product_matches` and `price_observations` with
-- policies and grants, because the data model was designed once rather than
-- phase by phase. What follows is only the gap between that design and what
-- four phases of real screens turned out to want.
--
-- Four additions, each with a reason that isn't obvious from the column name:
--
--   1. `suggestions` — the daily pick is recorded before it's acted on. The
--      plan's exit criterion for Phase 3 is an *acceptance rate*, and you
--      cannot measure that from `wears` alone: `wears` records what was worn
--      and is silent about what was offered and turned down.
--
--   2. `profiles.capture_token` — an iOS Shortcut cannot hold a Supabase
--      session, so the share sheet needs a credential that isn't a cookie.
--
--   3. `push_subscriptions` — a browser's push endpoint is per-device, so this
--      is one row per device rather than a column on the profile.
--
--   4. Columns on `captures` — a capture arrives already knowing what the page
--      said. Throwing that away and re-fetching at triage time would make
--      triage slow for no gain.

-- ---------------------------------------------------------------------------
-- suggestions — what the daily screen offered, and what happened to it
-- ---------------------------------------------------------------------------

create type suggestion_outcome as enum ('pending', 'worn', 'overridden');

create table suggestions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,

  for_date date not null default current_date,
  occasion occasion not null default 'casual',

  -- Which attempt of the day this was. Asking again is the override signal, so
  -- "was rank 1 accepted?" is the number the plan actually wants — an average
  -- over every reshuffle would flatter a suggester that was wrong four times.
  rank smallint not null default 1,

  -- A saved outfit was chosen...
  outfit_id uuid references outfits (id) on delete set null,
  -- ...or pieces were composed. Either way the ids are recorded flat, so
  -- deleting an outfit later doesn't erase the record of it being suggested.
  item_ids uuid[] not null default '{}',

  reason text,
  -- 'rules' or 'gemini' — which engine made the final call. Kept because the
  -- interesting comparison is between them, and it is unrecoverable afterwards.
  picked_by text,
  -- The forecast the decision was made under. A suggestion that looks wrong in
  -- hindsight is usually a suggestion made under a forecast you've forgotten.
  weather jsonb not null default '{}'::jsonb,

  outcome suggestion_outcome not null default 'pending',
  created_at timestamptz not null default now()
);

create index suggestions_user_date_idx on suggestions (user_id, for_date desc, rank);
-- The acceptance metric reads only first attempts.
create index suggestions_accept_idx on suggestions (user_id, outcome) where rank = 1;

-- ---------------------------------------------------------------------------
-- profiles.capture_token — the share sheet's credential
-- ---------------------------------------------------------------------------

alter table profiles
  add column capture_token text unique,
  add column capture_token_created_at timestamptz;

comment on column profiles.capture_token is
  'Bearer token for POST /api/capture from the iOS Shortcut and the browser '
  'extension. Stored in the clear deliberately: it has to stay re-displayable, '
  'because it is pasted into two clients and re-pasted whenever either is set '
  'up again. It authorises exactly one thing — inserting a capture — and '
  'regenerating it in Settings invalidates the old one immediately.';

-- ---------------------------------------------------------------------------
-- push_subscriptions — one row per device, not per user
-- ---------------------------------------------------------------------------

create table push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,

  -- The Push API's endpoint URL is the subscription's identity, and it is
  -- unique across the whole web — so `unique` here, not `unique (user_id, ...)`.
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,

  user_agent text,
  created_at timestamptz not null default now(),
  -- The cron prunes a subscription the push service answers 404/410 for; this
  -- is how a stale one is spotted before that happens.
  last_success_at timestamptz
);

create index push_subscriptions_user_idx on push_subscriptions (user_id);

-- ---------------------------------------------------------------------------
-- captures — keep what the page already told us
-- ---------------------------------------------------------------------------

alter table captures
  add column title text,
  -- The remote image, before anything is mirrored into R2. A capture from a
  -- phone share sheet has a URL and no bytes; triage is where it becomes an
  -- `image_key`. Keeping both means the inbox can show a thumbnail immediately
  -- without a round trip through our own storage for something that may well
  -- be dismissed.
  add column image_url text,
  add column brand text,
  add column price_cents integer,
  add column currency text;

-- ---------------------------------------------------------------------------
-- wish_items / product_matches — discovery and price-watch bookkeeping
-- ---------------------------------------------------------------------------

alter table wish_items
  -- Grounded search is 5,000 prompts/month. Recording when discovery last ran
  -- is what stops a page refresh from spending one.
  add column last_discovery_at timestamptz,
  -- What discovery concluded about the closet, including "nothing here works
  -- with this" — which is the anti-waste answer and worth persisting, not
  -- recomputing.
  add column fit_note text;

alter table product_matches
  -- The price the last alert quoted. Without it a price that drops once
  -- produces an alert every day the cron runs, and an alert that repeats is an
  -- alert that gets muted.
  add column notified_price_cents integer;

-- ---------------------------------------------------------------------------
-- RLS and grants for the new tables
--
-- Both layers, as always. 0003's `alter default privileges ... revoke all
-- from anon` means these tables do not silently acquire an anon grant, so
-- nothing here needs to revoke one.
-- ---------------------------------------------------------------------------

alter table suggestions        enable row level security;
alter table push_subscriptions enable row level security;

alter table suggestions        force row level security;
alter table push_subscriptions force row level security;

create policy suggestions_owner on suggestions
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create policy push_subscriptions_owner on push_subscriptions
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

grant select, insert, update, delete on
  suggestions,
  push_subscriptions
to authenticated;

-- ---------------------------------------------------------------------------
-- service_role — the two paths with no signed-in user
--
-- Everything else in this app runs as `authenticated` with the user's JWT, and
-- RLS decides what it may see. Two paths cannot: the capture endpoint, whose
-- caller is an iOS Shortcut holding a bearer token rather than a session, and
-- the price cron, which runs from GitHub Actions on nobody's behalf. Both
-- resolve a user id themselves and then act as that user.
--
-- `service_role` carries BYPASSRLS, so these grants hand it real power and the
-- key must stay server-side — it is never `NEXT_PUBLIC_`. The safety property
-- is not RLS here; it is that both routes pin `user_id` from something they
-- verified (a token lookup, or the row they are already updating) and never
-- from the request body.
--
-- Granted explicitly rather than assumed: since Supabase's May 2026 change a
-- new table is not automatically reachable by any role, and a missing grant
-- surfaces as an opaque permission error rather than an obvious one.
-- ---------------------------------------------------------------------------

grant usage on schema public to service_role;

grant select, insert, update, delete on
  profiles,
  items,
  captures,
  wish_items,
  outfits,
  outfit_slots,
  wears,
  suggestions,
  product_matches,
  price_observations,
  push_subscriptions
to service_role;

grant usage on sequence price_observations_id_seq to service_role;
