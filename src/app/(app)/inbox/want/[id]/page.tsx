import Link from "next/link";
import { notFound } from "next/navigation";

import { OutfitPreview } from "@/components/outfit-preview";
import {
  CAPTURE_COLUMNS,
  MATCH_COLUMNS,
  WISH_COLUMNS,
  type CaptureRow,
  type ProductMatchRow,
  type WishItemRow,
  captureImage,
} from "@/lib/captures";
import { assessFit, describeProspect } from "@/lib/discovery/fit";
import { CATEGORY_LABELS, type Category } from "@/lib/garments";
import { ITEM_COLUMNS, type WardrobeItem } from "@/lib/items";
import { PROFILE_COLUMNS, type ProfileRow } from "@/lib/profile";
import { publicUrlFor } from "@/lib/r2";
import { slotsForItems } from "@/lib/styling/daily";
import { seasonFor, type ScoreContext } from "@/lib/styling/score";
import { btnTag } from "@/lib/ui";
import { createClient } from "@/lib/supabase/server";
import { WantPanel } from "./want-panel";

export const metadata = { title: "Want" };

/**
 * Seconds. Covers the server actions this page calls, which in this Next
 * version is set here at page level (route-segment `maxDuration` docs, "Server
 * Actions"). `runDiscovery` is the reason: a grounded search allowed 150s
 * (`GROUNDED_TIMEOUT_MS` in lib/discovery/search.ts, from measured runs of up
 * to 94s), then verification — up to 3 rounds of 8s fetches, measured at
 * 0.7–5s — then a few Supabase writes. 200 leaves room for all of that and
 * stays under 300s, the Vercel function default this was sized against (taken
 * from the plan, not re-checked against the account's plan limits).
 */
export const maxDuration = 200;

/**
 * One want: what it is, what the web has, and whether it works with the closet.
 *
 * The fit check runs on every render rather than being read from
 * `wish_items.fit_note`. It's local arithmetic over rows already loaded, so it
 * costs nothing — and it must reflect the wardrobe *now*, not the wardrobe on
 * the day discovery last ran. Buying a pair of charcoal trousers last week
 * should change this answer, and a cached verdict wouldn't.
 *
 * The stored `fit_note` is for the list on `/inbox`, where recomputing it for
 * every row would mean loading the whole wardrobe to render a subtitle.
 */
