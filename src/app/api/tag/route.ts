import { NextResponse } from "next/server";

import { TaggingError, getTagger } from "@/lib/intake/tagging";
import { getUser } from "@/lib/supabase/server";

/**
 * Auto-tags one garment image.
 *
 * Server-side because the API key can't ship to the browser. The client sends a
 * ~512px JPEG rather than the full photo — the model doesn't need more, and it
 * keeps a 30-item batch's upload cost trivial on a phone connection.
 *
 * Every failure here is soft. The client saves the item regardless and flags it
 * for review, so a missing key or an exhausted quota slows intake down instead
 * of stopping it.
 */

/** 512px JPEG lands around 60KB; 2MB of base64 is a generous ceiling. */
const MAX_BASE64_LENGTH = 2_800_000;

export async function POST(request: Request) {
  const user = await getUser();
  if (!user) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

  const tagger = getTagger();
  if (!tagger) {
    return NextResponse.json(
      { error: "No tagger configured. Set GEMINI_API_KEY to auto-tag." },
      { status: 503 },
    );
  }

  let body: { imageBase64?: string; mimeType?: string; hint?: string | null };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Expected JSON body" }, { status: 400 });
  }

  const { imageBase64, mimeType, hint } = body;

  if (!imageBase64 || !mimeType?.startsWith("image/")) {
    return NextResponse.json(
      { error: "imageBase64 and an image mimeType are required." },
      { status: 400 },
    );
  }

  if (imageBase64.length > MAX_BASE64_LENGTH) {
    return NextResponse.json(
      { error: "That image is too large to tag — downscale it first." },
      { status: 413 },
    );
  }

  try {
    const tags = await tagger.tag({ imageBase64, mimeType, hint });
    return NextResponse.json({ tags, taggedBy: tagger.name });
  } catch (error) {
    if (error instanceof TaggingError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("Tagging failed", error);
    return NextResponse.json({ error: "Tagging failed." }, { status: 500 });
  }
}
