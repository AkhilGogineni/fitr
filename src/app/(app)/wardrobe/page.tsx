import Link from "next/link";

import { HangerIcon } from "@/components/icons";
import { WardrobeGrid } from "@/components/wardrobe-grid";
import { btnPrimary } from "@/lib/ui";
import { createClient } from "@/lib/supabase/server";

export const metadata = { title: "Wardrobe" };

/**
 * The wardrobe, in the gallery register: the bench's pegboard of tagged
 * pieces, the clothes supplying every bit of colour on the page.
 *
 * Cutouts are transparent, so a cream shirt on a cream page is an invisible
 * shirt. Every garment sits on a `--surface` card with a hairline border,
 * which is the whole reason that token exists.
 */
export default async function WardrobePage() {
  const supabase = await createClient();

  // No `.eq("user_id", ...)` anywhere: RLS scopes this to the caller. If this
  // ever returns another user's rows, the policies are wrong — which is
  // exactly what the Phase 0 isolation check verifies.
  const { data: items, error } = await supabase
    .from("items")
    .select(
      "id, category, subcategory, brand, colors, image_cutout_key, image_cutout_back_key, purchase_price_cents, needs_review",
    )
    .is("archived_at", null)
    .order("created_at", { ascending: false });

  if (error) {
    return (
      <div className="rounded-card border border-line bg-surface p-6 shadow-card">
        <h1 className="display text-2xl">Wardrobe</h1>
        <p className="mt-2 text-sm text-danger">
          Could not load items: {error.message}
        </p>
        <p className="mt-3 text-sm text-ink-muted">
          If this is a fresh install, the migrations in{" "}
          <code className="font-mono text-xs">supabase/migrations</code> may not
          have been applied yet. See SETUP.md.
        </p>
      </div>
    );
  }

  const unchecked = items.filter((item) => item.needs_review).length;

  return (
    <div>
      <header className="mb-8 flex flex-wrap items-baseline justify-between gap-4">
        <div>
          <h1 className="display text-4xl">Wardrobe</h1>
          <p className="label nums mt-2">
            {items.length === 0
              ? "Nothing here yet."
              : `${items.length} ${items.length === 1 ? "piece" : "pieces"}`}
            {unchecked > 0 ? (
              <>
                {" · "}
                <Link
                  href="/wardrobe/add"
                  className="text-copper underline underline-offset-4 transition-colors hover:text-ink"
                >
                  {unchecked} to check
                </Link>
              </>
            ) : null}
          </p>
        </div>

        <Link href="/wardrobe/add" className={btnPrimary}>
          Add pieces
        </Link>
      </header>

      {items.length === 0 ? (
        <div className="rounded-card border border-dashed border-line-strong bg-surface-sunk px-6 py-16 text-center">
          <HangerIcon className="mx-auto size-8 text-ink-faint" />
          <p className="mx-auto mt-4 max-w-sm text-sm text-ink-muted">
            Paste a product link, or photograph what you own.
          </p>
          <Link href="/wardrobe/add" className={`${btnTag} mt-4 inline-block text-sm`}>
            Start adding
          </Link>
        </div>
      ) : (
        <WardrobeGrid items={items} />
      )}
    </div>
  );
}
