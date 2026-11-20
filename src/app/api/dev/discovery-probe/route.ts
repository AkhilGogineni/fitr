import { createHash, timingSafeEqual } from "node:crypto";

import { BRIEFS, scores } from "@/lib/discovery/probe-briefs";
import { DiscoveryError, findProducts } from "@/lib/discovery/search";

/**
 * `npm run discovery:probe`, one brief per request, on a deployment.
 *
 * The discovery bar is measured from Vercel's network rather than a laptop's:
 * Shopify rate-limits per client IP across every store it hosts, and a
 * machine that has run a few probes is throttled for an hour (see
 * `SHOPIFY_GAP_MS` in lib/discovery/search.ts). This runs exactly what the
 * local probe runs — `findProducts` over the shared `BRIEFS`, scored by the
 * shared `scores` — and returns the outcome as JSON for
 * `npm run discovery:probe -- --remote <url>` to print.
 *
 * **Not a feature.** It spends a grounded-search prompt per call and fetches
 * ten retailer pages, so it is fenced three ways, and fails closed:
 *
 *   - absent in production (`VERCEL_ENV === "production"`) — 404;
 *   - absent unless `PROBE_SECRET` is configured — 404;
 *   - absent unless the caller presents it as a bearer token, compared in
 *     constant time — 404, not 401, so the route doesn't confirm it exists.
 *
 * No session and no database: nothing is read for or written to any user.
 * It is listed in the proxy's `SELF_AUTHENTICATING` so the blanket `/api/`
 * sign-in check doesn't answer for it.
 */

/**
 * Seconds. One brief: the grounded search is allowed up to 150s
 * (`GROUNDED_TIMEOUT_MS`; measured 30–60s per brief across the 2026-11-18/19
 * probe runs, 94s worst seen earlier), then verification up to its 40s budget
 * (`VERIFY_BUDGET_MS`). 200 covers both ceilings with ~10s to spare, and
 * matches what the want page already runs discovery under.
 */
export const maxDuration = 200;

function notFound() {
  return new Response("Not Found", { status: 404 });
}

/** Constant-time string compare; hashing first makes the lengths equal. */
function sameSecret(presented: string, expected: string) {
  const a = createHash("sha256").update(presented).digest();
  const b = createHash("sha256").update(expected).digest();
  return timingSafeEqual(a, b);
}

export async function GET(request: Request) {
  const secret = process.env.PROBE_SECRET;
  if (process.env.VERCEL_ENV === "production" || !secret) return notFound();

  const header = request.headers.get("authorization") ?? "";
  const presented = header.match(/^Bearer\s+(.+)$/i)?.[1]?.trim() ?? "";
  if (!presented || !sameSecret(presented, secret)) return notFound();

  const number = Number(new URL(request.url).searchParams.get("brief"));
  if (!Number.isInteger(number) || number < 1 || number > BRIEFS.length) {
    return Response.json(
      { error: `brief must be an integer from 1 to ${BRIEFS.length}` },
      { status: 400 },
    );
  }
  const brief = BRIEFS[number - 1];

  const start = Date.now();
  try {
    const outcome = await findProducts(brief);
    return Response.json(
      {
        brief: number,
        title: brief.title,
        elapsedMs: Date.now() - start,
        scored: outcome.candidates.some((c) => scores(brief, c)),
        outcome: {
          ...outcome,
          candidates: outcome.candidates.map((c) => ({ ...c, scores: scores(brief, c) })),
        },
      },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (error) {
    const status = error instanceof DiscoveryError ? error.status : 500;
    const message = error instanceof Error ? error.message : String(error);
    return Response.json(
      { brief: number, title: brief.title, elapsedMs: Date.now() - start, error: message },
      { status, headers: { "cache-control": "no-store" } },
    );
  }
}
