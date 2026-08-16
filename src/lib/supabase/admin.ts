import "server-only";

import { createClient as createSupabaseClient } from "@supabase/supabase-js";

import { publicEnv, serviceRoleKey } from "@/lib/env";

/**
 * A Supabase client that bypasses RLS.
 *
 * Two routes in this app have no signed-in user to act as, and nothing else
 * does:
 *
 *   - `POST /api/capture` — the caller is an iOS Shortcut or a browser
 *     extension presenting a bearer token. There is no cookie, so there is no
 *     session, so the anon client would be refused by every policy.
 *   - `POST /api/cron/prices` — runs from GitHub Actions on a schedule, on
 *     nobody's behalf, and has to walk rows belonging to a user who isn't
 *     there.
 *
 * Everywhere else, use `lib/supabase/server.ts`. Reaching for this because a
 * query is inconvenient is how the RLS guarantee stops being a guarantee: the
 * whole reason `ARCHITECTURE.md` can say "queries don't filter by user_id" is
 * that the client used for them cannot see other users' rows in the first
 * place. This one can see everything.
 *
 * So the safety property here is different, and it is a property of the two
 * call sites rather than of the database: both derive `user_id` from something
 * they verified — a capture token looked up in `profiles`, or the row already
 * being updated — and never from the request body.
 *
 * `persistSession: false` because there is no browser to persist into, and
 * leaving it on makes the client try to write to a storage that isn't there.
 */
export function createAdminClient() {
  return createSupabaseClient(
    publicEnv.NEXT_PUBLIC_SUPABASE_URL,
    serviceRoleKey(),
    {
      auth: { persistSession: false, autoRefreshToken: false },
    },
  );
}
