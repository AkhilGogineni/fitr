import "server-only";

import dns from "node:dns/promises";
import net from "node:net";

/**
 * Fetching a URL the user pasted, without turning this server into a proxy for
 * things it shouldn't reach.
 *
 * URL import means the server fetches an arbitrary address chosen by whoever is
 * signed in. Even in a single-user app that is a server-side request forgery
 * primitive: `http://169.254.169.254/` is the cloud metadata endpoint,
 * `http://localhost:54321` is the local Supabase instance during development.
 * So every hop is resolved and checked against private address space before a
 * single byte is requested.
 *
 * Redirects are followed by hand rather than by `fetch`, because a public URL
 * that 302s to `127.0.0.1` would sail straight past a check done only on the
 * URL originally typed.
 *
 * The residual risk is a DNS entry that changes between the check and the
 * connection. Closing that properly means pinning the resolved IP into the
 * connection, which Node's fetch doesn't expose — noted rather than hidden, and
 * well past the threat model of a personal wardrobe app.
 */

const MAX_REDIRECTS = 3;
const DEFAULT_TIMEOUT_MS = 10_000;

/**
 * Retailers routinely return 403 to anything that looks automated. Presenting a
 * normal browser request is the difference between JSON-LD and an error page;
 * it is not an attempt to defeat a bot wall, and a site that blocks us anyway
 * is simply reported as unreadable rather than fought.
 *
 * Calibrated 2026-11-18 against 22 product URLs from a `discovery:probe` run
 * (11 Shopify stores, 11 chains/others: Uniqlo, J.Crew, Gap, Puma, A&F,
 * L.L.Bean, Huckberry, Gola, Keds, Quince, Charles Tyrwhitt), every URL
 * fetched with five header sets, 1.5s apart, in two passes:
 *
 *   - Chrome/124 UA + bare accept (the old value): 17 and 14 of 22 answered 200
 *   - no UA (undici's default):                    16 and 17
 *   - Chrome/142 UA + bare accept:                 16 and 17
 *   - Chrome/142 UA + full navigation headers:     18 and 18  <- this
 *   - an honest bot UA:                            15 and 16
 *
 * The navigation set was never worse on any URL, and turned golausa.com's
 * 403 into a 200 in both passes. Huckberry 403s every variant; the 404s were
 * the model's invented URLs and 404'd identically under all five.
 *
 * Not one 429 appeared — not paced, and not in bursts of 4 and 8 concurrent
 * requests over the Shopify stores (33 and 55 requests per variant). So the
 * 429s seen in an earlier probe run were not reproducible as a header effect;
 * the single Retry-After retry in `safeFetch` is for those, if they recur.
 *
 * The `sec-fetch-*` set describes a top-level navigation, so it is only sent
 * when the caller asked for HTML; image fetches send the UA and their own
 * `accept` alone.
 */
const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36";

const DOCUMENT_HEADERS: Record<string, string> = {
  accept:
    "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
  "upgrade-insecure-requests": "1",
  "sec-fetch-dest": "document",
  "sec-fetch-mode": "navigate",
  "sec-fetch-site": "none",
  "sec-fetch-user": "?1",
};

function requestHeaders(accept: string): Record<string, string> {
  const base = { accept, "user-agent": USER_AGENT, "accept-language": "en-US,en;q=0.9" };
  return accept.includes("text/html") ? { ...base, ...DOCUMENT_HEADERS } : base;
}

/**
 * One retry on 429, waiting what `Retry-After` asks, capped — and only if the
 * wait still fits inside the caller's timeout. A store that wants longer than
 * this is reported as `http_429`, not waited out.
 */
const MAX_RETRY_AFTER_MS = 3_000;

function retryAfterMs(header: string | null): number {
  if (!header) return 1_000;
  const seconds = Number(header);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1_000);
  const date = Date.parse(header);
  return Number.isFinite(date) ? Math.max(0, date - Date.now()) : 1_000;
}

/**
 * What kind of refusal it was, as a value rather than a sentence. The message
 * is for people; this is for code that has to count failures — discovery
 * reports why each candidate it dropped was dropped, and "the message said
 * 'took too long'" is not something to branch on.
 */
export type FetchRejectedCode =
  | "bad_url"
  | "protocol"
  | "dns"
  | "private_address"
  | "timeout"
  | "unreachable"
  | "redirect"
  | "http"
  | "too_large"
  | "empty"
  | "rejected";

export class FetchRejected extends Error {
  readonly status: number;
  readonly code: FetchRejectedCode;
  /** The status the remote server actually answered with, when it answered. */
  readonly upstreamStatus: number | null;
  constructor(
    message: string,
    status = 422,
    code: FetchRejectedCode = "rejected",
    upstreamStatus: number | null = null,
  ) {
    super(message);
    this.name = "FetchRejected";
    this.status = status;
    this.code = code;
    this.upstreamStatus = upstreamStatus;
  }
}

