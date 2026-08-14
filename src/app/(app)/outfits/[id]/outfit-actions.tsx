"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { deleteOutfit, duplicateOutfit } from "../actions";

/**
 * Duplicate and delete for the outfit being edited.
 *
 * Delete is two-step rather than a confirm dialog: the second click is the
 * confirmation, and it costs nothing to reach if you meant it. A modal here
 * would interrupt for something that needs no protected focus — and the mistake
 * it guards against is one click, not a lost afternoon.
 *
 * Duplicating is how a working outfit becomes a variation: same pieces, swap the
 * jacket. It copies the slots too, so the copy opens looking identical.
 */
export function OutfitActions({ outfitId }: { outfitId: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [armed, setArmed] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="flex items-center gap-3">
      {error ? <span className="text-xs text-danger">{error}</span> : null}

      <button
        type="button"
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            const result = await duplicateOutfit(outfitId);
            if (!result.ok) setError(result.error);
            else router.push(`/outfits/${result.data}`);
          })
        }
        className="text-xs text-ink-muted underline underline-offset-4 transition-colors hover:text-ink disabled:opacity-50"
      >
        Duplicate
      </button>

      <button
        type="button"
        disabled={pending}
        onBlur={() => setArmed(false)}
        onClick={() => {
          if (!armed) {
            setArmed(true);
            return;
          }
          startTransition(async () => {
            const result = await deleteOutfit(outfitId);
            if (!result.ok) setError(result.error);
            else router.push("/outfits");
          });
        }}
        className={`text-xs underline underline-offset-4 transition-colors disabled:opacity-50 ${
          armed ? "text-danger" : "text-ink-muted hover:text-danger"
        }`}
      >
        {armed ? "Really delete?" : "Delete"}
      </button>
    </div>
  );
}
