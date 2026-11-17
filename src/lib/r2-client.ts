/**
 * Client-safe R2 URL builder.
 *
 * This module provides `publicUrlFor` without the `server-only` guard,
 * so client components can build read URLs from R2 object keys.
 *
 * The public base URL is inlined at build time via NEXT_PUBLIC_ prefix.
 * If it's missing, we fall back to an empty string which produces
 * relative URLs — fine for same-origin serving.
 */

const R2_PUBLIC_BASE =
  process.env.NEXT_PUBLIC_R2_PUBLIC_BASE_URL ?? "";

/** Public read URL for a stored R2 object. */
export function publicUrlFor(key: string) {
  const base = R2_PUBLIC_BASE.replace(/\/$/, "");
  return `${base}/${key}`;
}

/**
 * The same object, but through this origin.
 *
 * For `<img>` this would be pure overhead and `publicUrlFor` stays the right
 * answer. It exists for one caller: a WebGL texture. Uploading a cross-origin
 * image into a texture is refused unless the response carried CORS headers,
 * and the refusal arrives *after* the image has decoded — so the failure looks
 * like a garment that simply has no photo on it rather than like an error.
 * Same-origin has no such condition attached. See `api/texture/[...key]`.
 */
export function textureUrlFor(key: string) {
  return `/api/texture/${key}`;
}