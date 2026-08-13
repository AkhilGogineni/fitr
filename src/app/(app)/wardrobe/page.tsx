import Link from "next/link";

import { CATEGORY_LABELS, formatPrice, type Category } from "@/lib/garments";
import { publicUrlFor } from "@/lib/r2";
import { createClient } from "@/lib/supabase/server";

export const metadata = { title: "Wardrobe · fitr" };

/**
 * The wardrobe, in the gallery register: paper ground, room to breathe, the
 * clothes supplying every bit of colour on the page.
 *
 * Cutouts are transparent, so a cream shirt on a cream page is an invisible
 * shirt. Every garment sits on a `--surface` card with a hairline border, which
 * is the whole reason that token exists.
 */
export default async function WardrobePage() {
  const supabase = await createClient();

  // No `.eq("user_id", ...)` anywhere: RLS scopes this to the caller. If this
  // ever returns another user's rows, the policies are wrong — which is
  // exactly what the Phase 0 isolation check verifies.
  const { data: items, error } = await supabase
    .from("items")
    .select(
      "id, category, subcategory, brand, colors, image_cutout_key, purchase_price_cents, needs_review",
    )
    .is("archived_at", null)
    .order("created_at", { ascending: false });

  if (error) {
    return (
      <div className="rounded-card border border-line bg-surface p-6">
        <h1 className="display text-lg font-medium">Wardrobe</h1>
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
          <h1 className="display text-2xl font-medium">Wardrobe</h1>
          <p className="mt-1 text-sm text-ink-muted">
            {items.length === 0
              ? "Nothing here yet."
              : `${items.length} ${items.length === 1 ? "piece" : "pieces"}`}
            {unchecked > 0 ? (
              <>
                {" · "}
                <Link
                  href="/wardrobe/add"
                  className="underline underline-offset-4 transition-colors hover:text-ink"
                >
                  {unchecked} to check
                </Link>
              </>
            ) : null}
          </p>
        </div>

        <Link
          href="/wardrobe/add"
          className="rounded-card bg-accent px-3.5 py-2 text-sm font-medium text-accent-ink transition-opacity hover:opacity-90"
        >
          Add pieces
        </Link>
      </header>

      {items.length === 0 ? (
        <div className="rounded-card border border-dashed border-line-strong bg-surface-sunk px-6 py-16 text-center">
          <p className="text-sm text-ink-muted">
            Paste a product link, or photograph what you own.
          </p>
          <Link
            href="/wardrobe/add"
            className="mt-4 inline-block text-sm underline underline-offset-4"
          >
            Start adding
          </Link>
        </div>
      ) : (
        <ul className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
          {items.map((item) => (
            <li
              key={item.id}
              className="group rounded-card border border-line bg-surface p-3 shadow-card"
            >
              <div className="relative aspect-square overflow-hidden rounded bg-surface-sunk">
                {/* A plain image element, not next/image: these are cutouts
                    served from R2, where egress is free, while Vercel's
                    optimiser is metered on the tier this is built inside.
                    Sized by the grid and lazily loaded. */}
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={publicUrlFor(item.image_cutout_key)}
                  alt={item.subcategory ?? CATEGORY_LABELS[item.category as Category]}
                  loading="lazy"
                  className="size-full object-contain p-2 transition-transform duration-500 group-hover:scale-[1.03]"
                />
                {item.needs_review ? (
                  <span className="absolute left-2 top-2 rounded-full bg-accent px-2 py-0.5 text-[0.625rem] font-medium tracking-wide text-accent-ink">
                    Needs a look
                  </span>
                ) : null}
              </div>

              <p className="mt-2.5 truncate text-sm">
                {item.brand ?? item.subcategory ?? CATEGORY_LABELS[item.category as Category]}
              </p>
              <p className="label mt-0.5 truncate">
                {item.subcategory && item.brand
                  ? item.subcategory
                  : CATEGORY_LABELS[item.category as Category]}
                {item.purchase_price_cents
                  ? ` · ${formatPrice(item.purchase_price_cents, null)}`
                  : ""}
              </p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
