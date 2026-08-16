import { NextResponse } from "next/server";

import { createClient, getUser } from "@/lib/supabase/server";

/**
 * Registering and forgetting a device for push.
 *
 * Session-authenticated, unlike `/api/capture` — this is always called from a
 * signed-in page in the browser, so there is no reason to introduce a second
 * credential. It uses the ordinary RLS-scoped client for the same reason: a
 * subscription belongs to whoever is signed in, and the database can enforce
 * that without help.
 *
 * One row per device, not per user. A browser's push endpoint is unique to the
 * install, so signing in on a laptop and a phone produces two rows and both
 * should get the notification — which is why the upsert conflicts on the
 * endpoint rather than the user.
 */
export async function POST(request: Request) {
  const user = await getUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  let body: { endpoint?: string; keys?: { p256dh?: string; auth?: string } };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Expected JSON body" }, { status: 400 });
  }

  const { endpoint, keys } = body;
  if (!endpoint || !keys?.p256dh || !keys.auth) {
    return NextResponse.json(
      { error: "A subscription needs an endpoint and both keys." },
      { status: 400 },
    );
  }

  const supabase = await createClient();
  const { error } = await supabase.from("push_subscriptions").upsert(
    {
      user_id: user.id,
      endpoint,
      p256dh: keys.p256dh,
      auth: keys.auth,
      user_agent: request.headers.get("user-agent")?.slice(0, 300) ?? null,
    },
    // Re-subscribing the same device is the normal case — browsers rotate
    // endpoints and re-register on their own schedule — so this must update
    // rather than collide with the unique constraint.
    { onConflict: "endpoint" },
  );

  if (error) {
    console.error("Push subscribe failed", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}

export async function DELETE(request: Request) {
  const user = await getUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  let body: { endpoint?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Expected JSON body" }, { status: 400 });
  }

  if (!body.endpoint) {
    return NextResponse.json({ error: "Which endpoint?" }, { status: 400 });
  }

  const supabase = await createClient();
  // No user filter: RLS already restricts this to the caller's rows, so an
  // endpoint belonging to someone else simply matches nothing.
  const { error } = await supabase
    .from("push_subscriptions")
    .delete()
    .eq("endpoint", body.endpoint);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
