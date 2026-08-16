import "server-only";

import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

import { serverEnv } from "@/lib/env";

/**
 * Cloudflare R2 access.
 *
 * R2 speaks the S3 API, so the AWS SDK works unchanged against a custom
 * endpoint with region "auto". We chose R2 over Supabase Storage because the
 * free tier is 10GB with zero egress fees, while Supabase's is 1GB — and a
 * 250-item wardrobe with originals plus cutouts lands around 300–600MB, which
 * would eat most of that budget in year one.
 *
 * Uploads go browser -> R2 directly via a presigned URL. The bytes never pass
 * through Vercel, which keeps us inside the Hobby tier's limits and means a
 * 40-image batch import doesn't hammer a serverless function.
 */

let client: S3Client | null = null;

function r2() {
  if (!client) {
    const env = serverEnv();
    client = new S3Client({
      region: "auto",
      endpoint: `https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId: env.R2_ACCESS_KEY_ID,
        secretAccessKey: env.R2_SECRET_ACCESS_KEY,
      },
    });
  }
  return client;
}

export const UPLOAD_KINDS = ["original", "cutout", "capture"] as const;
export type UploadKind = (typeof UPLOAD_KINDS)[number];

/** Cutouts must keep transparency, so PNG is the only option for that kind. */
const ALLOWED_CONTENT_TYPES: Record<UploadKind, string[]> = {
  original: ["image/jpeg", "image/png", "image/webp", "image/heic"],
  cutout: ["image/png"],
  capture: ["image/jpeg", "image/png", "image/webp", "image/heic"],
};

export function isAllowedContentType(kind: UploadKind, contentType: string) {
  return ALLOWED_CONTENT_TYPES[kind].includes(contentType);
}

function extensionFor(contentType: string) {
  switch (contentType) {
    case "image/jpeg":
      return "jpg";
    case "image/png":
      return "png";
    case "image/webp":
      return "webp";
    case "image/heic":
      return "heic";
    default:
      return "bin";
  }
}

/**
 * Object keys are namespaced by user id. Combined with the fact that only this
 * server route can mint a presigned URL, that keeps one user's objects
 * unreachable by another even though the bucket itself is flat.
 */
export function buildObjectKey(
  userId: string,
  kind: UploadKind,
  contentType: string,
) {
  return `${userId}/${kind}/${crypto.randomUUID()}.${extensionFor(contentType)}`;
}

export async function createUploadUrl(key: string, contentType: string) {
  const env = serverEnv();
  return getSignedUrl(
    r2(),
    new PutObjectCommand({
      Bucket: env.R2_BUCKET,
      Key: key,
      ContentType: contentType,
    }),
    { expiresIn: 300 },
  );
}

/**
 * Uploads from the server.
 *
 * The presigned-URL path above exists so image bytes never touch Vercel, and
 * that remains the rule for intake. This is the exception the capture endpoint
 * needs: an iOS Shortcut can't be handed a presigned URL and told to make a
 * second request — the share sheet gets one shot, and a two-step upload from a
 * Shortcut is a Shortcut nobody finishes configuring. So a capture's image
 * arrives inline and is relayed from here.
 *
 * Bounded by the caller. A capture is a phone screenshot, not a RAW file.
 */
export async function putObject(
  key: string,
  body: Uint8Array,
  contentType: string,
) {
  const env = serverEnv();
  await r2().send(
    new PutObjectCommand({
      Bucket: env.R2_BUCKET,
      Key: key,
      Body: body,
      ContentType: contentType,
    }),
  );
  return key;
}

/** Public read URL for a stored object. */
export function publicUrlFor(key: string) {
  const base = serverEnv().R2_PUBLIC_BASE_URL.replace(/\/$/, "");
  return `${base}/${key}`;
}
