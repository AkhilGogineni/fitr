"use client";

import Link from "next/link";
import { useState, useTransition } from "react";

import { CheckIcon, RotateIcon, SpinnerIcon } from "@/components/icons";
import { btnOutline, btnPrimary, btnTag } from "@/lib/ui";
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
  vibe,
  alreadyWorn,
  outfitId,
}: {
  suggestionId: string;
  occasion: string;
  vibe: string;
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

  /*
   * The flip is optimistic: the button answers at tap speed, and the database
   * catches up behind it. Three sequential round trips of waiting made an
   * instant-feeling action feel broken on anything above a fast link; being
   * wrong once in a while costs one error line, not trust — the state reverts.
   */
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
            onClick={() => {
              setWorn(false); // optimistic undo
              run(async () => {
                const result = await undoWear(suggestionId);
                if (!result.ok) setWorn(true); // put it back if the server refused
                return result;
              });
            }}
            className={`${btnOutline} flex-1 px-4 py-3`}
          >
            <CheckIcon className="size-4 text-copper" />
            Worn today — undo?
          </button>
        ) : (
          <button
            type="button"
            disabled={pending || !recordable}
            onClick={() => {
              setWorn(true); // optimistic wear
              run(async () => {
                const result = await wearIt(suggestionId);
                if (!result.ok) setWorn(false);
                return result;
              });
            }}
            className={`${btnPrimary} flex-1 px-4 py-3 text-base`}
          >
            {pending ? <SpinnerIcon className="size-4" /> : <CheckIcon className="size-4" />}
            Wore it
          </button>
        )}

        <button
          type="button"
          disabled={pending}
          onClick={() => run(() => somethingElse(occasion, vibe))}
          className={`${btnOutline} px-4 py-3`}
        >
          <RotateIcon className="size-4" />
          Something else
        </button>
      </div>

      {error ? <p className="mt-2 font-mono text-xs text-danger">{error}</p> : null}

      {!recordable ? (
        <p className="mt-2 font-mono text-xs leading-relaxed text-ink-faint">
          This one couldn&apos;t be saved, so it can&apos;t be logged. Reload to try again.
        </p>
      ) : null}

      {outfitId ? (
        <Link
          href={`/outfits/${outfitId}`}
          className={`${btnTag} mt-3 inline-block`}
        >
          Open this outfit
        </Link>
      ) : null}
    </div>
  );
}
