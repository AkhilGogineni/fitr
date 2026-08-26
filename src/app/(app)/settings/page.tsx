import Link from "next/link";

import { publicEnv } from "@/lib/env";
import { PROFILE_COLUMNS, priceCeilings, type ProfileRow } from "@/lib/profile";
import { btnOutline } from "@/lib/ui";
import { createClient, getUser } from "@/lib/supabase/server";
import { signOut } from "@/app/login/actions";
import { PushToggle } from "./push-toggle";
import { SettingsForm } from "./settings-form";

export const metadata = { title: "Settings" };

/**
 * The four things this app needs told rather than inferred: where you are, what
 * you'll spend, the credential the share sheet uses, and whether you want to be
 * interrupted about a price.
 *
 * The profile row itself is created by a trigger at signup, so this page always
 * has something to read — an empty result here means the trigger didn't fire,
 * which is worth showing rather than quietly upserting past.
 */
export default async function SettingsPage() {
  const supabase = await createClient();
  const user = await getUser();

  const { data, error } = await supabase
    .from("profiles")
    .select(PROFILE_COLUMNS)
    .maybeSingle();

  if (error || !data) {
    return (
      <div className="mx-auto max-w-2xl rounded-card border border-line bg-surface p-6 shadow-card">
        <h1 className="display text-2xl">Settings</h1>
        <p className="mt-2 text-sm text-danger">
          {error?.message ?? "No profile row for this account."}
        </p>
        <p className="mt-3 text-sm text-ink-muted">
          A profile is created by a trigger when an account is made. If this is a
          fresh install, check that{" "}
          <code className="font-mono text-xs">0001_initial_schema.sql</code> ran in
          full — see <Link href="/wardrobe" className="underline underline-offset-4">SETUP.md</Link>.
        </p>
      </div>
    );
  }

  const profile = data as ProfileRow;

  return (
    <div className="mx-auto max-w-2xl">
      <header className="mb-8">
        <h1 className="display text-4xl">Settings</h1>
        <p className="mt-1.5 text-sm text-ink-muted">
          Four things worth telling it once.
        </p>
      </header>

      <SettingsForm
        locationName={profile.location_name}
        locationLat={profile.location_lat}
        locationLon={profile.location_lon}
        ceilings={priceCeilings(profile.price_ceilings)}
        captureToken={profile.capture_token}
      />

      <div className="mt-4">
        <PushToggle vapidPublicKey={publicEnv.NEXT_PUBLIC_VAPID_PUBLIC_KEY} />
      </div>

      {/* Account. Lives here rather than only in the rail so the phone's bottom
          bar keeps its five slots — signing out is not a daily act. */}
      <section className="mt-4 rounded-card border border-line bg-surface p-5 shadow-card">
        <h2 className="text-sm font-medium">Account</h2>
        <p className="mt-1 font-mono text-xs leading-relaxed text-ink-muted">
          Signed in as {user?.email ?? "unknown"}
        </p>
        <form action={signOut} className="mt-3">
          <button type="submit" className={btnOutline}>
            Sign out
          </button>
        </form>
      </section>

      <p className="mt-6 font-mono text-xs leading-relaxed text-ink-faint">
        Setting up the share sheet or the extension? See{" "}
        <code className="font-mono">docs/CAPTURE.md</code>.
      </p>
    </div>
  );
}
