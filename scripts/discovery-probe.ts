/**
 * See discovery work, without a database or a login.
 *
 *     npm run discovery:probe
 *     npm run discovery:probe -- 3        # only the first three briefs
 *     npm run discovery:probe -- --remote https://<preview>.vercel.app [3]
 *
 * **Remote mode** runs each brief on a deployment instead of this machine —
 * one request per brief to `/api/dev/discovery-probe?brief=N`, sequentially,
 * with `Authorization: Bearer $PROBE_SECRET` (from `.env.local`). The fetches
 * then come from the deployment's network, which matters: Shopify rate-limits
 * per client IP across all its stores, and a laptop that has run a few probes
 * is throttled for an hour. Output and scoring are the same as local mode
 * (`probe-briefs.ts` holds both), plus the HTTP status per brief; a brief
 * whose request fails is reported as failed, never scored.
 *
 * Runs `findProducts` — the real grounded search plus the real verification
 * fetches — over a fixed set of realistic briefs, and prints for each one how
 * long it took, what survived, and why everything else was dropped. It spends
 * one grounded-search prompt per brief, so it is a bench, not a test suite.
 *
 * Reads GEMINI_API_KEY (and optionally GEMINI_MODEL) from `.env.local` via
 * `node --env-file`, which is how the npm script launches it.
 *
 * **Why the shim.** `search.ts` starts with `import "server-only"`, a marker
 * package Next aliases at build time (to `next/dist/compiled/server-only`) and
 * that is not installed under `node_modules/` on its own — so outside Next the
 * import doesn't resolve at all. Rather than remove a guard that keeps the
 * Gemini key out of client bundles, this script writes a no-op `server-only`
 * into a cache directory, points NODE_PATH at it, and only then loads
 * `search.ts`. The guard still fires in the app; it just has nothing to guard
 * against in a terminal.
 */
import fs from "node:fs";
import Module from "node:module";
import path from "node:path";

import { BRIEFS, scores } from "@/lib/discovery/probe-briefs";
import type { SearchBrief, SearchOutcome } from "@/lib/discovery/search";

/** The route's maxDuration (200s) plus room for the network either side. */
const REMOTE_TIMEOUT_MS = 230_000;

const SHIM_ROOT = path.resolve(__dirname, "../node_modules/.cache/discovery-probe");

function installServerOnlyShim() {
  const dir = path.join(SHIM_ROOT, "server-only");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, "package.json"),
    JSON.stringify({ name: "server-only", version: "0.0.0-probe", main: "index.js" }),
  );
  fs.writeFileSync(path.join(dir, "index.js"), "// no-op: see scripts/discovery-probe.ts\n");

  process.env.NODE_PATH = [SHIM_ROOT, process.env.NODE_PATH].filter(Boolean).join(path.delimiter);
  // NODE_PATH is read once at startup; this re-reads it. Undocumented but
  // long-stable, and only ever used here, in a dev script.
  (Module as unknown as { _initPaths: () => void })._initPaths();
}

const usd = (cents: number | null) => (cents === null ? "no price" : `$${(cents / 100).toFixed(2)}`);

function printOutcome(index: number, brief: SearchBrief, elapsedMs: number, outcome: SearchOutcome) {
  console.log(
    `\n[${index + 1}] ${brief.title} (${brief.category}, ceiling ${usd(brief.ceilingCents ?? null)})`,
  );
  console.log(
    `    elapsed ${elapsedMs}ms (search ${outcome.timings.searchMs}ms, verify ${outcome.timings.verifyMs}ms)` +
      ` | proposed ${outcome.proposed} | kept ${outcome.candidates.length} | dropped ${outcome.dropped.length}` +
      ` | scoring results ${outcome.candidates.filter((c) => scores(brief, c)).length}` +
      ` | scored ${outcome.candidates.some((c) => scores(brief, c)) ? "yes" : "no"}`,
  );
  for (const c of outcome.candidates) {
    const price =
      c.priceCents === null
        ? "no price"
        : c.currencyUnknown
          ? `${usd(c.priceCents)} (currency not stated)`
          : `${usd(c.priceCents)} ${c.currency}`;
    console.log(
      `    KEPT  ${c.title ?? "(untitled)"} | ${c.retailer} | ${price} | ${c.unwatchable ? "unwatchable" : "watchable"} | ${c.pageKind} | stock ${c.availability} | brief ${c.relevance} | ${scores(brief, c) ? "SCORES" : "-"} | ${c.url}`,
    );
  }
  for (const d of outcome.dropped) console.log(`    DROP  ${d.reason.padEnd(18)} ${d.url}`);
}

type BriefRun =
  | { ok: true; outcome: SearchOutcome; elapsedMs: number; note?: string }
  | { ok: false; elapsedMs: number; reason: string };

/** Local: `findProducts` in this process. */
async function runLocal(brief: SearchBrief): Promise<BriefRun> {
  const { findProducts } = await import("@/lib/discovery/search");
  const start = Date.now();
  try {
    const outcome = await findProducts(brief);
    return { ok: true, outcome, elapsedMs: Date.now() - start };
  } catch (error) {
    return { ok: false, elapsedMs: Date.now() - start, reason: error instanceof Error ? error.message : String(error) };
  }
}

