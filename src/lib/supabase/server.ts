import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

import { publicEnv } from "@/lib/env";

/**
 * Supabase client for Server Components, Server Actions, and Route Handlers.
 *
 * Note `await cookies()` — the cookie store is async as of Next 15+.
 *
 * Every query made through this client carries the user's JWT, so Postgres RLS
 * is what actually enforces data isolation. We never filter by `user_id` in
 * application code and hope for the best; the database refuses to return other
 * users' rows. That is what makes opening this up to more users later a config
 * change rather than an audit of every query.
 */
export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient(
    publicEnv.NEXT_PUBLIC_SUPABASE_URL,
    publicEnv.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            for (const { name, value, options } of cookiesToSet) {
              cookieStore.set(name, value, options);
            }
          } catch {
            // Server Components cannot set cookies. This is expected and safe:
            // the proxy refreshes the session on every request, so the tokens
            // stay current even though this particular write is a no-op.
          }
        },
      },
    },
  );
}

/**
 * Returns the signed-in user, or null.
 *
 * Always use this rather than `getSession()` on the server — `getUser()`
 * revalidates the token with Supabase, whereas `getSession()` trusts whatever
 * the cookie claims and can be spoofed.
 */
export async function getUser() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user;
}