function isPrivateAddress(address: string) {
  const version = net.isIP(address);

  if (version === 4) {
    const [a, b] = address.split(".").map(Number);
    return (
      a === 0 || // "this network"
      a === 10 || // private
      a === 127 || // loopback
      (a === 169 && b === 254) || // link-local, incl. cloud metadata
      (a === 172 && b >= 16 && b <= 31) || // private
      (a === 192 && b === 168) || // private
      (a === 100 && b >= 64 && b <= 127) || // carrier-grade NAT
      a >= 224 // multicast and reserved
    );
  }

  if (version === 6) {
    const normalised = address.toLowerCase();
    if (normalised === "::1" || normalised === "::") return true;
    // Unique-local (fc00::/7) and link-local (fe80::/10).
    if (/^f[cd]/.test(normalised) || /^fe[89ab]/.test(normalised)) return true;
    // IPv4-mapped addresses smuggle the v4 ranges through, e.g. ::ffff:127.0.0.1
    const mapped = normalised.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped) return isPrivateAddress(mapped[1]);
    return false;
  }

  return true; // Not an IP literal at all — refuse rather than guess.
}

async function assertPublicUrl(url: URL) {
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new FetchRejected(`Only http and https links can be imported.`, 422, "protocol");
  }

  const addresses = await dns.lookup(url.hostname, { all: true }).catch(() => {
    throw new FetchRejected(`Couldn't resolve ${url.hostname}.`, 422, "dns");
  });

  if (addresses.length === 0 || addresses.some((a) => isPrivateAddress(a.address))) {
    throw new FetchRejected(`${url.hostname} resolves to a private address.`, 400, "private_address");
  }
}

/** Reads a response body, refusing to buffer more than `maxBytes`. */
async function readCapped(response: Response, maxBytes: number) {
  const declared = Number(response.headers.get("content-length") ?? 0);
  if (declared > maxBytes) {
    throw new FetchRejected(
      `That file is ${(declared / 1e6).toFixed(1)}MB — the limit is ${(maxBytes / 1e6).toFixed(0)}MB.`,
      422,
      "too_large",
    );
  }

  const reader = response.body?.getReader();
  if (!reader) throw new FetchRejected("Empty response.", 422, "empty");

  const chunks: Uint8Array[] = [];
  let total = 0;

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      throw new FetchRejected(
        `That file is over the ${(maxBytes / 1e6).toFixed(0)}MB limit.`,
        422,
        "too_large",
      );
    }
    chunks.push(value);
  }

  const body = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body;
}

export type SafeFetchResult = {
  body: Uint8Array;
  contentType: string;
  /** The address actually fetched, after redirects — used to resolve relative URLs. */
  finalUrl: string;
};

export async function safeFetch(
  rawUrl: string,
  { accept, maxBytes, timeoutMs = DEFAULT_TIMEOUT_MS }: {
    accept: string;
    maxBytes: number;
    timeoutMs?: number;
  },
): Promise<SafeFetchResult> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new FetchRejected(`"${rawUrl.slice(0, 80)}" isn't a URL.`, 400, "bad_url");
  }

  const controller = new AbortController();
  const deadline = Date.now() + timeoutMs;
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  let retried429 = false;

  try {
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      await assertPublicUrl(url);

      const response = await fetch(url, {
        redirect: "manual",
        signal: controller.signal,
        headers: requestHeaders(accept),
      }).catch((error: unknown) => {
        if (error instanceof Error && error.name === "AbortError") {
          throw new FetchRejected(`${url.hostname} took too long to respond.`, 504, "timeout");
        }
        throw new FetchRejected(`Couldn't reach ${url.hostname}.`, 502, "unreachable");
      });

      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get("location");
        if (!location) throw new FetchRejected("Redirect with no destination.", 422, "redirect");
        await response.body?.cancel();
        url = new URL(location, url); // Loop re-checks the new host.
        continue;
      }

      if (response.status === 429 && !retried429) {
        const wait = retryAfterMs(response.headers.get("retry-after"));
        // Leave at least a second of the budget for the retry itself.
        if (wait <= MAX_RETRY_AFTER_MS && Date.now() + wait + 1_000 < deadline) {
          retried429 = true;
          await response.body?.cancel();
          await new Promise((resolve) => setTimeout(resolve, wait));
          hop--; // Same URL again; not a redirect hop.
          continue;
        }
      }

      if (!response.ok) {
        throw new FetchRejected(
          `${url.hostname} answered ${response.status}.`,
          response.status === 404 ? 404 : 502,
          "http",
          response.status,
        );
      }

      return {
        body: await readCapped(response, maxBytes),
        contentType: response.headers.get("content-type") ?? "",
        finalUrl: url.href,
      };
    }

    throw new FetchRejected("Too many redirects.", 422, "redirect");
  } finally {
    clearTimeout(timeout);
  }
}