/** Remote: one request to the deployment's probe route. */
async function runRemote(base: string, briefNumber: number): Promise<BriefRun> {
  const secret = process.env.PROBE_SECRET;
  if (!secret) throw new Error("--remote needs PROBE_SECRET in .env.local");
  const url = new URL(`/api/dev/discovery-probe?brief=${briefNumber}`, base);
  const start = Date.now();
  let response: Response;
  try {
    response = await fetch(url, {
      headers: { authorization: `Bearer ${secret}` },
      signal: AbortSignal.timeout(REMOTE_TIMEOUT_MS),
    });
  } catch (error) {
    const reason = error instanceof Error && error.name === "TimeoutError"
      ? `no response within ${REMOTE_TIMEOUT_MS}ms`
      : `request failed: ${error instanceof Error ? error.message : String(error)}`;
    return { ok: false, elapsedMs: Date.now() - start, reason };
  }
  const elapsedMs = Date.now() - start;
  const body = await response.text();
  if (!response.ok) {
    return { ok: false, elapsedMs, reason: `HTTP ${response.status}: ${body.slice(0, 200)}` };
  }
  try {
    const parsed = JSON.parse(body) as { outcome: SearchOutcome; elapsedMs: number };
    return {
      ok: true,
      outcome: parsed.outcome,
      elapsedMs,
      note: `HTTP ${response.status} | server elapsed ${parsed.elapsedMs}ms`,
    };
  } catch {
    return { ok: false, elapsedMs, reason: `HTTP ${response.status} but the body isn't JSON: ${body.slice(0, 200)}` };
  }
}

async function main() {
  const args = process.argv.slice(2);
  const remoteAt = args.indexOf("--remote");
  const remote = remoteAt === -1 ? null : args[remoteAt + 1];
  if (remoteAt !== -1 && !remote) throw new Error("usage: discovery:probe -- --remote <base-url> [count]");
  const rest = remoteAt === -1 ? args : args.filter((_, i) => i !== remoteAt && i !== remoteAt + 1);

  if (!remote) installServerOnlyShim();

  const limit = Number(rest[0]) || BRIEFS.length;
  const briefs = BRIEFS.slice(0, limit);
  if (remote) console.log(`remote: ${new URL(remote).origin}`);

  const totals = { proposed: 0, kept: 0, priced: 0, failed: 0, scored: 0, ms: [] as number[] };
  const reasons = new Map<string, number>();
  const problems: string[] = [];

  // One at a time: the elapsed numbers are what this is for, and running the
  // briefs in parallel would make each one look slower than it is in the app.
  for (const [index, brief] of briefs.entries()) {
    const run = remote ? await runRemote(remote, index + 1) : await runLocal(brief);
    totals.ms.push(run.elapsedMs);

    if (!run.ok) {
      totals.failed += 1;
      console.log(`\n[${index + 1}] ${brief.title}`);
      console.log(`    FAILED after ${run.elapsedMs}ms: ${run.reason}`);
      continue;
    }

    const { outcome } = run;
    printOutcome(index, brief, run.elapsedMs, outcome);
    if (run.note) console.log(`    ${run.note}`);

    totals.proposed += outcome.proposed;
    totals.kept += outcome.candidates.length;
    totals.priced += outcome.candidates.filter((c) => c.priceCents !== null).length;
    if (outcome.candidates.some((c) => scores(brief, c))) totals.scored += 1;
    for (const d of outcome.dropped) reasons.set(d.reason, (reasons.get(d.reason) ?? 0) + 1);

    // The two defects this probe was written to catch, checked rather than eyeballed.
    for (const c of outcome.candidates) {
      if (c.priceCents !== null && c.priceCents <= 0) problems.push(`[${index + 1}] priceCents ${c.priceCents}: ${c.url}`);
      if (c.currency !== null && c.currency !== "USD") problems.push(`[${index + 1}] currency ${c.currency}: ${c.url}`);
    }
  }

  const sorted = [...totals.ms].sort((a, b) => a - b);
  console.log("\n=== totals ===");
  console.log(`briefs ${briefs.length} | failed ${totals.failed} | scored ${totals.scored}/${briefs.length}`);
  console.log(
    `elapsed ms: min ${sorted[0]} | median ${sorted[Math.floor(sorted.length / 2)]} | max ${sorted[sorted.length - 1]}`,
  );
  console.log(`proposed ${totals.proposed} | kept ${totals.kept} (priced ${totals.priced}) | dropped ${totals.proposed - totals.kept}`);
  console.log(
    "drop reasons: " +
      ([...reasons.entries()].sort((a, b) => b[1] - a[1]).map(([r, n]) => `${r} ${n}`).join(", ") || "none"),
  );
  console.log(problems.length ? `PROBLEMS:\n  ${problems.join("\n  ")}` : "checks: no kept candidate priced <= 0, none in a non-USD currency");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
