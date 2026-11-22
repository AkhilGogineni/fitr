import { NextResponse } from "next/server";

import { extractProduct, isChallengePage } from "@/lib/intake/product-page";
import { FetchRejected, safeFetch } from "@/lib/intake/safe-fetch";
import { getUser } from "@/lib/supabase/server";

/**
 * Reads a retailer's product page and returns what intake needs from it.
 *
 * This has to run server-side twice over: a browser can't fetch a third-party
 * page (CORS), and letting the client pick which URLs the server fetches is the
 * SSRF surface that `safeFetch` exists to contain.
 *
 * Metadata only — no image bytes. The client asks for the picture separately
 * through /api/import/image, so a page that yields good metadata but a broken
 * image still gets the user most of the way there.
 */

/** Retailer pages are enormous; 3MB is generous for one that's mostly markup. */
const MAX_HTML_BYTES = 3_000_000;

export async function POST(request: Request) {
  const user = await getUser();
  if (!user) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

  let body: { url?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Expected JSON body" }, { status: 400 });
  }

  const url = body.url?.trim();
  if (!url) {
    return NextResponse.json({ error: "A url is required." }, { status: 400 });
  }

  try {
    const page = await safeFetch(url, {
      accept: "text/html,application/xhtml+xml",
      maxBytes: MAX_HTML_BYTES,
    });

    if (!/text\/html|application\/xhtml/i.test(page.contentType)) {
      return NextResponse.json(
        { error: "That link isn't a web page." },
        { status: 422 },
      );
    }

    const html = new TextDecoder("utf-8").decode(page.body);
    // A bot wall's 200 interstitial is a refusal, not an empty product page:
    // answer it the way a 403 is answered, rather than prefilling the form
    // with "Client Challenge".
    if (isChallengePage(html)) {
      const host = new URL(page.finalUrl).hostname.replace(/^www\./, "");
      return NextResponse.json(
        {
          // Not the inbox's "use the extension" advice: the extension saves to
          // the inbox, not to the wardrobe form this answers.
          error: `${host} blocks automated readers, so the page couldn't be read. Add the photo and details by hand.`,
        },
        { status: 502 },
      );
    }
    const product = extractProduct(html, page.finalUrl);

    /*
     * A page with no image is not a failed request — it's a page that renders
     * its product data in the browser, which is how most large chains work.
     * Answering 200 with whatever was readable lets the client keep the brand
     * and the price it did find and ask for the one thing missing, instead of
     * throwing a good import away over a picture the user can paste in a
     * keystroke.
     */
    return NextResponse.json({ product });
  } catch (error) {
    if (error instanceof FetchRejected) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("URL import failed", error);
    return NextResponse.json({ error: "Couldn't read that page." }, { status: 500 });
  }
}
