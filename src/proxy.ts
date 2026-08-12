import type { NextRequest } from "next/server";

import { updateSession } from "@/lib/supabase/proxy";

/**
 * Next.js 16 renamed Middleware to Proxy. Same behaviour, new filename —
 * `src/proxy.ts`, sitting alongside `app/`.
 */
export async function proxy(request: NextRequest) {
  return updateSession(request);
}

export const config = {
  /*
   * Run on everything except static assets and image files. Auth wants to run
   * broadly, but matching `_next/static` would refresh the session on every
   * chunk request for no benefit.
   */
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|avif|ico)$).*)",
  ],
};
