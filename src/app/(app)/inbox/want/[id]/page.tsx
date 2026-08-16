import Link from "next/link";
import { notFound } from "next/navigation";

import { OutfitPreview } from "@/components/outfit-preview";
import {
  MATCH_COLUMNS,
  WISH_COLUMNS,
  type ProductMatchRow,
  type WishItemRow,
} from "@/lib/captures";
import { assessFit, describeProspect } from "@/lib/discovery/fit";
import { CATEGORY_LABELS, type Category } from "@/lib/garments";
import { ITEM_COLUMNS, type WardrobeItem } from "@/lib/items";
import { PROFILE_COLUMNS, type ProfileRow } from "@/lib/profile";
import { slotsForItems } from "@/lib/styling/daily";
import { seasonFor, type ScoreContext } from "@/lib/styling/score";
import { createClient } from "@/lib/supabase/server";
import { WantPanel } from "./want-panel";

export const metadata = { title: "Want · fitr" };

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
    thin: "border-line-strong bg-surface-sunk",
    no: "border-danger/40 bg-surface",
  };

  return (
    <div className="mx-auto max-w-3xl">
      <Link
        href="/inbox"
        className="text-xs text-ink-muted underline underline-offset-4 transition-colors hover:text-ink"
      >
        ← Inbox
      </Link>

      <header className="mb-6 mt-3">
        <h1 className="display text-2xl font-medium">{want.title}</h1>
        <p className="mt-1 text-sm text-ink-muted">
          {want.category ? CATEGORY_LABELS[want.category as Category] : "No category set"}
          {matches.length > 0 ? ` · ${matches.length} found` : ""}
        </p>
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
