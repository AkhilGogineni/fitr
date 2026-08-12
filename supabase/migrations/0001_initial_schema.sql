-- fitr initial schema
--
-- Design notes worth knowing before reading:
--
-- 1. Every table is scoped by user_id with RLS enabled and FORCED. Even though
--    this starts as a single-user app, isolation is enforced by Postgres rather
--    than by application code, so opening it to more users later is a config
--    change and not an audit of every query.
--
-- 2. `outfit_slots` is the hinge between the wardrobe and shopping halves. A
--    slot points at exactly one of: an owned item, a wishlist item, or a
--    `gap_spec` describing something not yet owned. A slot holding a gap_spec
--    IS a shopping need, which is how building outfits generates the shopping
--    list as a byproduct.
--
-- 3. Images live in Cloudflare R2, not Postgres and not Supabase Storage. We
--    only ever store object keys here.

create extension if not exists vector with schema extensions;

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------

-- Closet scope is deliberately outfit-relevant only: no sleepwear, underwear,
-- or gym kit. `socks` is present for statement socks that genuinely change an
-- outfit; plain basics are not worth inventorying.
create type garment_layer as enum (
  'top',
  'bottom',
  'outerwear',
  'shoes',
  'socks',
  'accessory'
);

create type season as enum ('spring', 'summer', 'autumn', 'winter');

create type occasion as enum ('work', 'going_out', 'casual', 'formal');

create type capture_source as enum ('tiktok', 'instagram', 'web', 'photo', 'other');

create type capture_status as enum ('new', 'triaged', 'matched', 'dismissed');

-- ---------------------------------------------------------------------------
-- profiles
-- ---------------------------------------------------------------------------

