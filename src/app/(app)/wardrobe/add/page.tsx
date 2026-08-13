import { ITEM_COLUMNS, type WardrobeItem } from "@/lib/items";
import { publicUrlFor } from "@/lib/r2";
import { createClient } from "@/lib/supabase/server";
import { Intake } from "./intake";

export const metadata = { title: "Add · fitr" };

/**
 * Intake is a client screen — the cutter runs in the browser — so this server
 * page exists to do the two things the browser shouldn't: read the review queue
 * under RLS, and turn R2 object keys into URLs. Keeping `publicUrlFor` on the
 * server means the bucket's public base never has to become a NEXT_PUBLIC value.
 *
 * The queue is loaded so that intake resumes: close the tab halfway through a
 * batch and the unchecked rows are waiting here, not lost.
 */
export default async function AddToWardrobePage() {
  const supabase = await createClient();

  const { data } = await supabase
    .from("items")
    .select(ITEM_COLUMNS)
    .is("archived_at", null)
    .eq("needs_review", true)
    .order("created_at", { ascending: false })
    .limit(60);

  const initialItems = ((data ?? []) as WardrobeItem[]).map((item) => ({
    ...item,
    imageUrl: publicUrlFor(item.image_cutout_key),
  }));

  return <Intake initialItems={initialItems} />;
}
