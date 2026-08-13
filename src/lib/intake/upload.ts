import type { UploadKind } from "@/lib/r2";

/**
 * Browser -> R2 upload, via a presigned PUT.
 *
 * The bytes never touch our server: it only signs a URL scoped to a key it
 * derives from the session. A 20-photo batch would otherwise push ~40MB through
 * a serverless function that is billed by the second and capped by request size.
 *
 * Requires a CORS rule on the bucket allowing PUT from the app's origin — the
 * failure mode without it is an opaque "TypeError: Failed to fetch", so it is
 * called out in SETUP.md.
 */
export async function uploadToR2(
  blob: Blob,
  kind: UploadKind,
): Promise<{ key: string; publicUrl: string }> {
  const contentType = blob.type || "application/octet-stream";

  const signed = await fetch("/api/uploads/sign", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ kind, contentType }),
  });

  if (!signed.ok) {
    const { error } = (await signed.json().catch(() => ({}))) as { error?: string };
    throw new Error(error ?? `Couldn't get an upload URL (${signed.status}).`);
  }

  const { uploadUrl, key, publicUrl } = (await signed.json()) as {
    uploadUrl: string;
    key: string;
    publicUrl: string;
  };

  const put = await fetch(uploadUrl, {
    method: "PUT",
    // Must match the content type the URL was signed with, or R2 rejects it.
    headers: { "content-type": contentType },
    body: blob,
  }).catch(() => {
    throw new Error(
      "Upload was blocked by the browser. Check the bucket's CORS rules allow PUT from this origin.",
    );
  });

  if (!put.ok) throw new Error(`R2 refused the upload (${put.status}).`);

  return { key, publicUrl };
}