create table profiles (
  user_id uuid primary key references auth.users (id) on delete cascade,
  display_name text,
  -- e.g. {"tops":"M","waist":32,"shoes":"US 10"} — reference only, no fit logic.
  sizes jsonb not null default '{}'::jsonb,
  -- Free-text place name resolved to coordinates for the Open-Meteo forecast.
  location_name text,
  location_lat double precision,
  location_lon double precision,
  -- Per-category spend ceilings in cents, e.g. {"shoes":30000,"top":8000}.
  -- Discovery ranks against these rather than one global number.
  price_ceilings jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- items — the wardrobe
-- ---------------------------------------------------------------------------

create table items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,

  category garment_layer not null,
  subcategory text,
  brand text,
  colors text[] not null default '{}',
  pattern text,
  material text,
  formality smallint check (formality between 1 and 5),
  seasons season[] not null default '{}',

  -- R2 object keys. `image_cutout_key` is the transparent PNG; the original is
  -- kept so a garment can be re-cut when the segmentation model improves.
  image_original_key text,
  image_cutout_key text not null,

  -- CLIP ViT-B/32 output. Computed client-side, so similarity search costs
  -- nothing at the API tier. Changing models means changing this dimension.
  embedding extensions.vector(512),

  -- Set when the item came in via URL import rather than the camera.
  source_url text,
  purchase_price_cents integer,
  acquired_at date,
  archived_at timestamptz,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index items_user_category_idx on items (user_id, category) where archived_at is null;
create index items_user_created_idx on items (user_id, created_at desc);
-- HNSW rather than IVFFlat: it needs no training pass, which matters when the
-- table starts at 30 rows.
create index items_embedding_idx on items using hnsw (embedding extensions.vector_cosine_ops);

-- ---------------------------------------------------------------------------
-- captures — the shopping inbox
-- ---------------------------------------------------------------------------

create table captures (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  source capture_source not null default 'other',
  source_url text,
  image_key text,
  note text,
  status capture_status not null default 'new',
  created_at timestamptz not null default now()
);

create index captures_user_status_idx on captures (user_id, status, created_at desc);

-- ---------------------------------------------------------------------------
-- wish_items — triaged captures that became a want
-- ---------------------------------------------------------------------------

create table wish_items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  from_capture_id uuid references captures (id) on delete set null,

  title text not null,
  description text,
  category garment_layer,
  target_price_cents integer,
  priority smallint not null default 3 check (priority between 1 and 5),
  image_key text,
  embedding extensions.vector(512),
  fulfilled_at timestamptz,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index wish_items_user_priority_idx on wish_items (user_id, priority desc, created_at desc)
  where fulfilled_at is null;
create index wish_items_embedding_idx on wish_items using hnsw (embedding extensions.vector_cosine_ops);

-- ---------------------------------------------------------------------------
-- outfits
-- ---------------------------------------------------------------------------

create table outfits (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  name text,
  occasion occasion,
  seasons season[] not null default '{}',
  -- Canvas-level state (zoom, background); per-item placement lives on the slot.
  canvas jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index outfits_user_created_idx on outfits (user_id, created_at desc);

create table outfit_slots (
  id uuid primary key default gen_random_uuid(),
  outfit_id uuid not null references outfits (id) on delete cascade,
  layer garment_layer not null,

  item_id uuid references items (id) on delete set null,
  wish_item_id uuid references wish_items (id) on delete set null,
  -- {category, color, material, formality} — an unfilled slot, i.e. a want.
  gap_spec jsonb,

  -- {x, y, scale, rotation, z}
  transform jsonb not null default '{}'::jsonb,

  created_at timestamptz not null default now(),

  -- A slot is exactly one of: owned item, wishlist item, or an unfilled gap.
  -- Enforced here because a slot that is two of those has no sane rendering.
  constraint outfit_slot_single_occupant check (
    (item_id is not null)::int
    + (wish_item_id is not null)::int
    + (gap_spec is not null)::int
    = 1
  )
);

create index outfit_slots_outfit_idx on outfit_slots (outfit_id);
create index outfit_slots_item_idx on outfit_slots (item_id) where item_id is not null;
-- Powers "which outfits are waiting on a purchase?"
create index outfit_slots_gap_idx on outfit_slots (outfit_id) where gap_spec is not null;

-- ---------------------------------------------------------------------------
-- wears — written by the daily suggestion's one-tap confirm
-- ---------------------------------------------------------------------------

create table wears (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  item_id uuid not null references items (id) on delete cascade,
  outfit_id uuid references outfits (id) on delete set null,
  worn_on date not null default current_date,
  created_at timestamptz not null default now(),

  -- Confirming the same item twice in a day is a double-tap, not two wears.
  unique (item_id, worn_on)
);

create index wears_user_date_idx on wears (user_id, worn_on desc);

-- ---------------------------------------------------------------------------
-- product_matches + price_observations
-- ---------------------------------------------------------------------------

create table product_matches (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  wish_item_id uuid not null references wish_items (id) on delete cascade,

  url text not null,
  retailer text,
  brand text,
  title text,
  image_url text,
  price_cents integer,
  currency text not null default 'USD',
  in_stock boolean,

  -- 0..1 relevance from the discovery ranker.
  score real,
  -- Set true when the retailer page exposes no JSON-LD Product/Offer data, so
  -- the price cron skips it instead of starting a scraping arms race.
  unwatchable boolean not null default false,
  watching boolean not null default false,

  found_at timestamptz not null default now(),
  last_checked_at timestamptz,

  unique (wish_item_id, url)
);

create index product_matches_wish_idx on product_matches (wish_item_id, score desc nulls last);
-- The cron's work queue.
create index product_matches_watch_idx on product_matches (last_checked_at nulls first)
  where watching and not unwatchable;

create table price_observations (
  id bigserial primary key,
  product_match_id uuid not null references product_matches (id) on delete cascade,
  price_cents integer,
  in_stock boolean,
  observed_at timestamptz not null default now()
);

create index price_observations_match_time_idx on price_observations (product_match_id, observed_at desc);

-- ---------------------------------------------------------------------------
-- updated_at maintenance
-- ---------------------------------------------------------------------------

create or replace function set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger profiles_updated_at before update on profiles
  for each row execute function set_updated_at();
create trigger items_updated_at before update on items
  for each row execute function set_updated_at();
create trigger wish_items_updated_at before update on wish_items
  for each row execute function set_updated_at();
create trigger outfits_updated_at before update on outfits
  for each row execute function set_updated_at();

-- ---------------------------------------------------------------------------
-- Auto-create a profile row on signup
-- ---------------------------------------------------------------------------

create or replace function handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (user_id, display_name)
  values (new.id, new.raw_user_meta_data ->> 'full_name')
  on conflict (user_id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_user();

-- ---------------------------------------------------------------------------
-- Row Level Security
--
-- FORCE matters: without it the table owner bypasses RLS, which quietly
-- defeats the whole point when a migration or admin client touches the table.
-- ---------------------------------------------------------------------------

alter table profiles            enable row level security;
alter table items               enable row level security;
alter table captures            enable row level security;
alter table wish_items          enable row level security;
alter table outfits             enable row level security;
alter table outfit_slots        enable row level security;
alter table wears               enable row level security;
alter table product_matches     enable row level security;
alter table price_observations  enable row level security;

alter table profiles            force row level security;
alter table items               force row level security;
alter table captures            force row level security;
alter table wish_items          force row level security;
alter table outfits             force row level security;
alter table outfit_slots        force row level security;
alter table wears               force row level security;
alter table product_matches     force row level security;
alter table price_observations  force row level security;

-- Tables with a direct user_id: one policy covers all four verbs.
create policy profiles_owner on profiles
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create policy items_owner on items
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create policy captures_owner on captures
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create policy wish_items_owner on wish_items
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create policy outfits_owner on outfits
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create policy wears_owner on wears
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create policy product_matches_owner on product_matches
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

-- outfit_slots has no user_id of its own; ownership derives from the outfit.
create policy outfit_slots_owner on outfit_slots
  for all to authenticated
  using (
    exists (
      select 1 from outfits o
      where o.id = outfit_slots.outfit_id
        and o.user_id = (select auth.uid())
    )
  )
  with check (
    exists (
      select 1 from outfits o
      where o.id = outfit_slots.outfit_id
        and o.user_id = (select auth.uid())
    )
  );

-- price_observations likewise derives from its product_match.
create policy price_observations_owner on price_observations
  for all to authenticated
  using (
    exists (
      select 1 from product_matches pm
      where pm.id = price_observations.product_match_id
        and pm.user_id = (select auth.uid())
    )
  )
  with check (
    exists (
      select 1 from product_matches pm
      where pm.id = price_observations.product_match_id
        and pm.user_id = (select auth.uid())
    )
  );

-- ---------------------------------------------------------------------------
-- Data API grants
--
-- Grants are a SEPARATE layer from RLS, and both are required. RLS decides
-- which rows a role may see; grants decide whether the role may touch the
-- table at all.
--
-- Since Supabase's May 2026 change, new projects no longer auto-expose public
-- tables to PostgREST. Without these grants the app fails with an opaque
-- permission error even though every policy above is correct — so if the
-- wardrobe page ever reports a permissions problem on a brand new table, this
-- is the section that was forgotten.
--
-- `anon` is deliberately granted nothing. There is no anonymous read path in
-- this app; the capture endpoint authenticates before touching the database.
-- ---------------------------------------------------------------------------

grant usage on schema public to authenticated;

grant select, insert, update, delete on
  profiles,
  items,
  captures,
  wish_items,
  outfits,
  outfit_slots,
  wears,
  product_matches,
  price_observations
to authenticated;

-- price_observations.id is a bigserial, so inserts need the sequence too.
grant usage on sequence price_observations_id_seq to authenticated;
