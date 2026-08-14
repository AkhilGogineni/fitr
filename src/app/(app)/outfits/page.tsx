import Link from "next/link";

import { OutfitPreview } from "@/components/outfit-preview";
import { CATEGORY_LABELS, type Category } from "@/lib/garments";
import { ITEM_COLUMNS, type WardrobeItem } from "@/lib/items";
import {
  OCCASION_LABELS,
  OUTFIT_COLUMNS,
  SLOT_COLUMNS,
  describeGap,
  normaliseTransform,
  type OutfitRow,
  type SlotRow,
  type SlotView,
} from "@/lib/outfits";
import { publicUrlFor } from "@/lib/r2";
import { createClient } from "@/lib/supabase/server";
import { createOutfit } from "./actions";

export const metadata = { title: "Outfits · fitr" };

/**
 * Every saved outfit, drawn with the same renderer the editor uses.
 *
 * The gap count is on the card deliberately: an outfit waiting on a purchase is
 * the most interesting thing this list knows, and it's what Phase 5 will go
 * shopping for.
 */
export default async function OutfitsPage() {
  const supabase = await createClient();

  const [{ data: outfitRows, error }, { data: slotRows }, { data: itemRows }] =
    await Promise.all([
      supabase.from("outfits").select(OUTFIT_COLUMNS).order("updated_at", { ascending: false }),
      supabase.from("outfit_slots").select(SLOT_COLUMNS),
      supabase.from("items").select(ITEM_COLUMNS).is("archived_at", null),
    ]);

  if (error) {
    return (
      <div className="rounded-card border border-line bg-surface p-6">
        <h1 className="display text-lg font-medium">Outfits</h1>
        <p className="mt-2 text-sm text-danger">Could not load outfits: {error.message}</p>
      </div>
    );
  }

  const outfits = (outfitRows ?? []) as OutfitRow[];
  const items = new Map(
    ((itemRows ?? []) as WardrobeItem[]).map((item) => [item.id, item]),
  );

  // One pass over every slot, grouped by outfit — cheaper than a query per card.
  const slotsByOutfit = new Map<string, SlotView[]>();
  for (const slot of (slotRows ?? []) as SlotRow[]) {
    const item = slot.item_id ? items.get(slot.item_id) : undefined;
    const view: SlotView = {
      ...slot,
      transform: normaliseTransform(slot.transform, slot.layer),
      imageUrl: item ? publicUrlFor(item.image_cutout_key) : undefined,
      label: item
        ? (item.brand ?? item.subcategory ?? CATEGORY_LABELS[item.category as Category])
        : slot.gap_spec
          ? describeGap(slot.gap_spec, CATEGORY_LABELS[slot.layer])
          : CATEGORY_LABELS[slot.layer],
    };
    slotsByOutfit.set(slot.outfit_id, [...(slotsByOutfit.get(slot.outfit_id) ?? []), view]);
  }

  return (
    <div>
      <header className="mb-8 flex flex-wrap items-baseline justify-between gap-4">
        <div>
          <h1 className="display text-2xl font-medium">Outfits</h1>
          <p className="mt-1 text-sm text-ink-muted">
            {outfits.length === 0
              ? "Nothing composed yet."
              : `${outfits.length} saved`}
          </p>
        </div>

        <form action={createOutfit}>
          <button
            type="submit"
            className="rounded-card bg-accent px-3.5 py-2 text-sm font-medium text-accent-ink transition-opacity hover:opacity-90"
          >
            New outfit
          </button>
        </form>
      </header>

      {outfits.length === 0 ? (
        <div className="rounded-card border border-dashed border-line-strong bg-surface-sunk px-6 py-16 text-center">
          <p className="mx-auto max-w-md text-sm text-ink-muted">
            Lay pieces out on a canvas, and leave a gap where the outfit needs
            something you don&apos;t own yet. Those gaps become the shopping list.
          </p>
        </div>
      ) : (
        <ul className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
          {outfits.map((outfit) => {
            const slots = slotsByOutfit.get(outfit.id) ?? [];
            const gaps = slots.filter((slot) => slot.gap_spec).length;

            return (
              <li key={outfit.id}>
                <Link
                  href={`/outfits/${outfit.id}`}
                  className="group block rounded-card border border-line bg-surface p-3 shadow-card transition-colors hover:border-line-strong"
                >
                  <OutfitPreview slots={slots} />
                  <p className="mt-2.5 truncate text-sm">
                    {outfit.name || "Untitled outfit"}
                  </p>
                  <p className="label mt-0.5 truncate">
                    {outfit.occasion ? OCCASION_LABELS[outfit.occasion] : "No occasion"}
                    {gaps > 0 ? ` · ${gaps} gap${gaps === 1 ? "" : "s"}` : ""}
                  </p>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
