import "server-only";

/**
 * Reading a social post when the page itself won't talk.
 *
 * TikTok renders everything in the browser, so an HTML fetch returns a shell
 * with no JSON-LD and often no og:image — which is why a pasted TikTok used to
 * arrive as an untitled card with no picture. Its public oEmbed endpoint
 * answers instead: no auth, no key, and enough for a capture card (the
 * thumbnail, the caption as a title, the creator as a brand).
 *
 * Instagram's equivalent requires an app token, so it stays unanswered here; a
 * shared Instagram post degrades to a bare link, which the inbox already
 * handles. Product pages never reach this file — `product-page.ts` reads their
 * structured data directly, which is richer than anything oEmbed offers.
 */

export type OEmbedMetadata = {
  title: string | null;
  imageUrl: string | null;
  author: string | null;
};

/** TikTok's canonical share URLs are all on tiktok.com; short forms redirect there. */
const TIKTOK_PATTERN = /^https?:\/\/(?:www\.)?tiktok\.com\//i;

export async function fetchTikTokOEmbed(url: string): Promise<OEmbedMetadata | null> {
  if (!TIKTOK_PATTERN.test(url)) return null;

  const endpoint = `https://www.tiktok.com/oembed?url=${encodeURIComponent(url)}`;
  const response = await fetch(endpoint, {
    headers: { accept: "application/json" },
    // A capture should feel instant even when the platform is not answering;
    // six seconds and then give up — the row still saves, just barer.
    signal: AbortSignal.timeout(6_000),
  });
  if (!response.ok) return null;

  const payload = (await response.json().catch(() => ({}))) as {
    title?: unknown;
    thumbnail_url?: unknown;
    author_name?: unknown;
  };

  const str = (value: unknown, maxLength = 300) =>
    typeof value === "string" && value.trim()
      ? value.trim().slice(0, maxLength)
      : null;

  return {
    title: str(payload.title),
    imageUrl: str(payload.thumbnail_url),
    author: str(payload.author_name, 80),
  };
}
