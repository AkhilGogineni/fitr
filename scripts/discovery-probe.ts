/**
 * See discovery work, without a database or a login.
 *
 *     npm run discovery:probe
 *     npm run discovery:probe -- 3        # only the first three briefs
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

import type { SearchBrief, SearchOutcome } from "@/lib/discovery/search";

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

/** US shopper, US prices. Ceilings in cents, as `profiles.price_ceilings` stores them. */
const BRIEFS: SearchBrief[] = [
  {
    title: "Oversized cream cable-knit sweater",
    description: "chunky wool, crew neck",
    category: "top",
    ceilingCents: 12_000,
    familiarBrands: [],
  },
  {
    title: "Heavyweight plain white t-shirt",
    description: "boxy fit, thick cotton, no logo",
    category: "top",
    ceilingCents: 5_000,
    familiarBrands: ["uniqlo"],
  },
  {
    title: "Navy oxford cloth button-down shirt",
    description: "slim but not skinny, real button-down collar",
    category: "top",
    ceilingCents: 9_000,
    familiarBrands: [],
  },
  {
    title: "Straight-leg raw selvedge denim jeans",
    description: "dark indigo, mid rise",
    category: "bottom",
    ceilingCents: 20_000,
    familiarBrands: ["levi's"],
  },
  {
    title: "Olive pleated wide-leg chinos",
    description: "cotton twill, relaxed through the thigh",
    category: "bottom",
    ceilingCents: 11_000,
    familiarBrands: [],
  },
  {
    title: "White leather low-top sneakers",
    description: "minimal, no big branding",
    category: "shoes",
    ceilingCents: 15_000,
    familiarBrands: ["nike", "adidas"],
  },
  {
    title: "Brown suede chelsea boots",
    description: "pull-on, elastic side panels",
    category: "shoes",
    ceilingCents: 25_000,
    familiarBrands: [],
  },
  {
    title: "Waxed cotton field jacket",
    description: "olive or tan, corduroy collar",
    category: "outerwear",
    ceilingCents: 30_000,
    familiarBrands: [],
  },
  {
    title: "Black lightweight packable down jacket",
    description: "for layering, no hood",
    category: "outerwear",
    ceilingCents: 18_000,
    familiarBrands: ["patagonia"],
  },
  {
    title: "Merino wool beanie",
    description: "charcoal, ribbed, cuffed",
    category: "accessory",
    ceilingCents: 4_000,
    familiarBrands: [],
  },
];

/**
 * A kept result that a shopper could act on — "a plausible, in-stock, buyable
 * piece": a page that described itself as one product, with a price stated in
 * US dollars at or under the brief's ceiling, whose offers say in stock, and
 * whose own product name names the garment the brief asked for. Every clause
 * must be read off the page; "didn't say" never counts. A brief "scores" when
 * it yields at least one.
 */
const scores = (brief: SearchBrief, c: SearchOutcome["candidates"][number]) =>
  c.pageKind === "product" &&
  c.priceCents !== null &&
  c.currency === "USD" &&
  (!brief.ceilingCents || c.priceCents <= brief.ceilingCents) &&
  c.availability === "in_stock" &&
  c.relevance === "match";

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

async function main() {
  installServerOnlyShim();
  const { findProducts } = await import("@/lib/discovery/search");

  const limit = Number(process.argv[2]) || BRIEFS.length;
  const briefs = BRIEFS.slice(0, limit);

  const totals = { proposed: 0, kept: 0, priced: 0, failed: 0, scored: 0, ms: [] as number[] };
  const reasons = new Map<string, number>();
  const problems: string[] = [];

  // One at a time: the elapsed numbers are what this is for, and running the
  // briefs in parallel would make each one look slower than it is in the app.
  for (const [index, brief] of briefs.entries()) {
    const start = Date.now();
    try {
      const outcome = await findProducts(brief);
      const elapsed = Date.now() - start;
      totals.ms.push(elapsed);
      printOutcome(index, brief, elapsed, outcome);

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
    } catch (error) {
      const elapsed = Date.now() - start;
      totals.ms.push(elapsed);
      totals.failed += 1;
      console.log(`\n[${index + 1}] ${brief.title}`);
      console.log(`    FAILED after ${elapsed}ms: ${error instanceof Error ? error.message : String(error)}`);
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
