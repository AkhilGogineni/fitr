import Link from "next/link";
import { notFound } from "next/navigation";

import { CATEGORY_LABELS, type Category } from "@/lib/garments";
import { ITEM_COLUMNS, type WardrobeItem } from "@/lib/items";
import {
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
import { OutfitCanvas, type WardrobePick } from "./canvas";
import { OutfitActions } from "./outfit-actions";

export const metadata = { title: "Outfit · fitr" };

/**
 * Loads one outfit and the wardrobe it can draw from.
 *
 * Three queries rather than a join: PostgREST's embedded selects would nest the
 * item inside each slot, and the canvas wants a flat list of pieces plus a flat
 * list of wardrobe options. Joining here would trade a readable shape for a
 * round trip that isn't the bottleneck at this size.
 *
 * As everywhere else, no query filters by `user_id` — RLS scopes all three, and
 * a missing outfit is a 404 rather than an error, because that is what another
 * user's id looks like from here.
 */
export default async function OutfitPage({ params }: PageProps<"/outfits/[id]">) {
  const { id } = await params;
  const supabase = await createClient();

  const [{ data: outfit }, { data: slotRows }, { data: itemRows }] = await Promise.all([
    supabase.from("outfits").select(OUTFIT_COLUMNS).eq("id", id).maybeSingle(),
    supabase.from("outfit_slots").select(SLOT_COLUMNS).eq("outfit_id", id),
    supabase
      .from("items")
      .select(ITEM_COLUMNS)
      .is("archived_at", null)
      .order("created_at", { ascending: false }),
  ]);

  if (!outfit) notFound();

  const items = (itemRows ?? []) as WardrobeItem[];
  const byId = new Map(items.map((item) => [item.id, item]));

  const slots: SlotView[] = ((slotRows ?? []) as SlotRow[]).map((slot) => {
    const item = slot.item_id ? byId.get(slot.item_id) : undefined;
    return {
      ...slot,
      transform: normaliseTransform(slot.transform, slot.layer),
      imageUrl: item ? publicUrlFor(item.image_cutout_key) : undefined,
      label: item
        ? (item.brand ?? item.subcategory ?? CATEGORY_LABELS[item.category as Category])
        : slot.gap_spec
          ? describeGap(slot.gap_spec, CATEGORY_LABELS[slot.layer])
          : CATEGORY_LABELS[slot.layer],
    };
  });

  const wardrobe: WardrobePick[] = items.map((item) => ({
    id: item.id,
    category: item.category as Category,
    label: item.brand ?? item.subcategory ?? CATEGORY_LABELS[item.category as Category],
    imageUrl: publicUrlFor(item.image_cutout_key),
  }));

  return (
    <div>
      <header className="mb-6 flex items-baseline justify-between gap-4">
        <h1 className="display text-2xl font-medium">
          {(outfit as OutfitRow).name || "Untitled outfit"}
        </h1>
        <div className="flex items-center gap-3">
          <OutfitActions outfitId={id} />
          <Link
            href="/outfits"
            className="text-xs text-ink-muted underline underline-offset-4 transition-colors hover:text-ink"
          >
            All outfits
          </Link>
        </div>
      </header>

      <OutfitCanvas
        outfit={outfit as OutfitRow}
        initialSlots={slots}
        wardrobe={wardrobe}
      />
    </div>
  );
}
