import { FetchRejected, safeFetch } from "@/lib/intake/safe-fetch";
import { getUser } from "@/lib/supabase/server";

/**
 * Relays a retailer's product photo back to the browser.
 *
 * The cutout has to happen client-side — that's the whole reason background
 * removal is free here — and to cut an image the browser must be able to read
 * its pixels. Retailer CDNs don't send CORS headers, so `createImageBitmap` on
 * a cross-origin URL yields a tainted canvas and the pipeline dies at the last
 * step. Passing the bytes through our own origin makes them same-origin.
 *
 * Deliberately not a general-purpose proxy: signed-in only, images only,
 * capped, and every hop checked by `safeFetch`.
 */

const MAX_IMAGE_BYTES = 12_000_000;

export async function GET(request: Request) {
  const user = await getUser();
  if (!user) {
    return Response.json({ error: "Not signed in" }, { status: 401 });
  }

  const target = new URL(request.url).searchParams.get("url");
  if (!target) {
    return Response.json({ error: "A url parameter is required." }, { status: 400 });
  }

  try {
    const image = await safeFetch(target, {
      accept: "image/*",
      maxBytes: MAX_IMAGE_BYTES,
    });

    if (!image.contentType.startsWith("image/")) {
      return Response.json(
        { error: `That URL returned ${image.contentType || "no content type"}, not an image.` },
        { status: 422 },
      );
    }

    return new Response(image.body as BodyInit, {
      headers: {
        "content-type": image.contentType,
        "content-length": String(image.body.byteLength),
        // Someone else's product photo, fetched under this user's session:
        // nothing between here and the browser should keep a copy.
        "cache-control": "private, no-store",
      },
    });
  } catch (error) {
    if (error instanceof FetchRejected) {
      return Response.json({ error: error.message }, { status: error.status });
    }
    console.error("Image proxy failed", error);
    return Response.json({ error: "Couldn't fetch that image." }, { status: 500 });
  }
}
