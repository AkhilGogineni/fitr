/**
 * Environment access with a loud failure mode.
 *
 * A missing Supabase URL should blow up at startup with a readable message,
 * not surface later as an opaque "fetch failed" from deep inside a client
 * library. Server-only values are read lazily so importing this module from a
 * Client Component never trips the server-side checks.
 */

function required(name: string, value: string | undefined): string {
  if (!value) {
    throw new Error(
      `Missing environment variable ${name}. Copy .env.example to .env.local and fill it in — see SETUP.md.`,
    );
  }
  return value;
}

/**
 * Values inlined into the browser bundle. Must be NEXT_PUBLIC_ prefixed.
 *
 * These are getters rather than plain properties so that merely importing this
 * module doesn't throw. `next build` evaluates module scope while collecting
 * page data, and an eager check would fail the build before any env exists.
 * Reading a value still throws with a useful message.
 *
 * The `process.env.NEXT_PUBLIC_*` references stay as literal text, which is
 * what Next's build-time inlining looks for — moving them behind a dynamic
 * lookup like `process.env[name]` would silently produce `undefined` in the
 * browser bundle.
 */
export const publicEnv = {
  get NEXT_PUBLIC_SUPABASE_URL() {
    return required(
      "NEXT_PUBLIC_SUPABASE_URL",
      process.env.NEXT_PUBLIC_SUPABASE_URL,
    );
  },
  get NEXT_PUBLIC_SUPABASE_ANON_KEY() {
    return required(
      "NEXT_PUBLIC_SUPABASE_ANON_KEY",
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    );
  },
  /**
   * VAPID public key, or null. Unlike the two above this is optional and so
   * doesn't go through `required()` — push notifications are opt-in and the app
   * is fully usable without them. The browser needs this value to subscribe,
   * which is why it's public; the matching private key never leaves the server.
   */
  get NEXT_PUBLIC_VAPID_PUBLIC_KEY(): string | null {
    return process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY || null;
  },
};

/**
 * Server-only values. Never import this from a Client Component — the R2
 * secret would end up in the browser bundle.
 */
export function serverEnv() {
  return {
    R2_ACCOUNT_ID: required("R2_ACCOUNT_ID", process.env.R2_ACCOUNT_ID),
    R2_ACCESS_KEY_ID: required(
      "R2_ACCESS_KEY_ID",
      process.env.R2_ACCESS_KEY_ID,
    ),
    R2_SECRET_ACCESS_KEY: required(
      "R2_SECRET_ACCESS_KEY",
      process.env.R2_SECRET_ACCESS_KEY,
    ),
    R2_BUCKET: required("R2_BUCKET", process.env.R2_BUCKET),
    /** Public base URL for reading objects (R2 custom domain or r2.dev). */
    R2_PUBLIC_BASE_URL: required(
      "R2_PUBLIC_BASE_URL",
      process.env.R2_PUBLIC_BASE_URL,
    ),
  };
}

/**
 * The Supabase service-role key.
 *
 * Separate from `serverEnv()` on purpose. That function is called on every
 * upload and would start throwing for every user of R2 the moment this key was
 * absent, even though only two routes in the app need it — the capture endpoint
 * and the price cron, neither of which has a signed-in user to act as.
 *
 * This key bypasses RLS entirely. It must never be `NEXT_PUBLIC_`, never be
 * imported from a Client Component, and never be used by a path that has a
 * session available instead.
 */
export function serviceRoleKey() {
  return required(
    "SUPABASE_SERVICE_ROLE_KEY",
    process.env.SUPABASE_SERVICE_ROLE_KEY,
  );
}

/**
 * The shared secret the price cron presents.
 *
 * `/api/cron/prices` is a public URL with no session behind it, so this is the
 * only thing standing between a scheduled job and anyone who guesses the path.
 */
export function cronSecret() {
  return required("CRON_SECRET", process.env.CRON_SECRET);
}

/**
 * VAPID keypair for Web Push, or null when push isn't set up.
 *
 * Null is a supported state, not a misconfiguration: notifications are opt-in,
 * and the whole price watch works without them — the drops still land on the
 * watch page. So this returns null rather than throwing, and every caller is
 * expected to carry on.
 */
export function vapidKeys() {
  const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  const subject = process.env.VAPID_SUBJECT;
  if (!publicKey || !privateKey || !subject) return null;
  return { publicKey, privateKey, subject };
}
