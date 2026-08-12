import { createClient } from "@/lib/supabase/server";

export const metadata = { title: "Wardrobe · fitr" };

export default async function WardrobePage() {
  const supabase = await createClient();

  // No `.eq("user_id", ...)` anywhere: RLS scopes this to the caller. If this
  // ever returns another user's rows, the policies are wrong — which is
  // exactly what the Phase 0 isolation check verifies.
  const { data: items, error } = await supabase
    .from("items")
    .select("id, category, brand, subcategory, image_cutout_key")
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
          If this is a fresh install, the migration in{" "}
          <code className="font-mono text-xs">supabase/migrations</code> may not
          have been applied yet. See SETUP.md.
        </p>
      </div>
    );
  }

  return (
    <div>
      <header className="mb-8 flex items-baseline justify-between">
        <div>
          <h1 className="display text-2xl font-medium">Wardrobe</h1>
          <p className="mt-1 text-sm text-ink-muted">
            {items.length === 0
              ? "Nothing here yet."
              : `${items.length} ${items.length === 1 ? "piece" : "pieces"}`}
          </p>
        </div>
      </header>

      {items.length === 0 ? (
        <div className="rounded-card border border-dashed border-line-strong bg-surface-sunk px-6 py-16 text-center">
          <p className="text-sm text-ink-muted">
            Intake lands in Phase 1 — paste a product URL, or photograph what
            you own.
          </p>
        </div>
      ) : (
        <ul className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
          {items.map((item) => (
            <li
              key={item.id}
              className="rounded-card border border-line bg-surface p-3"
            >
              <div className="aspect-square rounded bg-surface-sunk" />
              <p className="mt-2 truncate text-sm">
                {item.brand ?? item.subcategory ?? item.category}
              </p>
              <p className="label mt-0.5">{item.category}</p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
