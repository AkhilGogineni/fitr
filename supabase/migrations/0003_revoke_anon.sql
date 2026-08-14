-- Close the anon grant.
--
-- 0001 granted the app tables to `authenticated` and said nothing about `anon`,
-- on the assumption that saying nothing was the same as granting nothing. It
-- isn't: `anon` keeps a default SELECT grant, so a query with only the anon key
-- returns `200 []` rather than the permission error SETUP.md claims.
--
-- No rows ever leaked — every policy in 0001 is `to authenticated`, so an anon
-- caller matches no policy and RLS returns nothing. But that leaves one lock
-- doing the work of two. The point of the grant layer is that it fails closed
-- independently of RLS: if a future migration adds a table and forgets a policy,
-- or a policy is written wrong, the grant is what still refuses. A layer that
-- silently isn't there is worse than no layer, because the docs promise it.
--
-- Safe to run more than once — `revoke` on a privilege that isn't held is a
-- no-op, not an error.

revoke all on
  profiles,
  items,
  captures,
  wish_items,
  outfits,
  outfit_slots,
  wears,
  product_matches,
  price_observations
from anon;

revoke all on sequence price_observations_id_seq from anon;

-- Future tables in this schema should not re-acquire it either.
alter default privileges in schema public revoke all on tables from anon;
alter default privileges in schema public revoke all on sequences from anon;
