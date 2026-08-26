import Link from "next/link";

import { LayersIcon } from "@/components/icons";
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
import { btnPrimary } from "@/lib/ui";
import { publicUrlFor } from "@/lib/r2";
import { createClient } from "@/lib/supabase/server";
import { createOutfit } from "./actions";

export const metadata = { title: "Outfits" };

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
      <div className="rounded-card border border-line bg-surface p-6 shadow-card">
        <h1 className="display text-2xl">Outfits</h1>
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

  /*
   * An outfit with no slots is a draft someone walked away from — "New outfit"
   * has to create the row before the editor can draw on it, but an empty card
   * in this list is noise with no meaning. Drafts younger than an hour are
   * still being worked on and stay alive; older ones are swept here so they
   * never surface at all. An outfit that gained even one slot is permanent.
   */
  const hourAgo = new Date(new Date().getTime() - 3_600_000).toISOString();
  const abandoned = outfits.filter(
    (outfit) =>
      (slotsByOutfit.get(outfit.id)?.length ?? 0) === 0 &&
      outfit.created_at < hourAgo,
  );
  if (abandoned.length > 0) {
    await supabase.from("outfits").delete().in("id", abandoned.map((outfit) => outfit.id));
  }
  const saved = outfits.filter((outfit) => (slotsByOutfit.get(outfit.id)?.length ?? 0) > 0);

  return (
    <div>
      <header className="mb-8 flex flex-wrap items-baseline justify-between gap-4">
        <div>
          <h1 className="display text-4xl">Outfits</h1>
          <p className="label nums mt-2">
            {saved.length === 0 ? "Nothing composed yet." : `${saved.length} saved`}
          </p>
        </div>

        <form action={createOutfit}>
          <button type="submit" className={btnPrimary}>
            New outfit
          </button>
        </form>
      </header>

      {saved.length === 0 ? (
        <div className="rounded-card border border-dashed border-line-strong bg-surface-sunk px-6 py-16 text-center">
          <LayersIcon className="mx-auto size-8 text-ink-faint" />
          <p className="mx-auto mt-4 max-w-md text-sm leading-relaxed text-ink-muted">
            Lay pieces out on a canvas, and leave a gap where the outfit needs
            something you don&apos;t own yet. Those gaps become the shopping list.
          </p>
        </div>
      ) : (
        <ul className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
          {saved.map((outfit, index) => {
            const slots = slotsByOutfit.get(outfit.id) ?? [];
            const gaps = slots.filter((slot) => slot.gap_spec).length;

            return (
              <li
                key={outfit.id}
                className="animate-rise"
                style={{ animationDelay: `${Math.min(index * 40, 400)}ms` }}
              >
                <Link
                  href={`/outfits/${outfit.id}`}
                  className="group block rounded-card border border-line bg-surface p-3 shadow-card transition-[box-shadow,border-color] duration-200 hover:-translate-y-0.5 hover:border-line-strong hover:shadow-lift"
                >
                  <OutfitPreview slots={slots} />
                  <p className="mt-2.5 truncate text-sm">
                    {outfit.name || "Untitled outfit"}
                  </p>
                  <p className="label nums mt-0.5 truncate">
                    {outfit.occasion ? OCCASION_LABELS[outfit.occasion] : "No occasion"}
                    {gaps > 0 ? (
                      <span className="text-copper">
                        {" "}
                        · {gaps} gap{gaps === 1 ? "" : "s"}
                      </span>
                    ) : ""}
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
