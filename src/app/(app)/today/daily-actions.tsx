"use client";

import Link from "next/link";
import { useState, useTransition } from "react";

import { CheckIcon, RotateIcon, SpinnerIcon } from "@/components/icons";
import { somethingElse, undoWear, wearIt } from "./actions";

/**
 * The two buttons the whole retention hook rests on.
 *
 * "Wore it" is the primary action and is sized like it. Every wear row this
 * app will ever have comes through this button, so anything that makes it
 * hesitate — a confirmation, a date picker, a second screen — costs the wear
 * log directly.
 *
 * Once tapped it becomes an undo rather than disappearing. The tap is
 * deliberately easy, which means it is easy to hit by accident, and a phantom
 * wearing quietly suppresses those garments from suggestions for a week.
 */
export function DailyActions({
  suggestionId,
  occasion,
  alreadyWorn,
  outfitId,
}: {
  suggestionId: string;
  occasion: string;
  alreadyWorn: boolean;
  outfitId: string | null;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [worn, setWorn] = useState(alreadyWorn);

  // A suggestion whose row failed to insert can still be looked at, but not
  // confirmed — there's nothing to attach the wear to. Saying so is better than
  // a button that silently does nothing.
  const recordable = suggestionId.length > 0;

  const run = (work: () => Promise<{ ok: boolean; error?: string }>) =>
    startTransition(async () => {
      setError(null);
      const result = await work();
      if (!result.ok) setError(result.error ?? "That didn't work.");
    });

  return (
    <div className="mt-6">
      <div className="flex gap-2.5">
        {worn ? (
          <button
            type="button"
            disabled={pending || !recordable}
            onClick={() =>
              run(async () => {
                const result = await undoWear(suggestionId);
                if (result.ok) setWorn(false);
                return result;
              })
            }
            className="flex flex-1 items-center justify-center gap-2 rounded-card border border-line bg-surface px-4 py-3 text-sm font-medium transition-colors hover:border-line-strong disabled:opacity-50"
          >
            <CheckIcon className="size-4" />
            Worn today — undo?
          </button>
        ) : (
          <button
            type="button"
            disabled={pending || !recordable}
            onClick={() =>
              run(async () => {
                const result = await wearIt(suggestionId);
                if (result.ok) setWorn(true);
                return result;
              })
            }
            className="flex flex-1 items-center justify-center gap-2 rounded-card bg-accent px-4 py-3 text-sm font-medium text-accent-ink transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            {pending ? <SpinnerIcon className="size-4" /> : <CheckIcon className="size-4" />}
            Wore it
          </button>
        )}

        <button
          type="button"
          disabled={pending}
          onClick={() => run(() => somethingElse(occasion))}
          className="flex items-center justify-center gap-2 rounded-card border border-line bg-surface px-4 py-3 text-sm transition-colors hover:border-line-strong disabled:opacity-50"
        >
          <RotateIcon className="size-4" />
          Something else
        </button>
      </div>

      {error ? <p className="mt-2 text-xs text-danger">{error}</p> : null}

      {!recordable ? (
        <p className="mt-2 text-xs text-ink-faint">
          This one couldn&apos;t be saved, so it can&apos;t be logged. Reload to try again.
        </p>
      ) : null}

      {outfitId ? (
        <Link
          href={`/outfits/${outfitId}`}
          className="mt-3 inline-block text-xs text-ink-muted underline underline-offset-4 transition-colors hover:text-ink"
        >
          Open this outfit
        </Link>
      ) : null}
    </div>
  );
}
