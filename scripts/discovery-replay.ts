/**
 * Re-run discovery's verification over the URLs a probe run proposed, without
 * spending any grounded-search prompts.
 *
 *     npm run discovery:replay -- <probe-output.txt> [lanes|pool4]
 *
 * Reads a saved `npm run discovery:probe` output, takes every KEPT and DROP
 * URL under each brief, and verifies them again for that brief:
 *
 *   - `lanes` (default) — the real `verifyProposals`, i.e. today's scheduling
 *     (one lane per host, one serial lane for Shopify-shaped URLs);
 *   - `pool4` — the scheduling it replaced (any 4 at once, no per-host limit),
 *     fetch only, to count how many 429s that pattern draws.
 *
 * It exists to measure rate limiting: run one mode, let the IP cool down, run
 * the other, and compare `http_429` + `rate_limited`. Same server-only shim as
 * the probe, for the same reason.
 */
import fs from "node:fs";
import Module from "node:module";
import path from "node:path";

import type { SearchBrief } from "@/lib/discovery/search";

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
  (Module as unknown as { _initPaths: () => void })._initPaths();
}

function parseProbe(file: string): { brief: SearchBrief; urls: string[] }[] {
  const out: { brief: SearchBrief; urls: string[] }[] = [];
  for (const line of fs.readFileSync(file, "utf8").split("\n")) {
    const header = line.match(/^\[\d+\] (.+?) \((\w+), ceiling \$([\d.]+)\)/);
    if (header) {
      out.push({
        brief: {
          title: header[1],
          category: header[2],
          ceilingCents: Math.round(Number(header[3]) * 100),
          familiarBrands: [],
        },
        urls: [],
      });
      continue;
    }
    const url = line.match(/^\s+(?:KEPT|DROP)\s.*?(https?:\/\/\S+)\s*$/);
    if (url && out.length > 0) out[out.length - 1].urls.push(url[1]);
  }
  return out.filter((entry) => entry.urls.length > 0);
}

async function main() {
  installServerOnlyShim();
  const { verifyProposals } = await import("@/lib/discovery/search");
  const { safeFetch, FetchRejected } = await import("@/lib/intake/safe-fetch");

  const [file, mode = "lanes"] = process.argv.slice(2);
  if (!file || !["lanes", "pool4"].includes(mode)) {
    console.error("usage: discovery-replay <probe-output.txt> [lanes|pool4]");
    process.exitCode = 1;
    return;
  }

  const reasons = new Map<string, number>();
  const count = (reason: string) => reasons.set(reason, (reasons.get(reason) ?? 0) + 1);
  let total = 0;

  for (const [index, { brief, urls }] of parseProbe(file).entries()) {
    const start = Date.now();
    total += urls.length;
    if (mode === "lanes") {
      const { candidates, dropped } = await verifyProposals(urls, brief);
      for (let i = 0; i < candidates.length; i++) count("kept");
      for (const d of dropped) count(d.reason);
      console.log(
        `[${index + 1}] ${brief.title}: ${urls.length} urls, kept ${candidates.length}, ` +
          `${Date.now() - start}ms | ${dropped.map((d) => d.reason).join(" ")}`,
      );
    } else {
      const statuses: string[] = [];
      let next = 0;
      const worker = async () => {
        while (next < urls.length) {
          const url = urls[next++];
          try {
            await safeFetch(url, { accept: "text/html,application/xhtml+xml", maxBytes: 3_000_000, timeoutMs: 8_000 });
            statuses.push("200");
          } catch (error) {
            const status =
              error instanceof FetchRejected ? (error.upstreamStatus ? `http_${error.upstreamStatus}` : error.code) : "error";
            statuses.push(status);
          }
        }
      };
      await Promise.all(Array.from({ length: Math.min(4, urls.length) }, worker));
      for (const s of statuses) count(s);
      console.log(`[${index + 1}] ${brief.title}: ${urls.length} urls, ${Date.now() - start}ms | ${statuses.join(" ")}`);
    }
  }

  console.log(`\nmode ${mode} | urls ${total}`);
  console.log([...reasons.entries()].sort((a, b) => b[1] - a[1]).map(([r, n]) => `${r} ${n}`).join(", "));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
