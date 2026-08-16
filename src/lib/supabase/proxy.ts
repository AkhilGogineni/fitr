import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

import { publicEnv } from "@/lib/env";

/** Pages reachable while signed out. Everything else redirects to /login. */
const PUBLIC_PREFIXES = ["/login", "/auth"];

/**
 * API routes that carry their own credential, and must be left alone.
 *
 * These are not holes in the auth model — they are the two callers that cannot
 * hold a cookie. `/api/capture` is an iOS Shortcut and a browser extension
 * presenting a bearer token minted in Settings; `/api/cron` is a scheduled job
 * presenting a shared secret. Each checks its credential as the first thing it
 * does, and each would be permanently unreachable if the blanket `/api/` rule
 * below saw it first — which is exactly the bug this list exists to prevent.
 */
const SELF_AUTHENTICATING = ["/api/capture", "/api/cron"];

function matches(pathname: string, prefixes: string[]) {
  return prefixes.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}

/**
 * Refreshes the Supabase session on every request and performs an optimistic
 * auth redirect.
 *
 * The cookie dance below looks redundant but isn't: refreshed tokens have to be
 * written onto BOTH the request (so the Server Component rendered downstream in
 * this same pass sees them) and the response (so the browser stores them). Skip
 * either and you get intermittent logouts that are miserable to debug.
 *
 * This is an optimistic check only. Real enforcement is RLS in Postgres — see
 * the note in `server.ts`.
 */
export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    publicEnv.NEXT_PUBLIC_SUPABASE_URL,
    publicEnv.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          for (const { name, value } of cookiesToSet) {
            request.cookies.set(name, value);
          }
          response = NextResponse.next({ request });
          for (const { name, value, options } of cookiesToSet) {
            response.cookies.set(name, value, options);
          }
        },
      },
    },
  );

  // Do not remove: this call is what actually refreshes an expiring token.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { pathname } = request.nextUrl;

  // Checked first, and the order is load-bearing: these routes authenticate
  // themselves, so the blanket `/api/` 401 below must never see them.
  if (matches(pathname, SELF_AUTHENTICATING)) return response;

  if (user && pathname === "/login") {
    const url = request.nextUrl.clone();
    url.pathname = "/today";
    url.search = "";
    return NextResponse.redirect(url);
  }

  // Every other API route answers for itself. Redirecting one to /login sends
  // an HTML page to a caller expecting JSON, so a session that expires mid
  // import surfaces as an unparseable response instead of "not signed in".
  // Each handler still checks `getUser()`, so nothing is loosened here.
  if (!user && pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

  if (!user && !matches(pathname, PUBLIC_PREFIXES)) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    // Preserve where they were headed so login can bounce them back.
    url.searchParams.set("next", pathname);
    return NextResponse.redirect(url);
  }

  return response;
}
