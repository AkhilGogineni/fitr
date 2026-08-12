import { NextResponse } from "next/server";

import {
  UPLOAD_KINDS,
  type UploadKind,
  buildObjectKey,
  createUploadUrl,
  isAllowedContentType,
  publicUrlFor,
} from "@/lib/r2";
import { getUser } from "@/lib/supabase/server";

/**
 * Mints a short-lived presigned PUT URL so the browser can upload straight to
 * R2. The server never touches the image bytes.
 *
 * The client cannot choose its own object key — the key is derived from the
 * authenticated user id here, so a caller can't write into someone else's
 * namespace by passing a crafted path.
 */
export async function POST(request: Request) {
  const user = await getUser();
  if (!user) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

  let body: { kind?: string; contentType?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Expected JSON body" }, { status: 400 });
  }

  const { kind, contentType } = body;

  if (!kind || !UPLOAD_KINDS.includes(kind as UploadKind)) {
    return NextResponse.json(
      { error: `kind must be one of: ${UPLOAD_KINDS.join(", ")}` },
      { status: 400 },
    );
  }

  if (!contentType || !isAllowedContentType(kind as UploadKind, contentType)) {
    return NextResponse.json(
      { error: `Unsupported content type "${contentType}" for kind "${kind}"` },
      { status: 400 },
    );
  }

  const key = buildObjectKey(user.id, kind as UploadKind, contentType);
  const uploadUrl = await createUploadUrl(key, contentType);

  return NextResponse.json({ uploadUrl, key, publicUrl: publicUrlFor(key) });
}