export default async function WantPage({ params }: PageProps<"/inbox/want/[id]">) {
  const { id } = await params;
  const supabase = await createClient();

  const [{ data: wantRow }, { data: matchRows }, { data: itemRows }, { data: profileRow }] =
    await Promise.all([
      supabase.from("wish_items").select(WISH_COLUMNS).eq("id", id).maybeSingle(),
      supabase
        .from("product_matches")
        .select(MATCH_COLUMNS)
        .eq("wish_item_id", id)
        .order("score", { ascending: false, nullsFirst: false }),
      supabase.from("items").select(ITEM_COLUMNS).is("archived_at", null),
      supabase.from("profiles").select(PROFILE_COLUMNS).maybeSingle(),
    ]);

  // A want that isn't yours looks exactly like a want that doesn't exist, which
  // is the correct thing for it to look like.
  if (!wantRow) notFound();

  const want = wantRow as WishItemRow;
  const matches = (matchRows ?? []) as ProductMatchRow[];
  const wardrobe = (itemRows ?? []) as WardrobeItem[];
  const profile = (profileRow ?? null) as ProfileRow | null;

  /*
   * The picture, resolved the same way the inbox list does: our copy first,
   * then whatever the source capture still carries. A want with no picture at
   * all is legal — a typed-in "grey wool overcoat" never had one — but a want
   * that came from a link almost always can show something.
   */
  let sourceCapture: CaptureRow | null = null;
  if (!want.image_key && want.from_capture_id) {
    const { data } = await supabase
      .from("captures")
      .select(CAPTURE_COLUMNS)
      .eq("id", want.from_capture_id)
      .maybeSingle();
    sourceCapture = (data ?? null) as CaptureRow | null;
  }
  const wantImage = want.image_key
    ? publicUrlFor(want.image_key)
    : sourceCapture
      ? captureImage(sourceCapture, publicUrlFor)
      : null;

  // makeWant parks the source URL in `description`; reads as a fallback for
  // wants created before the capture link was kept anywhere else.
  const originalUrl =
    sourceCapture?.source_url ??
    (/^https?:\/\//i.test(want.description ?? "") ? want.description : null);

  const context: ScoreContext = {
    occasion: "casual",
    forecast: null,
    daysSinceWorn: new Map(),
    season: seasonFor(new Date(), profile?.location_lat ?? null),
    available: new Set(wardrobe.map((item) => item.category as Category)),
  };

  const fit = assessFit(
    describeProspect(want.title, {
      category: (want.category as Category | null) ?? null,
      description: want.description,
    }),
    wardrobe,
    context,
  );

  const lastRunLabel = want.last_discovery_at
    ? relativeTime(Date.parse(want.last_discovery_at))
    : null;

  const verdictTone: Record<typeof fit.verdict, string> = {
    works: "border-line bg-surface",
    thin: "border-copper/60 bg-surface",
    no: "border-danger/50 bg-surface",
  };

  return (
    <div className="mx-auto max-w-3xl">
      <Link href="/inbox" className={`${btnTag} text-sm`}>
        ← Inbox
      </Link>

      <header className="mb-6 mt-3 flex items-start gap-5">
        {wantImage ? (
          <div className="h-32 w-28 shrink-0 overflow-hidden rounded-card border border-line bg-surface-sunk shadow-card">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={wantImage}
              alt={want.title}
              className="size-full object-cover"
            />
          </div>
        ) : null}
        <div className="min-w-0">
          <h1 className="display text-4xl">{want.title}</h1>
          <p className="label nums mt-2">
            {want.category ? CATEGORY_LABELS[want.category as Category] : "No category set"}
            {matches.length > 0 ? ` · ${matches.length} found` : ""}
          </p>
          {originalUrl ? (
            <a
              href={originalUrl}
              target="_blank"
              rel="noreferrer noopener"
              className={`${btnTag} mt-3 inline-block max-w-full truncate`}
            >
              Original link
            </a>
          ) : null}
        </div>
      </header>

      {/* The closet check, above the shopping. Deliberately: the useful order
          is "should you buy this at all" and only then "where from". */}
      <section
        className={`mb-4 rounded-card border p-5 shadow-card ${verdictTone[fit.verdict]}`}
      >
        <p className="label">Against what you own</p>
        <p className="mt-1.5 text-sm">{fit.note}</p>

        {fit.outfits.length > 0 ? (
          <ul className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
            {fit.outfits.map((outfit, index) => (
              <li key={index} className="rounded-card border border-line bg-surface p-2">
                <OutfitPreview slots={slotsForItems(outfit.items)} />
                <p className="label mt-1.5 truncate">
                  {outfit.items
                    .map(
                      (item) =>
                        item.subcategory ??
                        item.brand ??
                        CATEGORY_LABELS[item.category as Category],
                    )
                    .join(", ")}
                </p>
              </li>
            ))}
          </ul>
        ) : null}

        {fit.verdict === "no" && wardrobe.length > 0 ? (
          <p className="mt-3 text-xs text-ink-faint">
            That&apos;s the whole point of this box. If nothing here works with it,
            the piece costs more than its price.
          </p>
        ) : null}
      </section>

      <WantPanel want={want} matches={matches} lastRunLabel={lastRunLabel} />
    </div>
  );
}

/** "20 minutes ago", "3 days ago". Enough precision for a search budget. */
function relativeTime(timestamp: number): string {
  const seconds = Math.round((Date.now() - timestamp) / 1000);
  if (seconds < 90) return "just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} minutes ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  const days = Math.round(hours / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}
