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
 * normal browser UA is the difference between JSON-LD and an error page; it is
 * not an attempt to defeat a bot wall, and a site that blocks us anyway is
 * simply reported as unreadable rather than fought.
 */
const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

export class FetchRejected extends Error {
  readonly status: number;
  constructor(message: string, status = 422) {
    super(message);
    this.name = "FetchRejected";
    this.status = status;
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
    throw new FetchRejected(`Only http and https links can be imported.`);
  }

  const addresses = await dns.lookup(url.hostname, { all: true }).catch(() => {
    throw new FetchRejected(`Couldn't resolve ${url.hostname}.`);
  });

  if (addresses.length === 0 || addresses.some((a) => isPrivateAddress(a.address))) {
    throw new FetchRejected(`${url.hostname} resolves to a private address.`, 400);
  }
}

/** Reads a response body, refusing to buffer more than `maxBytes`. */
async function readCapped(response: Response, maxBytes: number) {
  const declared = Number(response.headers.get("content-length") ?? 0);
  if (declared > maxBytes) {
    throw new FetchRejected(
      `That file is ${(declared / 1e6).toFixed(1)}MB — the limit is ${(maxBytes / 1e6).toFixed(0)}MB.`,
    );
  }

  const reader = response.body?.getReader();
  if (!reader) throw new FetchRejected("Empty response.");

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
    throw new FetchRejected(`"${rawUrl.slice(0, 80)}" isn't a URL.`, 400);
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      await assertPublicUrl(url);

      const response = await fetch(url, {
        redirect: "manual",
        signal: controller.signal,
        headers: {
          accept,
          "user-agent": USER_AGENT,
          "accept-language": "en-US,en;q=0.9",
        },
      }).catch((error: unknown) => {
        if (error instanceof Error && error.name === "AbortError") {
          throw new FetchRejected(`${url.hostname} took too long to respond.`, 504);
        }
        throw new FetchRejected(`Couldn't reach ${url.hostname}.`, 502);
      });

      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get("location");
        if (!location) throw new FetchRejected("Redirect with no destination.");
        await response.body?.cancel();
        url = new URL(location, url); // Loop re-checks the new host.
        continue;
      }

      if (!response.ok) {
        throw new FetchRejected(
          `${url.hostname} answered ${response.status}.`,
          response.status === 404 ? 404 : 502,
        );
      }

      return {
        body: await readCapped(response, maxBytes),
        contentType: response.headers.get("content-type") ?? "",
        finalUrl: url.href,
      };
    }

    throw new FetchRejected("Too many redirects.");
  } finally {
    clearTimeout(timeout);
  }
}
