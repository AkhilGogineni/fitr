import Link from "next/link";

import { publicEnv } from "@/lib/env";
import { PROFILE_COLUMNS, priceCeilings, type ProfileRow } from "@/lib/profile";
import { createClient } from "@/lib/supabase/server";
import { PushToggle } from "./push-toggle";
import { SettingsForm } from "./settings-form";

export const metadata = { title: "Settings · fitr" };

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

  const { data, error } = await supabase
    .from("profiles")
    .select(PROFILE_COLUMNS)
    .maybeSingle();

  if (error || !data) {
    return (
      <div className="mx-auto max-w-2xl rounded-card border border-line bg-surface p-6">
        <h1 className="display text-lg font-medium">Settings</h1>
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
        <h1 className="display text-2xl font-medium">Settings</h1>
        <p className="mt-1 text-sm text-ink-muted">
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

      <p className="mt-6 text-xs text-ink-faint">
        Setting up the share sheet or the extension? See{" "}
        <code className="font-mono">docs/CAPTURE.md</code>.
      </p>
    </div>
  );
}
